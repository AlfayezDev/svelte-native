import { expect, spyOn, test } from "bun:test";
import { createHarness, expoViewConfigs, find, settle } from "./support/harness.ts";
import { borderRadii, gradientProps } from "../../src/fabric/foreign-gradient.ts";

/**
 * expo-linear-gradient and expo-conic-gradient (SPEC.md, "Foreign views"): the native view takes the colours as integers and the library's own geometry (points and corner
 * radii for the linear one; centre and angle for the conic one). On Android both are a container that carries the style, with the gradient filling it behind the children
 * (the children are the engine's views); on iOS the linear gradient view is the container, and the conic one (SwiftUI) is a leaf inside it.
 */
// RN's `processColor`: signed ARGB on Android, unsigned on iOS (#ff0000, rgba(0, 0, 255, 0.5), green).
const colors = { android: [-65536, -2147483393, -16744448], ios: [0xffff0000, 0x800000ff, 0xff008000] };
const fill = { position: "absolute", left: 0, top: 0, right: 0, bottom: 0 };
type App = { setColors(next: unknown[]): void; gradientHandle(): { tag: number } | null };

const linear = {
  library: "expo-linear-gradient", module: "ExpoLinearGradient", name: "ViewManagerAdapter_ExpoLinearGradient", fixture: "gradient-fixture.svelte", surface: 51,
  configs: { "": expoViewConfigs("expo-linear-gradient/android/src/main/java/expo/modules/lineargradient/LinearGradientModule.kt")[""] },
  container: { height: 80, borderRadius: 10, accessibilityLabel: "Fade" },
  // Four locations for three colours: cut to the colours' count, as the wrapper does.
  native: { colors: colors.android, locations: [0, 0.5, 1], startPoint: [0, 0], endPoint: [1, 1], dither: false, borderRadii: [4, 4, 10, 10, 10, 10, 10, 10], ...fill },
  absent: ["start", "end", "ref", "nativeProps", "children", "component"],
  recolor: [["#00ff00", "#0000ff"], [-16711936, -16776961]],
};
const conic = {
  library: "expo-conic-gradient", module: "ConicGradient", name: "ViewManagerAdapter_ConicGradient", fixture: "conic-fixture.svelte", surface: 131,
  configs: { "": expoViewConfigs("expo-conic-gradient/android/src/main/java/expo/modules/conicgradient/ConicGradientModule.kt")[""] },
  container: { height: 80, borderRadius: 10, overflow: "hidden", accessibilityLabel: "Sweep" },
  native: { colors: colors.android, locations: [0, 0.5, 1], center: [0.25, 0.75], angle: 45, ...fill },
  absent: ["style", "ref", "nativeProps", "children", "component"],
  recolor: [["#00ff00", "#0000ff", "#ffffff"], [-16711936, -16776961, -1]],
};

// The fixtures give the linear gradient one location too many on purpose, which the wrapper warns about.
const quietly = () => spyOn(console, "warn").mockImplementation(() => {});

for (const { library, module, name, configs, fixture, surface, container: style, native, absent, recolor } of [linear, conic]) test(`${library}, Android: a container holds the children and the gradient fills it behind them with colours as integers`, async () => {
  const warn = quietly();
  try {
    const harness = createHarness("android", { expo: { [module]: configs } });
    const loaded = await harness.load(fixture);
    const app = loaded.startSurface(surface, loaded.Fixture, {}) as App;
    const roots = harness.roots()[surface];
    const gradient = find(roots, name)[0];
    const container = find(roots, "RCTView").find((node) => node.children.includes(gradient));
    expect(container?.children.map((node) => node.name)).toEqual([name, "RCTText"]);
    expect(container?.props).toMatchObject(style);
    expect(gradient.props).toMatchObject(native);
    for (const key of absent) expect(key in gradient.props, key).toBe(false);
    harness.expectToldFirst(name);
    expect(typeof app.gradientHandle()?.tag).toBe("number");

    // New colours are a clone of the same node, converted again.
    harness.calls.length = 0;
    app.setColors(recolor[0]);
    await settle(loaded);
    expect(harness.calls.filter((call) => call.startsWith("create"))).toEqual([]);
    expect(find(harness.roots()[surface], name)[0].props.colors).toEqual(recolor[1]);
  } finally {
    warn.mockRestore();
  }
});

test("expo-linear-gradient, iOS: the gradient view is the container itself, with the style and the children, and no dither or radii", async () => {
  const warn = quietly();
  try {
    const harness = createHarness("ios", { expo: { ExpoLinearGradient: linear.configs } });
    const loaded = await harness.load("gradient-fixture.svelte");
    loaded.startSurface(52, loaded.Fixture, {});
    const gradient = find(harness.roots()[52], linear.name)[0];
    expect(gradient.children.map((node) => node.name)).toEqual(["RCTText"]);
    expect(gradient.props).toMatchObject({ colors: colors.ios, locations: [0, 0.5, 1], startPoint: [0, 0], endPoint: [1, 1], height: 80, borderRadius: 10, accessibilityLabel: "Fade" });
    expect("dither" in gradient.props).toBe(false);
    expect("borderRadii" in gradient.props).toBe(false);
  } finally {
    warn.mockRestore();
  }
});

test("expo-conic-gradient, iOS: the same container, with the colours unsigned", async () => {
  const harness = createHarness("ios", { expo: { ConicGradient: conic.configs } });
  const loaded = await harness.load("conic-fixture.svelte");
  loaded.startSurface(132, loaded.Fixture, {});
  const roots = harness.roots()[132];
  const gradient = find(roots, conic.name)[0];
  expect(gradient.children).toEqual([]);
  expect(gradient.props).toMatchObject({ colors: colors.ios, locations: [0, 0.5, 1], center: [0.25, 0.75], angle: 45 });
  // The SwiftUI hosting view is the container's size and no more (its content box: the iPhone's `HostingView` is the size the engine measured for the container, inside a border): it fills it from the padding box's four edges, and the children are the container's.
  const container = find(roots, "RCTView").find((node) => node.children.includes(gradient));
  expect(container?.children.map((node) => node.name)).toEqual([conic.name, "RCTText"]);
  expect(container?.props).toMatchObject(conic.container);
  expect(gradient.props).toMatchObject(fill);
  for (const key of ["width", "height", "flex", "alignSelf", "margin", "padding"]) expect(key in gradient.props, key).toBe(false);
});

test("points, locations and radii follow the wrapper", () => {
  const warn = quietly();
  try {
    expect(gradientProps({ colors: ["a", "b"], start: [0.2, 0.3], end: { x: 1, y: 0 } }, "android")).toEqual({ colors: ["a", "b"], locations: undefined, startPoint: [0.2, 0.3], endPoint: [1, 0], dither: undefined });
    expect(gradientProps({ colors: ["a", "b"], start: null, end: [1, 2, 3] as never, locations: [0, 1, 1], dither: true }, "ios")).toEqual({ colors: ["a", "b"], locations: [0, 1], startPoint: undefined, endPoint: undefined, dither: undefined });
    expect(gradientProps({ colors: ["a"], dither: true }, "android").dither).toBe(true);
    expect(warn.mock.calls.map((args) => args[0])).toEqual(["LinearGradient colors and locations props should be arrays of the same length", "start and end props for LinearGradient must be of the format [x,y] or {x, y}"]);
  } finally {
    warn.mockRestore();
  }
  expect(borderRadii({})).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
  expect(borderRadii({ borderRadius: 6, borderBottomRightRadius: 1 })).toEqual([6, 6, 6, 6, 1, 1, 6, 6]);
});
