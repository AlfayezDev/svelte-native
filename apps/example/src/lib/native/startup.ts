/**
 * How the app's shell keeps trying to start. The product needs the platform configuration (`/api/configuration`) before anything else, and
 * the backend is slow or down at times: a failed attempt is tried again by itself, quickly at first and then at a steady pace, and only while
 * the app is in the foreground. Nothing here touches React Native, so the schedule and the loop are tested on their own (`qa/test/startup.test.ts`).
 */

const delays = [1_000, 2_000, 4_000, 8_000] as const;
/** The pause between attempts once the first ones have failed. */
export const steadyDelay = 15_000;

/** How long to wait before the next attempt after `failures` consecutive failures: 1 s, 2 s, 4 s, 8 s, then every 15 s. */
export function retryDelay(failures: number): number {
  if (failures < 1) return delays[0];
  return delays[failures - 1] ?? steadyDelay;
}

/** Whether the app is in the foreground, and when that changes (React Native's `AppState`, which the shell adapts). */
export type Foreground = {
  active(): boolean;
  /** Calls `listener` whenever the app moves to the foreground (`true`) or the background (`false`); returns what unsubscribes. */
  subscribe(listener: (active: boolean) => void): () => void;
};

export type RetrierOptions = {
  /** One try. A rejection is a failure; the signal aborts when the retrier stops or a newer attempt replaces this one. */
  attempt(signal: AbortSignal): Promise<void>;
  /** Called after each failed attempt with the number of consecutive failures so far (not for an attempt that was aborted). */
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
 * Tries until an attempt succeeds. After a failure the next attempt waits `delay(failures)`; a wait does not run while the app is in the
 * background (a background app is not retrying a request nobody is looking at), and the app coming back to the foreground tries at once with
 * the schedule started over: the network it left may not be the one it returns to. A failure that ends in the background waits for that.
 */
export function createRetrier({ attempt, onFailure, foreground, delay = retryDelay, schedule = timeout }: RetrierOptions): Retrier {
  let failures = 0;
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
      failures++;
      onFailure(cause, failures);
    } finally {
      if (current === controller) current = undefined;
    }
    if (!finished && foreground.active()) cancelWait = schedule(() => { cancelWait = undefined; void run(); }, delay(failures));
  }
  const unsubscribe = foreground.subscribe((active) => {
    if (finished) return;
    if (!active) { unwait(); return; }
    if (current) return;
    failures = 0;
    void run();
  });

  return {
    start() { void run(); },
    retryNow() {
      if (finished) return;
      failures = 0;
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
