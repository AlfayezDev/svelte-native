import { abortError } from "./abort.ts";

/**
 * A failure of native code as the Fetch standard names it: a TypeError ("network error"), with what native code threw as its `cause`. `ERR_FETCH_ABORTED` is the exception: it is `cancel` having
 * been called, so what it stands for is the abort reason, which the caller passes (the default AbortError when there is none).
 */
export function fetchError(error: unknown, reason?: unknown): unknown {
  const code = (error as { code?: unknown } | null)?.code;
  if (code === "ERR_FETCH_ABORTED") return reason === undefined ? abortError() : reason;
  const failure = new TypeError(`Network request failed: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  // An engine that predates the `cause` option drops it.
  if ((failure as { cause?: unknown }).cause === undefined) Object.defineProperty(failure, "cause", { value: error, configurable: true, writable: true });
  return failure;
}
