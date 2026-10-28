import { expect, test } from "bun:test";
import { createHarness, expoViewConfigs, find, settle } from "./foreign-harness.ts";

/**
 * expo-conic-gradient (SPEC.md, "Foreign views"): the native `ConicGradient` view takes the colours as integers, the locations,
 * the centre as `[x, y]` and the angle. Android's view draws the gradient over its own children and the iOS view is SwiftUI, so on
 * both the gradient fills a container that carries the style and the children.
 */
const configs = { "": expoViewConfigs("expo-conic-gradient/android/src/main/java/expo/modules/conicgradient/ConicGradientModule.kt")[""] };
const name = "ViewManagerAdapter_ConicGradient";
// RN's `processColor`: signed ARGB on Android, unsigned on iOS (#ff0000, rgba(0, 0, 255, 0.5), green).
const colors = { android: [-65536, -2147483393, -16744448], ios: [0xffff0000, 0x800000ff, 0xff008000] };
type App = { setColors(next: unknown[]): void; conicHandle(): { tag: number } | null };

test("the module's own view declares the props the component sends", () => {
  expect(Object.keys(configs[""].validAttributes).sort()).toEqual(["angle", "center", "colors", "locations"]);
  expect(configs[""].directEventTypes).toBeNull();
});

test("Android: a container holds the children and the gradient fills it behind them with colours as integers", async () => {
  const harness = createHarness("android", { expo: { ConicGradient: configs } });
  const loaded = await harness.load("foreign-conic-fixture.svelte");
  const app = loaded.startSurface(131, loaded.Fixture, {}) as App;
  const roots = harness.roots()[131];
  const gradient = find(roots, name)[0];
  const container = find(roots, "RCTView").find((node) => node.children.includes(gradient));
  expect(container?.children.map((node) => node.name)).toEqual([name, "RCTText"]);
  expect(container?.props).toMatchObject({ height: 80, borderRadius: 10, overflow: "hidden", accessibilityLabel: "Sweep" });
  expect(gradient.props).toMatchObject({ colors: colors.android, locations: [0, 0.5, 1], center: [0.25, 0.75], angle: 45, position: "absolute", left: 0, top: 0, right: 0, bottom: 0 });
  for (const key of ["style", "ref", "nativeProps", "children", "component"]) expect(key in gradient.props, key).toBe(false);
  expect(harness.calls.indexOf(`engine.registerForeign ${name}`)).toBeGreaterThanOrEqual(0);
  expect(harness.calls.indexOf(`engine.registerForeign ${name}`)).toBeLessThan(harness.calls.indexOf(`create ${name}`));
  expect(typeof app.conicHandle()?.tag).toBe("number");

  // New colours are a clone of the same node, converted again.
  harness.calls.length = 0;
  app.setColors(["#00ff00", "#0000ff", "#ffffff"]);
  await settle(loaded);
  expect(harness.calls.filter((call) => call.startsWith("create"))).toEqual([]);
  expect(find(harness.roots()[131], name)[0].props.colors).toEqual([-16711936, -16776961, -1]);
});

test("iOS: the same container, with the colours unsigned", async () => {
  const harness = createHarness("ios", { expo: { ConicGradient: configs } });
  const loaded = await harness.load("foreign-conic-fixture.svelte");
  loaded.startSurface(132, loaded.Fixture, {});
  const gradient = find(harness.roots()[132], name)[0];
  expect(gradient.children).toEqual([]);
  expect(gradient.props).toMatchObject({ colors: colors.ios, locations: [0, 0.5, 1], center: [0.25, 0.75], angle: 45 });
});
