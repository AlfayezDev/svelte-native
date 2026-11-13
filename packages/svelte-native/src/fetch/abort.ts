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

/** Aborts with a reason even where the controller drops it: the reason is then attached to the signal by hand. */
export function abortWithReason(controller: AbortController, reason: unknown): void {
  controller.abort(reason);
  if ((controller.signal as { reason?: unknown }).reason !== reason) {
    Object.defineProperty(controller.signal, "reason", { value: reason, configurable: true });
  }
}

export function isAbortSignal(value: unknown): value is AbortSignal {
  const signal = value as Partial<AbortSignal> | null;
  return typeof signal === "object" && signal !== null && typeof signal.aborted === "boolean" && typeof signal.addEventListener === "function" && typeof signal.removeEventListener === "function";
}

/** A signal that aborts, with the same reason, when `source` does (`request.signal` is one: the caller's signal is not the request's). */
export function followSignal(source: AbortSignal): AbortSignal {
  const controller = new AbortController();
  if (source.aborted) abortWithReason(controller, abortReason(source));
  else source.addEventListener("abort", () => abortWithReason(controller, abortReason(source)), { once: true });
  return controller.signal;
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
