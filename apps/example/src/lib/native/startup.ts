/**
 * How the app's shell keeps trying to start. The start (the root layout's fonts and the lab link the app was launched with) can fail, and a
 * failed attempt is tried again by itself, quickly at first and then at a steady pace, and only while the app is in the foreground. Nothing
 * here touches React Native, so the schedule and the loop are tested on their own (`qa/test/startup.test.ts`).
 *
 * The wait between attempts is client backoff on one local operation, not domain time: it belongs to this process and dies with it. The
 * attempts are deliberately not bounded in count: a phone that is picked up after a failed start is still looking at the notice the next
 * time it is looked at, so the app keeps trying at the steady pace (15 s) for as long as it is in the foreground, and tries nothing in the
 * background, where nobody sees the result. Unbounded in count, bounded in rate.
 */

const delays = [1_000, 2_000, 4_000, 8_000] as const;
/** The pause between attempts once the first ones have failed. */
export const steadyDelay = 15_000;

/** How long to wait before the next attempt after `failures` consecutive failures: 1 s, 2 s, 4 s, 8 s, then every 15 s. */
export function retryDelay(failures: number): number {
  if (failures < 1) return delays[0];
  return delays[failures - 1] ?? steadyDelay;
}

/**
 * Whether an `AppState` status is one of a foreground app. `background` and iOS's `inactive` (Control Center, the app switcher, a system dialog)
 * are paused; `active`, and anything the platform reports that this does not know (`unknown`, `extension`, nothing at all), is not: an app that
 * cannot tell is better off asking than waiting for an event that may never come.
 */
export const isForeground = (state: string | null | undefined): boolean => state !== "background" && state !== "inactive";

/**
 * Whether the app is in the foreground, and when that changes (React Native's `AppState`, which the shell adapts with `isForeground`).
 */
export type Foreground = {
  active(): boolean;
  /** Calls `listener` whenever the app comes to the foreground (`true`) or leaves it (`false`); returns what unsubscribes. */
  subscribe(listener: (active: boolean) => void): () => void;
};

export type RetrierOptions = {
  /** One try. A rejection is a failure; the signal aborts when the retrier stops or a newer attempt replaces this one. */
  attempt(signal: AbortSignal): Promise<void>;
  /**
   * Called after each failed attempt with the number of consecutive failures so far, since the start or the last `retryNow` (not for an attempt
   * that was aborted). The app leaving the foreground and coming back does not start the count over: the caller logs the first one loudly and
   * the rest quietly, and a phone that is picked up now and then must not log it again each time.
   */
  onFailure(cause: unknown, failures: number): void;
  foreground: Foreground;
  delay?(failures: number): number;
  /** Runs `callback` after `ms` and returns what cancels it (the clock of a test replaces the default, `setTimeout`). */
  schedule?(callback: () => void, ms: number): () => void;
};

export type Retrier = {
  /** Makes the first attempt. */
  start(): void;
  /** The Retry button: an attempt at once (the one under way, if any, is abandoned) and the schedule starts over. */
  retryNow(): void;
  /** Ends it: no further attempt, the one under way is aborted. Also done by the first attempt that succeeds. */
  stop(): void;
};

const timeout: NonNullable<RetrierOptions["schedule"]> = (callback, ms) => {
  const handle = setTimeout(callback, ms);
  return () => clearTimeout(handle);
};

/**
 * Tries until an attempt succeeds. After a failure the next attempt waits `delay(n)`, `n` counting the failures since the schedule began; a wait
 * does not run while the app is not in the foreground (nobody is looking at a request it makes), and the app coming back tries at once with the
 * schedule started over: the network it left may not be the one it returns to. A failure that ends away from the foreground waits for that.
 */
export function createRetrier({ attempt, onFailure, foreground, delay = retryDelay, schedule = timeout }: RetrierOptions): Retrier {
  /** Failures since the start or the last `retryNow`: what `onFailure` is told. */
  let streak = 0;
  /** Failures since the schedule began, which coming back to the foreground starts over: what the delay follows. */
  let paced = 0;
  let cancelWait: (() => void) | undefined;
  let current: AbortController | undefined;
  let finished = false;

  const unwait = () => { cancelWait?.(); cancelWait = undefined; };
  const finish = () => { finished = true; unwait(); unsubscribe(); };
  async function run(): Promise<void> {
    unwait();
    if (finished || current) return;
    const controller = new AbortController();
    current = controller;
    try {
      await attempt(controller.signal);
      if (!controller.signal.aborted) finish();
      return;
    } catch (cause) {
      if (controller.signal.aborted) return;
      streak++;
      paced++;
      onFailure(cause, streak);
    } finally {
      if (current === controller) current = undefined;
    }
    if (!finished && foreground.active()) cancelWait = schedule(() => { cancelWait = undefined; void run(); }, delay(paced));
  }
  const unsubscribe = foreground.subscribe((active) => {
    if (finished) return;
    if (!active) { unwait(); return; }
    if (current) return;
    paced = 0;
    void run();
  });

  return {
    start() { void run(); },
    retryNow() {
      if (finished) return;
      streak = 0;
      paced = 0;
      unwait();
      current?.abort();
      current = undefined;
      void run();
    },
    stop() {
      if (finished) return;
      current?.abort();
      current = undefined;
      finish();
    },
  };
}
