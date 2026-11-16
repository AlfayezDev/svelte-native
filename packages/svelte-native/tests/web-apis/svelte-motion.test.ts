import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { src } from "../support/bundle.ts";
import { answer, hostGlobals, load, setting, settle, type World } from "./support/match-media-harness.ts";

/**
 * `svelte/motion` on the device is Svelte's own module (Metro leaves the import alone). It builds `prefersReducedMotion` from `window.matchMedia` as it loads, which the polyfills
 * (`polyfills.ts`, run first by the app's entry) provide, so `prefersReducedMotion.current` is the system's Reduce Motion setting, read through `AccessibilityInfo`. Bundled here the way
 * Metro resolves it, against the stand-ins of `match-media-harness.ts`.
 */
const host = hostGlobals();
let world: World;

const motion = `import ${JSON.stringify(src("polyfills.ts"))}; export * from "svelte/motion"; export { watch } from ${JSON.stringify(resolve(import.meta.dirname, "fixtures/svelte-motion-fixture.svelte.ts"))};`;

type Spring = { target: number; current: number; set(value: number): Promise<void> };
type Module = {
  Spring: new (value: number, options?: object) => Spring;
  Tween: new (value: number, options?: object) => Spring;
  spring: unknown;
  tweened: unknown;
  prefersReducedMotion: { current: boolean };
  watch(): { seen: boolean[]; stop(): void };
};

beforeEach(() => { world = host.install(); });
afterEach(() => host.restore());

describe("svelte/motion on the device", () => {
  test("Svelte's own module needs a matchMedia when it loads: without the polyfills it throws, which is why the entry runs them first", async () => {
    await expect(load('export * from "svelte/motion";')).rejects.toThrow("window.matchMedia is not a function");
    // Nothing of the device is read, and no matchMedia is left behind, by a load that failed.
    expect(world.asked.motion).toBe(0);
  });

  test("with the polyfills it loads, has the names Svelte's module has, and its Spring and Tween run", async () => {
    const m = await load<Module>(motion);
    expect(Object.keys(m).filter((name) => name !== "watch").toSorted()).toEqual(["Spring", "Tween", "prefersReducedMotion", "spring", "tweened"]);
    const tween = new m.Tween(0, { duration: 20 });
    await tween.set(10);
    expect(tween.current).toBe(10);
    const spring = new m.Spring(0, { stiffness: 0.5, damping: 0.9 });
    await spring.set(5);
    expect(Math.round(spring.current)).toBe(5);
  });

  test("the module asks the system about Reduce Motion as it loads, so a screen's first read has an answer", async () => {
    world.settings.motion = true;
    const m = await load<Module>(motion);
    expect(world.asked.motion).toBe(1);
    expect(m.prefersReducedMotion.current).toBe(false); // the system has not answered yet
    answer(world);
    await settle();
    expect(m.prefersReducedMotion.current).toBe(true);
  });

  test("prefersReducedMotion.current follows the system: the answer, then the change event, and the last reader removes the listener", async () => {
    world.settings.motion = true;
    const m = await load<Module>(motion);
    answer(world);
    await settle();
    expect(m.prefersReducedMotion.current).toBe(true);

    const watcher = m.watch();
    answer(world);
    await settle();
    expect(world.listeners.reduceMotionChanged.size).toBe(1);
    expect(watcher.seen.at(-1)).toBe(true);
    setting(world, "reduceMotionChanged", false);
    await settle();
    expect(watcher.seen.at(-1)).toBe(false);
    setting(world, "reduceMotionChanged", true);
    await settle();
    expect(watcher.seen.at(-1)).toBe(true);
    expect(watcher.seen).toEqual([true, false, true]);
    watcher.stop();
    await settle();
    expect(world.listeners.reduceMotionChanged.size).toBe(0);
    expect(world.added).toBe(world.removed);
  });

  test("a setting that was off when the module loaded and on when a reader subscribed reaches the reader", async () => {
    const m = await load<Module>(motion);
    answer(world);
    await settle();
    expect(m.prefersReducedMotion.current).toBe(false);
    world.settings.motion = true;
    const watcher = m.watch();
    expect(watcher.seen).toEqual([false]);
    answer(world); // a reader that subscribes asks the system again
    await settle();
    expect(watcher.seen.at(-1)).toBe(true);
    watcher.stop();
  });
});

test("real svelte/motion ignores queries and native callbacks from a previous reader lifetime", async () => {
  const m = await load<Module>(motion);
  const first = m.watch();
  const oldQuestions = world.questions.splice(0);
  const oldEvent = [...world.listeners.reduceMotionChanged][0]! as (value: boolean) => void;
  first.stop();
  await settle();
  const next = m.watch();
  expect(world.questions).toHaveLength(1);
  world.questions.shift()!.respond(true);
  await settle();
  expect(next.seen.at(-1)).toBe(true);
  oldEvent(false);
  for (const question of oldQuestions) question.respond(false);
  await settle();
  expect(next.seen.at(-1)).toBe(true);
  next.stop();
  await settle();
  expect(world.listeners.reduceMotionChanged.size).toBe(0);
});
