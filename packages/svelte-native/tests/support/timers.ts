import { jest } from "bun:test";

/**
 * Bun keeps a timer that was set while fake timers were on (`jest.useFakeTimers()`), and its callback, until the process ends, unless it fires or is cleared by its own handle:
 * `jest.useRealTimers()` and `jest.clearAllTimers()` leave it where it is, and nothing runs it any more. A callback of the library is a closure over the bundle that was evaluated
 * for the test (the renderer, Svelte's runtime and the fixture), so a popped screen's exit timer or a press's long-press timer kept that bundle, and every fake host node it made,
 * alive for the rest of the run: the router and gesture tests alone left about 170 of them. The fake timers a test sets are cleared when it ends; the ones a `beforeAll` sets are the file's.
 */
type Handle = ReturnType<typeof setTimeout>;
const pending = new Set<Handle>();
let inTest = false;

const timers = globalThis as unknown as Record<"setTimeout" | "setInterval", (...args: unknown[]) => Handle>;
for (const name of ["setTimeout", "setInterval"] as const) {
  const original = timers[name];
  const tracked = function (this: unknown, ...args: unknown[]): Handle {
    const handle = original.apply(this, args);
    if (inTest && jest.isFakeTimers()) pending.add(handle);
    return handle;
  };
  // What Bun gives its own functions besides the name and the length: the promisified form.
  for (const key of Object.getOwnPropertySymbols(original)) Object.defineProperty(tracked, key, Object.getOwnPropertyDescriptor(original, key) as PropertyDescriptor);
  timers[name] = tracked;
}

/** A test starts: the fake timers it sets from now on are its own. */
export function beginTimers(): void { inTest = true; }

/** The test is over: clears the fake timers it set that have not fired. */
export function endTimers(): void {
  inTest = false;
  for (const handle of pending) clearTimeout(handle);
  pending.clear();
}
