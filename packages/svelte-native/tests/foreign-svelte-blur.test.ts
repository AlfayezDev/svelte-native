import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHarness, expoViewConfigs, find, settle } from "./foreign-harness.ts";

/**
 * The library's own blur (`BlurView`, the `SvelteBlur` module in `native/svelte-blur`; SPEC.md, "Foreign views"): a container `View` with the native `SvelteBlurView` filling
 * it behind the children, which stay the engine's views. `ExpoBlurView` is expo-blur's (`foreign-blur.test.ts`); both are in the `foreign` entry.
 */
const view = "ViewManagerAdapter_SvelteBlur_SvelteBlurView";
const kotlin = "../packages/svelte-native/native/svelte-blur/android/src/main/java/expo/modules/svelteblur/SvelteBlurModule.kt";
const configs = expoViewConfigs(kotlin);
type App = { setIntensity(next: number): void; setTint(next: string): void; wrapperHandle(): { tag: number } | null };

test("the module declares one view and the two props the component sends", () => {
  expect(Object.keys(configs)).toEqual(["SvelteBlurView"]);
  expect(Object.keys(configs.SvelteBlurView.validAttributes).sort()).toEqual(["intensity", "tint"]);
  expect(configs.SvelteBlurView.directEventTypes ?? null).toBeNull();
});

for (const platform of ["android", "ios"] as const) {
  test(`${platform}: the native view fills a container that holds the children, and takes no touches`, async () => {
    const harness = createHarness(platform, { expo: { SvelteBlur: configs } });
    const loaded = await harness.load("foreign-svelte-blur-fixture.svelte");
    const app = loaded.startSurface(51, loaded.Fixture, {}) as App;
    const roots = harness.roots()[51];
    const [blur, bare] = find(roots, view);
    expect(blur).toBeDefined();
    // The container is the engine's own view: the blur is its first child (behind), the text after it.
    const container = find(roots, "RCTView").find((node) => node.children.includes(blur));
    expect(container?.children.map((node) => node.name)).toEqual([view, "RCTText"]);
    expect(container?.props.height).toBe(60);
    expect(container?.props.borderRadius).toBe(12);
    expect(container?.props.overflow).toBe("hidden");
    // The container is a plain View: no background of its own to hide a class's or a style's.
    expect(container?.props.backgroundColor).toBeUndefined();
    expect(blur.props).toMatchObject({ intensity: 80, tint: "dark", pointerEvents: "none", position: "absolute", left: 0, top: 0, right: 0, bottom: 0 });
    // The view is a leaf of its own, never the container (React Native mounts only that one).
    expect(blur.children).toEqual([]);
    expect(app.wrapperHandle()?.tag).toBe(container?.tag);
    // The module's name is told to the engine before the view is created.
    expect(harness.calls.indexOf(`engine.registerForeign ${view}`)).toBeGreaterThanOrEqual(0);
    expect(harness.calls.indexOf(`engine.registerForeign ${view}`)).toBeLessThan(harness.calls.indexOf(`create ${view}`));
    expect(harness.calls.filter((call) => call.startsWith("engine.registerForeign"))).toEqual([`engine.registerForeign ${view}`]);
    // No props: the intensity is 50 and the tint "default", as the native side defaults them.
    expect(bare.props).toMatchObject({ intensity: 50, tint: "default" });
  });
}

test("a change of intensity or tint updates the native view in place", async () => {
  const harness = createHarness("android", { expo: { SvelteBlur: configs } });
  const loaded = await harness.load("foreign-svelte-blur-fixture.svelte");
  const app = loaded.startSurface(52, loaded.Fixture, {}) as App;
  const roots = () => harness.roots()[52];
  const before = find(roots(), view)[0];
  harness.calls.length = 0;
  app.setIntensity(20);
  await settle(loaded);
  let after = find(roots(), view)[0];
  expect(after.props).toMatchObject({ intensity: 20, tint: "dark" });
  expect(after.tag).toBe(before.tag);
  app.setTint("systemMaterialLight");
  await settle(loaded);
  after = find(roots(), view)[0];
  expect(after.props).toMatchObject({ intensity: 20, tint: "systemMaterialLight" });
  expect(after.tag).toBe(before.tag);
  expect(harness.calls.filter((call) => call.startsWith("create"))).toEqual([]);
});

test("a class's background reaches the container, and an inline style still wins over it", async () => {
  const harness = createHarness("android", { expo: { SvelteBlur: configs }, exports: "export * as classes from '../src/classes.ts';" });
  const loaded = await harness.load("foreign-svelte-blur-class-fixture.svelte");
  const { classes } = loaded as unknown as { classes: { setClassResolver(resolver: (className: string) => unknown): void } };
  classes.setClassResolver((className) => (className === "frost" ? { backgroundColor: "#ff0000", borderRadius: 8 } : undefined));
  loaded.startSurface(54, loaded.Fixture, {});
  const roots = harness.roots()[54];
  const containers = find(roots, view).map((blur) => find(roots, "RCTView").find((node) => node.children.includes(blur)));
  expect(containers).toHaveLength(4);
  const [byClass, byStyle, plain, red] = containers;
  // The class's red is the red an inline style gives.
  expect(red?.props.backgroundColor).toBeDefined();
  expect(byClass?.props.backgroundColor).toEqual(red?.props.backgroundColor);
  expect(byClass?.props.borderRadius).toBe(8);
  expect(byStyle?.props.backgroundColor).toBeDefined();
  expect(byStyle?.props.backgroundColor).not.toEqual(byClass?.props.backgroundColor);
  expect(plain?.props.backgroundColor).toBeUndefined();
});

test("without the native module the view fails with the message that says to rebuild", async () => {
  const harness = createHarness("android");
  const loaded = await harness.load("foreign-svelte-blur-fixture.svelte");
  expect(() => loaded.startSurface(53, loaded.Fixture, {})).toThrow(/Expo module SvelteBlur has no view SvelteBlurView/);
});

test("the foreign entry exports the library's BlurView and expo-blur's ExpoBlurView, each from its own component, and the tint type", () => {
  const entry = readFileSync(resolve(import.meta.dirname, "../src/foreign.ts"), "utf8");
  expect(entry).toContain('export { default as BlurView } from "./components/BlurView.svelte";');
  expect(entry).toContain('export { default as ExpoBlurView } from "./components/ExpoBlurView.svelte";');
  expect(entry).toContain('export type { BlurTint } from "./fabric/foreign-blur.ts";');
  const own = readFileSync(resolve(import.meta.dirname, "../src/components/BlurView.svelte"), "utf8");
  expect(own).toContain('expoViewName("SvelteBlur", "SvelteBlurView")');
  expect(own).not.toContain('"ExpoBlur"');
  const expo = readFileSync(resolve(import.meta.dirname, "../src/components/ExpoBlurView.svelte"), "utf8");
  expect(expo).toContain('expoViewName("ExpoBlur", "ExpoBlurView")');
  expect(expo).not.toContain('"SvelteBlur"');
});

test("the tint type lists every name expo-blur takes, so a screen can move from one to the other", () => {
  const tints = readFileSync(resolve(import.meta.dirname, "../../../node_modules/expo-blur/android/src/main/java/expo/modules/blur/enums/TintStyle.kt"), "utf8");
  const names = [...tints.matchAll(/\w+\("(\w+)"\)/g)].map((match) => match[1] as string).sort();
  const declared = readFileSync(resolve(import.meta.dirname, "../src/fabric/foreign-blur.ts"), "utf8");
  const ours = [...declared.matchAll(/\| "(\w+)"/g)].map((match) => match[1] as string).sort();
  expect(names.length).toBeGreaterThan(15);
  expect(ours).toEqual(names);
});
