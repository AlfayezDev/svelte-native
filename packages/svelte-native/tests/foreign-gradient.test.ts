import { afterAll, beforeAll, expect, test } from "bun:test";
import { createHarness, expoViewConfigs, find, settle } from "./foreign-harness.ts";
import { borderRadii, gradientProps } from "../src/fabric/foreign-gradient.ts";

/**
 * expo-linear-gradient (SPEC.md, "Foreign views"): the native `ExpoLinearGradient` view takes the colours as integers, points as
 * `[x, y]` and, on Android, the corner radii of the container's style; Android's wrapper is a container with the gradient
 * filling it (the children are the engine's views), iOS's gradient view is the container.
 */
const configs = { "": expoViewConfigs("expo-linear-gradient/android/src/main/java/expo/modules/lineargradient/LinearGradientModule.kt")[""] };
const name = "ViewManagerAdapter_ExpoLinearGradient";
// RN's `processColor`: signed ARGB on Android, unsigned on iOS (#ff0000, rgba(0, 0, 255, 0.5), green).
const colors = { android: [-65536, -2147483393, -16744448], ios: [0xffff0000, 0x800000ff, 0xff008000] };
// The fixture gives one colour too few locations on purpose, which the wrapper warns about.
const { warn: originalWarn } = console;
beforeAll(() => { console.warn = () => {}; });
afterAll(() => { console.warn = originalWarn; });
type App = { setColors(next: unknown[]): void; gradientHandle(): { tag: number } | null };

test("the module's own view declares the props the wrapper sends", () => {
  expect(Object.keys(configs[""].validAttributes).sort()).toEqual(["borderRadii", "colors", "dither", "endPoint", "locations", "startPoint"]);
  expect(configs[""].directEventTypes).toBeNull();
});

test("Android: a container holds the children and the gradient fills it with colours as integers, points as pairs and the corner radii", async () => {
  const harness = createHarness("android", { expo: { ExpoLinearGradient: configs } });
  const loaded = await harness.load("foreign-gradient-fixture.svelte");
  const app = loaded.startSurface(51, loaded.Fixture, {}) as App;
  const roots = harness.roots()[51];
  const gradient = find(roots, name)[0];
  const container = find(roots, "RCTView").find((node) => node.children.includes(gradient));
  expect(container?.children.map((node) => node.name)).toEqual([name, "RCTText"]);
  expect(container?.props).toMatchObject({ height: 80, borderRadius: 10, accessibilityLabel: "Fade" });
  expect(gradient.props.colors).toEqual(colors.android);
  // Four locations for three colours: cut to the colours' count, as the wrapper does.
  expect(gradient.props.locations).toEqual([0, 0.5, 1]);
  expect(gradient.props.startPoint).toEqual([0, 0]);
  expect(gradient.props.endPoint).toEqual([1, 1]);
  expect(gradient.props.dither).toBe(false);
  expect(gradient.props.borderRadii).toEqual([4, 4, 10, 10, 10, 10, 10, 10]);
  expect(gradient.props).toMatchObject({ position: "absolute", left: 0, top: 0, right: 0, bottom: 0 });
  for (const key of ["start", "end", "ref", "nativeProps", "children", "component"]) expect(key in gradient.props, key).toBe(false);
  // The engine is told the name before the view is created.
  expect(harness.calls.indexOf(`engine.registerForeign ${name}`)).toBeGreaterThanOrEqual(0);
  expect(harness.calls.indexOf(`engine.registerForeign ${name}`)).toBeLessThan(harness.calls.indexOf(`create ${name}`));
  expect(typeof app.gradientHandle()?.tag).toBe("number");

  // New colours are a clone of the same node, converted again.
  harness.calls.length = 0;
  app.setColors(["#00ff00", "#0000ff"]);
  await settle(loaded);
  expect(harness.calls.filter((call) => call.startsWith("create"))).toEqual([]);
  expect(find(harness.roots()[51], name)[0].props.colors).toEqual([-16711936, -16776961]);
});

test("iOS: the gradient view is the container itself, with the style and the children, and no dither or radii", async () => {
  const harness = createHarness("ios", { expo: { ExpoLinearGradient: configs } });
  const loaded = await harness.load("foreign-gradient-fixture.svelte");
  loaded.startSurface(52, loaded.Fixture, {});
  const gradient = find(harness.roots()[52], name)[0];
  expect(gradient.children.map((node) => node.name)).toEqual(["RCTText"]);
  expect(gradient.props).toMatchObject({ colors: colors.ios, locations: [0, 0.5, 1], startPoint: [0, 0], endPoint: [1, 1], height: 80, borderRadius: 10, accessibilityLabel: "Fade" });
  expect("dither" in gradient.props).toBe(false);
  expect("borderRadii" in gradient.props).toBe(false);
});

test("points, locations and radii follow the wrapper", () => {
  const warn = console.warn;
  const warnings: unknown[] = [];
  console.warn = (...args: unknown[]) => { warnings.push(args[0]); };
  try {
    expect(gradientProps({ colors: ["a", "b"], start: [0.2, 0.3], end: { x: 1, y: 0 } }, "android")).toEqual({ colors: ["a", "b"], locations: undefined, startPoint: [0.2, 0.3], endPoint: [1, 0], dither: undefined });
    expect(gradientProps({ colors: ["a", "b"], start: null, end: [1, 2, 3] as never, locations: [0, 1, 1], dither: true }, "ios")).toEqual({ colors: ["a", "b"], locations: [0, 1], startPoint: undefined, endPoint: undefined, dither: undefined });
    expect(gradientProps({ colors: ["a"], dither: true }, "android").dither).toBe(true);
  } finally {
    console.warn = warn;
  }
  expect(warnings).toEqual(["LinearGradient colors and locations props should be arrays of the same length", "start and end props for LinearGradient must be of the format [x,y] or {x, y}"]);
  expect(borderRadii({})).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
  expect(borderRadii({ borderRadius: 6, borderBottomRightRadius: 1 })).toEqual([6, 6, 6, 6, 1, 1, 6, 6]);
});
