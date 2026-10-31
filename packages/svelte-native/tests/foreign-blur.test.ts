import { test, expect } from "bun:test";
import { createHarness, expoViewConfigs, find, settle } from "./foreign-harness.ts";

/**
 * expo-blur (SPEC.md, "Foreign views"): `BlurView` is a container with the native `ExpoBlurView` filling it and the children
 * on top, as the library builds it; on Android the real blur reads a `BlurTargetView` (`ExpoBlurTargetView`) by its tag, which
 * the native view needs after both views exist, so it arrives with the update that follows the first commit.
 */
const configs = expoViewConfigs("expo-blur/android/src/main/java/expo/modules/blur/BlurModule.kt");
type App = { setMethod(method: string): void; removeTarget(): void; targetHandle(): { tag: number } | null; wrapperHandle(): { tag: number } | null };

test("the module declares two named views and the props the component sends", () => {
  expect(Object.keys(configs).sort()).toEqual(["ExpoBlurTargetView", "ExpoBlurView"]);
  expect(Object.keys(configs.ExpoBlurView.validAttributes).sort()).toEqual(["blurMethod", "blurReductionFactor", "blurTargetId", "intensity", "tint"]);
});

test("Android: the blur view fills a container that holds the children, and the target's tag reaches it in the next transaction", async () => {
  const harness = createHarness("android", { expo: { ExpoBlur: configs } });
  const loaded = await harness.load("foreign-blur-fixture.svelte");
  const app = loaded.startSurface(41, loaded.Fixture, {}) as App;
  const roots = () => harness.roots()[41];
  const target = find(roots(), "ViewManagerAdapter_ExpoBlur_ExpoBlurTargetView")[0];
  let blur = find(roots(), "ViewManagerAdapter_ExpoBlur_ExpoBlurView")[0];
  expect(target).toBeDefined();
  expect(blur).toBeDefined();
  // The target is a foreign view with a plain child (mounted by React Native); the blur is a leaf inside a container, the text beside it.
  expect(target.children.map((node) => node.name)).toEqual(["RCTView"]);
  const container = find(roots(), "RCTView").find((node) => node.children.includes(blur));
  expect(container?.children.map((node) => node.name)).toEqual(["ViewManagerAdapter_ExpoBlur_ExpoBlurView", "RCTText"]);
  expect(container?.props.backgroundColor).toBeDefined();
  expect(container?.props.height).toBe(60);
  expect(container?.props.borderRadius).toBe(12);
  expect(blur.props).toMatchObject({ tint: "dark", intensity: 80, blurReductionFactor: 6, blurMethod: "dimezisBlurView", position: "absolute", left: 0, top: 0, right: 0, bottom: 0 });
  // The target's handle exists when the first transaction is built, the id goes to the blur view with the update after it.
  expect(app.targetHandle()?.tag).toBe(target.tag);
  expect(blur.props.blurTargetId).toBeUndefined();
  // Both views are told to the engine before they are created.
  for (const name of ["ViewManagerAdapter_ExpoBlur_ExpoBlurTargetView", "ViewManagerAdapter_ExpoBlur_ExpoBlurView"]) {
    expect(harness.calls.indexOf(`engine.registerForeign ${name}`), name).toBeGreaterThanOrEqual(0);
    expect(harness.calls.indexOf(`engine.registerForeign ${name}`), name).toBeLessThan(harness.calls.indexOf(`create ${name}`));
  }
  harness.calls.length = 0;
  await settle(loaded);
  blur = find(roots(), "ViewManagerAdapter_ExpoBlur_ExpoBlurView")[0];
  expect(blur.props.blurTargetId).toBe(target.tag);
  expect(harness.calls.filter((call) => call.startsWith("create"))).toEqual([]);

  app.setMethod("none");
  await settle(loaded);
  expect(find(roots(), "ViewManagerAdapter_ExpoBlur_ExpoBlurView")[0].props.blurMethod).toBe("none");
});

test("Android: when the target goes away its ref hears null and the blur view loses the id", async () => {
  const harness = createHarness("android", { expo: { ExpoBlur: configs } });
  const loaded = await harness.load("foreign-blur-fixture.svelte");
  const app = loaded.startSurface(44, loaded.Fixture, {}) as App;
  const roots = () => harness.roots()[44];
  const target = find(roots(), "ViewManagerAdapter_ExpoBlur_ExpoBlurTargetView")[0];
  await settle(loaded);
  expect(find(roots(), "ViewManagerAdapter_ExpoBlur_ExpoBlurView")[0].props.blurTargetId).toBe(target.tag);
  app.removeTarget();
  await settle(loaded);
  await settle(loaded);
  expect(app.targetHandle()).toBeNull();
  expect(find(roots(), "ViewManagerAdapter_ExpoBlur_ExpoBlurTargetView")).toEqual([]);
  // A tag of a view that no longer exists is not sent on (the clone takes the prop away).
  expect(find(roots(), "ViewManagerAdapter_ExpoBlur_ExpoBlurView")[0].props.blurTargetId ?? null).toBeNull();
});

test("iOS: the blur needs no target, which is a plain view there", async () => {
  const harness = createHarness("ios", { expo: { ExpoBlur: configs } });
  const loaded = await harness.load("foreign-blur-fixture.svelte");
  loaded.startSurface(42, loaded.Fixture, {});
  const roots = harness.roots()[42];
  expect(find(roots, "ViewManagerAdapter_ExpoBlur_ExpoBlurTargetView")).toEqual([]);
  expect(find(roots, "ViewManagerAdapter_ExpoBlur_ExpoBlurView")).toHaveLength(1);
  expect(harness.calls.filter((call) => call.startsWith("engine.registerForeign"))).toEqual(["engine.registerForeign ViewManagerAdapter_ExpoBlur_ExpoBlurView"]);
});

test("the blur method defaults to none, and the deprecated experimentalBlurMethod is read", async () => {
  const { blurMethod } = await (async () => {
    const harness = createHarness("android", { expo: { ExpoBlur: configs } });
    const loaded = await harness.load("foreign-blur-defaults-fixture.svelte");
    loaded.startSurface(43, loaded.Fixture, {});
    const views = find(harness.roots()[43], "ViewManagerAdapter_ExpoBlur_ExpoBlurView");
    return { blurMethod: views.map((view) => [view.props.blurMethod, view.props.intensity, view.props.tint, view.props.blurReductionFactor]) };
  })();
  expect(blurMethod).toEqual([["none", 50, "default", 4], ["dimezisBlurViewSdk31Plus", 50, "default", 4]]);
});
