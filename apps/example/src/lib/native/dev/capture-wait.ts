import { isLabPath } from "./launch-link.ts";

/** Whether the capture of a screen needs the product's session up: the screen (or the one it is pushed on) is not the lab's. */
export const needsProduct = (spec: { goto: string; base?: string }): boolean => !isLabPath((spec.base ?? spec.goto).split(/[?#]/)[0] ?? "");

/** How long the capture gives the product's start (the configuration, the connection, the first rows) before it photographs what is there. */
export const productWaitMs = 20_000;

/**
 * Waits, once for the whole run, for the product's start to be ready. Returns `null` when it is (at once when it already is); after `boundMs`
 * it returns what to record, and from then on returns that at once: a backend that stays down costs one window of waiting, not one for each
 * theme and each screen. The screenshot is then of what the app shows meanwhile (the loading page or its notice), recorded with this detail.
 * `hold` keeps the phone awake while it waits (and returns what lets go): the lab page that keeps it awake is not on screen then, and the wait
 * can be as long as the phone's shortest auto-lock.
 */
export function productWaiter({ phase, boundMs = productWaitMs, sleep, now, hold }: {
  phase(): "pending" | "failed" | "ready";
  boundMs?: number;
  sleep(ms: number): Promise<void>;
  now(): number;
  hold?(): () => void;
}): () => Promise<string | null> {
  let gaveUp: string | null = null;
  return async () => {
    if (phase() === "ready") return null;
    if (gaveUp) return gaveUp;
    const release = hold?.();
    try {
      const deadline = now() + boundMs;
      while (now() < deadline) {
        await sleep(200);
        if (phase() === "ready") {
          await sleep(500); // the screen renders in the flush after the session loaded; the screenshot loop then waits for it to settle
          return null;
        }
      }
    } finally {
      release?.();
    }
    // `failed` is the start's notice being up: the platform configuration did not answer, or the start itself could not go on (the launch link or the fonts).
    gaveUp = `the product did not start within ${boundMs / 1000} s (${phase() === "failed" ? "its start failed, usually because the platform configuration is not answering: the app shows its notice" : "it was still loading"}); this is what the app showed, and the screens that need the session after it are not waited for`;
    return gaveUp;
  };
}
