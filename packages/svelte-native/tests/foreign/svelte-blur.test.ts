import { test, expect } from "bun:test";
import { createHarness, expoViewConfigs, find, settle } from "./support/harness.ts";

/**
 * The library's own blur (`BlurView`, the `SvelteBlur` module in `native/svelte-core`; SPEC.md, "Foreign views"): a container `View` with the native `SvelteBlurView` filling
 * it behind the children, which stay the engine's views. `ExpoBlurView` is expo-blur's (`blur.test.ts`); both are in the `foreign` entry.
 */
const view = "ViewManagerAdapter_SvelteBlur_SvelteBlurView";
const configs = expoViewConfigs("../packages/svelte-native/native/svelte-core/android/src/main/java/expo/modules/svelteblur/SvelteBlurModule.kt");
type App = { setIntensity(next: number): void; setTint(next: string): void; wrapperHandle(): { tag: number } | null };

for (const platform of ["android", "ios"] as const) {
  test(`${platform}: the native view fills a container that holds the children, and takes no touches`, async () => {
    const harness = createHarness(platform, { expo: { SvelteBlur: configs } });
    const loaded = await harness.load("svelte-blur-fixture.svelte");
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
    harness.expectToldFirst(view);
    expect(harness.calls.filter((call) => call.startsWith("engine.registerForeign"))).toEqual([`engine.registerForeign ${view}`]);
    // No props: the intensity is 50 and the tint "default", as the native side defaults them.
    expect(bare.props).toMatchObject({ intensity: 50, tint: "default" });
  });
}

test("a change of intensity or tint updates the native view in place", async () => {
  const harness = createHarness("android", { expo: { SvelteBlur: configs } });
  const loaded = await harness.load("svelte-blur-fixture.svelte");
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
  const loaded = await harness.load("svelte-blur-class-fixture.svelte");
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
  const loaded = await harness.load("svelte-blur-fixture.svelte");
  expect(() => loaded.startSurface(53, loaded.Fixture, {})).toThrow(/Expo module SvelteBlur has no view SvelteBlurView/);
});

test("the foreign entry's BlurView is the library's own and its ExpoBlurView is expo-blur's, each mounting its own native view", async () => {
  const other = expoViewConfigs("expo-blur/android/src/main/java/expo/modules/blur/BlurModule.kt");
  const harness = createHarness("android", { expo: { SvelteBlur: configs, ExpoBlur: other } });
  const loaded = await harness.load("svelte-blur-entry-fixture.svelte");
  loaded.startSurface(55, loaded.Fixture, {});
  const roots = harness.roots()[55];
  expect(find(roots, view)).toHaveLength(1);
  expect(find(roots, "ViewManagerAdapter_ExpoBlur_ExpoBlurView")).toHaveLength(1);
});
