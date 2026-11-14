// What `fetch` needs of `AbortSignal`, on a device whose signal is React Native's `abort-controller` package: a signal there has no `reason` (`controller.abort(reason)` drops it),
// no `timeout` and no `any`. A reason that is missing is the standard's default, a DOMException named "AbortError".

export function abortError(message = "This operation was aborted"): Error {
  if (typeof DOMException === "function") return new DOMException(message, "AbortError");
  const error = new Error(message);
  error.name = "AbortError";
  return error;
}

/** What a signal was aborted with: its reason, or the default error when the signal has none (it was aborted without one, or this signal cannot carry one). */
export function abortReason(signal: AbortSignal | null | undefined): unknown {
  const reason = (signal as { reason?: unknown } | null | undefined)?.reason;
  return reason === undefined ? abortError() : reason;
}

/**
 * `promise`, or a rejection with the signal's reason as soon as the signal aborts, whichever comes first. What the promise stands for is not stopped: it finishes, or fails, unwatched,
 * so whatever can be stopped must listen to the signal itself.
 */
export function untilAborted<T>(promise: Promise<T>, signal: AbortSignal | null | undefined): Promise<T> {
  if (!signal) return promise;
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => {
      signal.removeEventListener("abort", onAbort);
      promise.catch(() => undefined);
      reject(abortReason(signal));
    };
    if (signal.aborted) return onAbort();
    signal.addEventListener("abort", onAbort);
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

/**
 * Aborts with a reason even where the controller drops it. A signal without `reason` (React Native's) is given it before the abort, so the abort's listeners already see it
 * (a timeout's TimeoutError, not the default AbortError); one that dropped it anyway gets it after.
 */
export function abortWithReason(controller: AbortController, reason: unknown): void {
  if (!("reason" in controller.signal)) Object.defineProperty(controller.signal, "reason", { value: reason, configurable: true });
  controller.abort(reason);
  if ((controller.signal as { reason?: unknown }).reason !== reason) {
    Object.defineProperty(controller.signal, "reason", { value: reason, configurable: true });
  }
}

export function isAbortSignal(value: unknown): value is AbortSignal {
  const signal = value as Partial<AbortSignal> | null;
  return typeof signal === "object" && signal !== null && typeof signal.aborted === "boolean" && typeof signal.addEventListener === "function" && typeof signal.removeEventListener === "function";
}

type Listening = { target: { deref(): object | undefined }; remove(): void };
const listening = new WeakMap<AbortSignal, Set<Listening>>();
/** Removes the listener of a target that was collected, where the engine has a FinalizationRegistry (Hermes may not). */
const finalizer = typeof FinalizationRegistry === "function" ? new FinalizationRegistry<() => void>((remove) => remove()) : null;

/**
 * A weak reference to `target`, or, in an engine without WeakRef, a strong one. It is made by a function of its own so that no closure of `listenWhileAlive` captures `target`: an
 * engine gives the closures of a function one shared scope, and a variable any of them captures is held by all of them.
 */
function weakly(target: object): Listening["target"] {
  return typeof WeakRef === "function" ? new WeakRef(target) : { deref: () => target };
}

/**
 * Calls `onAbort(target)` when `signal` aborts, for as long as `target` is alive and has not called the returned `remove`. A signal outlives the requests made with it (one controller
 * for a screen's requests), and a listener that holds what it acts on keeps every unread response, and the transfer behind it, alive until the signal dies. This one holds the
 * target weakly, takes itself off the signal when the target is collected (at once with a FinalizationRegistry; otherwise the next time a listener is added to the same signal
 * sweeps the ones whose target is gone), and when it has fired.
 */
export function listenWhileAlive<T extends object>(signal: AbortSignal, target: T, onAbort: (target: T) => void): () => void {
  let entries = listening.get(signal);
  if (entries === undefined) listening.set(signal, (entries = new Set()));
  for (const entry of entries) if (entry.target.deref() === undefined) entry.remove();
  const held = entries;
  const weak = weakly(target);
  const entry: Listening = { target: weak, remove };
  function listener(): void {
    const alive = weak.deref() as T | undefined;
    remove();
    if (alive !== undefined) onAbort(alive);
  }
  function remove(): void {
    signal.removeEventListener("abort", listener);
    held.delete(entry);
    finalizer?.unregister(entry);
  }
  signal.addEventListener("abort", listener);
  held.add(entry);
  finalizer?.register(target, remove, entry);
  return remove;
}

const followers = new WeakMap<AbortSignal, AbortController>();

/**
 * A signal that aborts, with the same reason, when `source` does (`request.signal` is one: the caller's signal is not the request's). It is listened for weakly: a request whose
 * signal is read and then dropped does not leave a listener on a long-lived `source`.
 */
export function followSignal(source: AbortSignal): AbortSignal {
  const controller = new AbortController();
  if (source.aborted) {
    abortWithReason(controller, abortReason(source));
    return controller.signal;
  }
  const follower = controller.signal;
  followers.set(follower, controller);
  listenWhileAlive(source, follower, (signal) => abortWithReason(followers.get(signal)!, abortReason(source)));
  return follower;
}

const MAX_TIMER = 2 ** 31 - 1;

function timeout(milliseconds: number): AbortSignal {
  if (typeof milliseconds !== "number" || !Number.isInteger(milliseconds) || milliseconds < 0) throw new TypeError("AbortSignal.timeout requires a non-negative integer of milliseconds");
  const controller = new AbortController();
  let remaining = milliseconds;
  const wait = (): void => {
    const delay = Math.min(remaining, MAX_TIMER);
    remaining -= delay;
    setTimeout(() => { if (remaining > 0) wait(); else abortWithReason(controller, new DOMException("The operation timed out.", "TimeoutError")); }, delay);
  };
  wait();
  return controller.signal;
}

function any(signals: Iterable<AbortSignal>): AbortSignal {
  const list = [...signals];
  for (const signal of list) if (!isAbortSignal(signal)) throw new TypeError("AbortSignal.any requires every item to be an AbortSignal");
  const controller = new AbortController();
  const aborted = list.find((signal) => signal.aborted);
  if (aborted) {
    abortWithReason(controller, abortReason(aborted));
    return controller.signal;
  }
  const listeners: (readonly [AbortSignal, () => void])[] = list.map((signal) => {
    const listener = (): void => {
      for (const [other, otherListener] of listeners) other.removeEventListener("abort", otherListener);
      abortWithReason(controller, abortReason(signal));
    };
    return [signal, listener] as const;
  });
  for (const [signal, listener] of listeners) signal.addEventListener("abort", listener);
  return controller.signal;
}

/** Adds `AbortSignal.timeout` and `AbortSignal.any` where the runtime lacks them (Expo's runtime installs them too: whichever is first stays). */
export function installAbortStatics(): void {
  if (typeof AbortSignal !== "function") return;
  for (const [name, value] of [["timeout", timeout], ["any", any]] as const) {
    if (typeof (AbortSignal as unknown as Record<string, unknown>)[name] !== "function") Object.defineProperty(AbortSignal, name, { value, configurable: true, writable: true, enumerable: false });
  }
}
