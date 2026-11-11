import { mock } from "bun:test";

/**
 * Test setup for the async-mode run: the whole suite with Svelte's async mode (`experimental.async`) on, to see what an app that turns it on would see. `bunfig.toml` preloads this file;
 * without `SVELTE_NATIVE_TEST_ASYNC` it does nothing and the default suite is unchanged. Run `SVELTE_NATIVE_TEST_ASYNC=1 bun test`, one file at a time under a `timeout` when hunting a hang
 * (what the mode changes for an app is pinned in `tests/async-mode-parity.test.ts` and written up in the docs, Routing, "Preparing a screen"). The app's own switch, `SVELTE_NATIVE_ASYNC` (`withSvelteNative(config, { async: true })`), reaches only the options the
 * library builds (`componentOptions`); this mocks the compiler, so the tests' own `compile` and `compileModule` calls get the option as well.
 *
 * - `1`: every `compile` and `compileModule` in the test process gets `experimental.async`, and a 16 ms timer stands in for React Native's `requestAnimationFrame`, which
 *   async mode's `tick()` waits for (it also arms a zero timer, so a frame is not what normally decides).
 * - `microtask`: the same, with the frame on a microtask. A test that fakes timers (`jest.useFakeTimers()`) stops every timer, Bun's captured ones included, so `tick()`
 *   would never resolve; the microtask frame lets those files run and show what else they would report.
 * - `frames`: the frame timer alone, async mode off: tells a failure the frame shim causes from one async mode does.
 */
const mode = process.env.SVELTE_NATIVE_TEST_ASYNC;
if (mode) {
  if (mode !== "frames") {
    // A copy of the real functions, taken before the mock: Bun's `mock.module` rewrites the module's own exports in place, so the namespace itself would reach the mock (and call it for ever).
    const compiler = { ...(await import("svelte/compiler")) };
    const asynchronous = <Options extends { experimental?: object } | undefined>(options: Options) => ({ ...options, experimental: { ...options?.experimental, async: true } });
    mock.module("svelte/compiler", () => ({
      ...compiler,
      compile: (source: string, options?: Parameters<typeof compiler.compile>[1]) => compiler.compile(source, asynchronous(options)),
      compileModule: (source: string, options: Parameters<typeof compiler.compileModule>[1]) => compiler.compileModule(source, asynchronous(options)),
    }));
  }
  const scope = globalThis as { requestAnimationFrame?: unknown; cancelAnimationFrame?: unknown };
  const frames = new Map<number, ReturnType<typeof setTimeout> | true>();
  let nextFrame = 0;
  scope.requestAnimationFrame = (callback: (time: number) => void) => {
    const id = ++nextFrame;
    const run = () => { if (frames.delete(id)) callback(performance.now()); };
    if (mode === "microtask") { frames.set(id, true); queueMicrotask(run); } else frames.set(id, setTimeout(run, 16));
    return id;
  };
  scope.cancelAnimationFrame = (id: number) => {
    const timer = frames.get(id);
    if (timer !== undefined && timer !== true) clearTimeout(timer);
    frames.delete(id);
  };
}
