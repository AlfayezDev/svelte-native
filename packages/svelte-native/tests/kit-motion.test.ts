import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { build, transform } from "esbuild";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { compileModule } from "svelte/compiler";
import { sourceFile } from "../src/package-root.ts";
import { KIT_MODULES, MOTION_MODULE } from "../src/kit/modules.ts";

/**
 * `svelte/motion` on the device. Svelte builds `prefersReducedMotion` from `window.matchMedia` as the module loads, and React Native has none, so Svelte's own module throws when it is
 * imported: `kit/motion.ts` loads it with a stand-in that is gone afterwards, keeps `Spring`, `Tween`, `spring` and `tweened`, and replaces `prefersReducedMotion` with one that reads
 * React Native's `AccessibilityInfo`. Bundled here the way Metro resolves it (the library's file for an import of `svelte/motion`, Svelte's own for that file's import of it) against a fake
 * `AccessibilityInfo` and `requestAnimationFrame`.
 */
type Info = { reduced: boolean; handlers: ((value: boolean) => void)[]; removed: number; asked: number; answers: (() => void)[] };
const world = globalThis as unknown as { window?: unknown; matchMedia?: unknown; requestAnimationFrame?: unknown; __kitInfo: Info };
const info = () => world.__kitInfo;

const accessibilityModule = `export default {
  // The system answers when a test says so (answer() below).
  isReduceMotionEnabled: () => { const info = globalThis.__kitInfo; info.asked++; const value = info.reduced; return new Promise((resolve) => { info.answers.push(() => resolve(value)); }); },
  addEventListener: (name, handler) => {
    if (name !== 'reduceMotionChanged') throw new Error('unexpected event ' + name);
    globalThis.__kitInfo.handlers.push(handler);
    return { remove() { globalThis.__kitInfo.removed++; globalThis.__kitInfo.handlers = globalThis.__kitInfo.handlers.filter((h) => h !== handler); } };
  },
};`;

/** The library's module and the fixture that reads it, or with `svelteOwn` Svelte's own module, which nothing replaces here. */
async function load(svelteOwn = false) {
  const motion = sourceFile(MOTION_MODULE);
  const bundle = await build({
    stdin: { contents: svelteOwn ? "export * from 'svelte/motion';" : `export * from '../src/kit/motion.ts'; export { watch } from './kit-motion-fixture.svelte.ts';`, resolveDir: import.meta.dirname },
    bundle: true, format: "esm", platform: "neutral", conditions: ["browser"], write: false,
    plugins: [{
      name: "metro-like",
      setup(builder) {
        // The rule of `withSvelteNative`: `svelte/motion` is the library's file for everyone but that file.
        builder.onResolve({ filter: /^svelte\/motion$/ }, async (args) => {
          if (args.pluginData === "real") return undefined;
          return args.importer === motion || svelteOwn ? builder.resolve(args.path, { kind: args.kind, resolveDir: args.resolveDir, importer: args.importer, pluginData: "real" }) : { path: motion };
        });
        builder.onResolve({ filter: /^react-native\/Libraries\/Components\/AccessibilityInfo\/AccessibilityInfo$/ }, (args) => ({ path: args.path, namespace: "stub" }));
        builder.onLoad({ filter: /.*/, namespace: "stub" }, () => ({ contents: accessibilityModule, loader: "js" }));
        builder.onResolve({ filter: /^esm-env$/ }, () => ({ path: resolve(import.meta.dirname, "../src/environment.ts") }));
        builder.onLoad({ filter: /\.svelte\.ts$/ }, async ({ path }) => {
          const { code } = await transform(await readFile(path, "utf8"), { loader: "ts" });
          return { contents: compileModule(code, { filename: path }).js.code, loader: "js" };
        });
      },
    }],
  });
  const directory = await mkdtemp(resolve(tmpdir(), "svelte-native-motion-"));
  const file = resolve(directory, "bundle.mjs");
  await writeFile(file, bundle.outputFiles[0]?.contents ?? "");
  const m = await import(`${pathToFileURL(file).href}?${Math.random()}`);
  await rm(directory, { recursive: true });
  return m as { Spring: new (value: number, options?: object) => { target: number; current: number; set(value: number): Promise<void> }; Tween: new (value: number, options?: object) => { target: number; current: number; set(value: number): Promise<void> }; spring: unknown; tweened: unknown; prefersReducedMotion: { current: boolean }; watch(): { seen: boolean[]; stop(): void } };
}

/** The system answers every question asked of it so far. */
const answer = () => { for (const respond of info().answers.splice(0)) respond(); };
const settle = async () => { for (let turn = 0; turn < 6; turn++) await Promise.resolve(); await new Promise((done) => setTimeout(done, 0)); };

beforeEach(() => {
  // React Native has `window` (the global object) and `requestAnimationFrame`, and no `matchMedia`.
  world.window = globalThis;
  delete world.matchMedia;
  world.requestAnimationFrame = (callback: (time: number) => void) => setTimeout(() => callback(performance.now()), 1);
  world.__kitInfo = { reduced: false, handlers: [], removed: 0, asked: 0, answers: [] };
});
afterEach(() => { delete world.window; delete world.requestAnimationFrame; });

describe("svelte/motion on the device", () => {
  test("Svelte's own module throws when it is imported without matchMedia, which is why the library has one of its own", async () => {
    await expect(load(true)).rejects.toThrow("window.matchMedia is not a function");
  });

  test("importing the library's does not throw, and leaves no matchMedia behind", async () => {
    await load();
    expect(world.matchMedia).toBeUndefined();
    // A platform that does have one keeps it.
    const own = () => ({ matches: true });
    world.matchMedia = own;
    await load();
    expect(world.matchMedia).toBe(own);
  });

  test("it has the names Svelte's module has: Spring, Tween, spring and tweened are Svelte's own (the bundle holds its own copy), and they run", async () => {
    const m = await load();
    expect(Object.keys(m).filter((name) => name !== "watch").toSorted()).toEqual(["Spring", "Tween", "prefersReducedMotion", "spring", "tweened"]);
    // Svelte's module, read with a matchMedia in place, has these names too, and no others (a name Svelte adds has to be added to `kit/motion.ts`).
    world.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
    const svelte = await import("svelte/motion");
    delete world.matchMedia;
    expect(Object.keys(svelte).toSorted()).toEqual(["Spring", "Tween", "prefersReducedMotion", "spring", "tweened"]);
    const tween = new m.Tween(0, { duration: 20 });
    await tween.set(10);
    expect(tween.current).toBe(10);
    const spring = new m.Spring(0, { stiffness: 0.5, damping: 0.9 });
    await spring.set(5);
    expect(Math.round(spring.current)).toBe(5);
  });

  test("prefersReducedMotion.current is the system's setting: false at first, the answer once the system gives it, and the change event after that", async () => {
    info().reduced = true;
    const m = await load();
    expect(info().asked).toBe(1); // asked as the module loaded
    expect(m.prefersReducedMotion.current).toBe(false); // the system has not answered yet
    answer();
    await settle();
    expect(m.prefersReducedMotion.current).toBe(true);

    const watcher = m.watch();
    answer();
    await settle();
    expect(info().handlers).toHaveLength(1);
    expect(watcher.seen.at(-1)).toBe(true);
    info().handlers[0]?.(false);
    await settle();
    expect(watcher.seen.at(-1)).toBe(false);
    info().handlers[0]?.(true);
    await settle();
    expect(watcher.seen.at(-1)).toBe(true);
    // The last reader to stop removes the listener.
    watcher.stop();
    await settle();
    expect(info().removed).toBe(1);
    expect(info().handlers).toHaveLength(0);
  });

  test("a late query cannot overwrite a newer native reduce-motion event", async () => {
    const m = await load();
    const watcher = m.watch();
    info().handlers[0]?.(true);
    await settle();
    expect(watcher.seen.at(-1)).toBe(true);
    answer(); // both queries captured false before the event
    await settle();
    expect(m.prefersReducedMotion.current).toBe(true);
    expect(watcher.seen.at(-1)).toBe(true);
    watcher.stop();
  });

  test("an older query resolving last cannot overwrite the new subscriber's answer", async () => {
    const m = await load();
    const oldAnswer = info().answers.shift()!;
    info().reduced = true;
    const watcher = m.watch();
    answer();
    await settle();
    oldAnswer();
    await settle();
    expect(m.prefersReducedMotion.current).toBe(true);
    expect(watcher.seen.at(-1)).toBe(true);
    watcher.stop();
  });

  test("a detached subscriber's pending query is ignored", async () => {
    const m = await load();
    answer();
    await settle();
    info().reduced = true;
    const watcher = m.watch();
    watcher.stop();
    await settle(); // createSubscriber detaches after a microtask
    answer();
    await settle();
    expect(m.prefersReducedMotion.current).toBe(false);
    expect(info().handlers).toHaveLength(0);
  });

  test("a setting that was off when the module loaded and on when a reader subscribed reaches the reader", async () => {
    const m = await load();
    answer();
    await settle();
    expect(m.prefersReducedMotion.current).toBe(false);
    info().reduced = true;
    const watcher = m.watch();
    expect(watcher.seen).toEqual([false]);
    answer(); // a reader that subscribes asks the system again
    await settle();
    expect(watcher.seen.at(-1)).toBe(true);
    watcher.stop();
  });
});

test("the module Metro resolves is the one the table names", () => {
  expect(KIT_MODULES).not.toHaveProperty("svelte/motion");
  expect(sourceFile(MOTION_MODULE)).toBe(resolve(import.meta.dirname, "../src/kit/motion.ts"));
});

