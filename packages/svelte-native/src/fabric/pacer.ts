/**
 * Bulk starts of Reanimated work, paced by frame.
 *
 * Worklets runs every job a JavaScript task queued as one UI-thread message, and what a job costs is mostly the deserialisation of the closure it
 * carries, not what it does. On the Galaxy A16 (UI thread on a little core at 500 MHz after an idle spell, then on a big one) 48 animated tiles
 * mounted together queued 144 jobs, 37 to 43 ms in one message: the descriptor update and the mapper registration of a tile cost about 0.08 ms
 * each, the start of its animation (`position.value = withRepeat(...)`: the whole tree of `with*` closures crosses over) 0.4 ms. The main
 * thread did not draw for 3 frames, and the first frames after it ran 48 mappers for the first time (15 to 19 ms of `animation` callbacks).
 *
 * A [Pacer] lets the first `batch` costly tasks of a JavaScript task run at once and queues the rest, `batch` of them for each following frame,
 * in order. Tasks that belong to the same key keep their order: once a key has queued work, whatever follows for it queues behind it.
 */
export type Frame = (callback: () => void) => void;

/** How many costly starts of one kind run at once, and then in each frame. Four animation starts are about 2 ms on the A16's UI thread at its coldest. */
export const BULK_BATCH = 4;

type Entry = { key: object; task: () => void; costly: boolean };

export class Pacer {
  private used = 0;
  private resetting = false;
  private scheduled = false;
  private queue: Entry[] = [];
  /** How many queued entries each key has. */
  private readonly waiting = new Map<object, number>();

  constructor(
    private readonly batch: number,
    private readonly frame: Frame,
  ) {}

  /** Whether `key` has work that has not run yet. */
  has(key: object): boolean {
    return this.waiting.has(key);
  }

  /** Runs `task` now, or on a later frame when it is costly and this JavaScript task has started `batch` costly tasks already, or when `key` still has queued work. */
  run(key: object, task: () => void, costly: boolean): void {
    if (this.waiting.has(key) || (costly && this.used >= this.batch)) {
      this.queue.push({ key, task, costly });
      this.waiting.set(key, (this.waiting.get(key) ?? 0) + 1);
      this.schedule();
      return;
    }
    if (costly) this.charge();
    task();
  }

  /** Forgets the costly work `key` has queued (its owner is gone, or it was cancelled before it started); cheap work queued behind it still runs, in order. */
  drop(key: object): void {
    if (!this.waiting.has(key)) return;
    this.queue = this.queue.filter((entry) => entry.key !== key || !entry.costly);
    const left = this.queue.reduce((count, entry) => count + (entry.key === key ? 1 : 0), 0);
    if (left === 0) this.waiting.delete(key);
    else this.waiting.set(key, left);
  }

  private charge(): void {
    this.used++;
    if (this.resetting) return;
    this.resetting = true;
    queueMicrotask(() => {
      this.used = 0;
      this.resetting = false;
    });
  }

  private schedule(): void {
    if (this.scheduled) return;
    this.scheduled = true;
    this.frame(() => {
      this.scheduled = false;
      let costly = 0;
      while (this.queue.length > 0) {
        const next = this.queue[0] as Entry;
        if (next.costly && costly === this.batch) break;
        this.queue.shift();
        const left = (this.waiting.get(next.key) ?? 1) - 1;
        if (left === 0) this.waiting.delete(next.key);
        else this.waiting.set(next.key, left);
        if (next.costly) costly++;
        next.task();
      }
      if (this.queue.length > 0) this.schedule();
    });
  }
}

/** How long after its creation a shared value counts as new: the start of its first animation is the one a mount puts into a bulk. */
export const FRESH_MS = 100;

/**
 * Routes the first animation definition assigned to a new `mutable.value` through `pacer`: the assignment of `with*(...)` within [FRESH_MS] of the
 * value's creation is the costly job (a screen that mounts many animated views starts all of them together), any other assignment keeps its place
 * behind a start that is waiting and otherwise runs at once, so an animation started by a touch or a response is never delayed. `isAnimation` tells a
 * definition from a plain value. Reanimated defines `value` on the instance (`mutableGuestDecorator`), so the accessor is wrapped in place; a
 * mutable without a configurable accessor is left as it is.
 */
export function paceAssignments(mutable: object, pacer: Pacer, isAnimation: (next: unknown) => boolean, now: () => number = () => performance.now()): void {
  const accessor = Object.getOwnPropertyDescriptor(mutable, "value");
  if (!accessor?.configurable || !accessor.set) return;
  const assign = accessor.set;
  const born = now();
  Object.defineProperty(mutable, "value", {
    ...accessor,
    set(next: unknown) {
      pacer.run(mutable, () => assign.call(mutable, next), now() - born < FRESH_MS && isAnimation(next));
    },
  });
}
