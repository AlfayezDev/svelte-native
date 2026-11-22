import { expect, test } from "bun:test";
import { createHarness, find, settle } from "./support/harness.ts";
import { loadLibrary } from "./support/library.ts";
import { cornerRadiiFromStyle, shadowStyle, shadowedParts } from "../../src/fabric/foreign-shadow.ts";

/**
 * react-native-fast-shadow (SPEC.md, "Foreign views"): Android's `FastShadowView` paints a nine-patch shadow behind its own
 * background from the corner radii the wrapper reads off the style (compared below with the library's own `ShadowedView`); iOS draws
 * shadows itself, so there `ShadowedView` is a plain view. Android's component keeps the children in the engine: the native view
 * fills a container behind them, with the shadow, the background, the border and the radii.
 */
type App = { setColor(color: string): void; shadowHandle(): { tag: number } | null };
const name = "FastShadowView";
const radii = { topLeft: 2, topRight: 10, bottomLeft: 10, bottomRight: 10 };

test("Android: the native view fills a container of the engine's views and takes the shadow, background, border and radii; the container keeps the layout", async () => {
  const harness = createHarness("android");
  const loaded = await harness.load("shadow-fixture.svelte");
  const app = loaded.startSurface(141, loaded.Fixture, {}) as App;
  const roots = harness.roots()[141];
  const shadow = find(roots, name)[0];
  const container = find(roots, "RCTView").find((node) => node.children.includes(shadow));
  // The content is the container's child after the native view, so it draws above the shadow and takes touches in JavaScript.
  expect(container?.children.map((node) => node.name)).toEqual([name, "RCTText"]);
  expect(container?.props).toMatchObject({ padding: 8, margin: 4, opacity: 0.9, width: 120, borderWidth: 1, accessibilityLabel: "card" });
  for (const key of ["shadowColor", "shadowOpacity", "shadowRadius", "shadowOffset", "backgroundColor", "borderRadius", "borderTopLeftRadius", "borderColor"]) expect(key in (container?.props ?? {}), key).toBe(false);
  expect(shadow.props).toMatchObject({
    shadowColor: 0xff112233 | 0, shadowOpacity: 0.4, shadowRadius: 12, shadowOffset: { width: 5, height: 3 }, cornerRadii: radii, pointerEvents: "none",
    backgroundColor: 0xffffffff | 0, borderRadius: 10, borderTopLeftRadius: 2, borderWidth: 1, borderColor: 0xffcccccc | 0,
    // The container keeps the border width (1), so the native view reaches out of its padding box by it and covers the border box (`native-host/shadow-geometry.test.ts` asks Yoga).
    position: "absolute", left: -1, top: -1, right: -1, bottom: -1,
  });
  for (const key of ["padding", "margin", "opacity", "width", "style", "nativeProps", "component", "ref", "children"]) expect(key in shadow.props, key).toBe(false);
  harness.expectToldFirst(name);
  expect(typeof app.shadowHandle()?.tag).toBe("number");

  // A new colour is a clone of the same node.
  harness.calls.length = 0;
  app.setColor("#ff0000");
  await settle(loaded);
  expect(harness.calls.filter((call) => call.startsWith("create"))).toEqual([]);
  expect(find(harness.roots()[141], name)[0].props.shadowColor).toBe(-65536);
});

test("iOS: a plain view that keeps the shadow in its own style, as the library's alias of View does", async () => {
  const harness = createHarness("ios");
  const loaded = await harness.load("shadow-fixture.svelte");
  loaded.startSurface(142, loaded.Fixture, {});
  const roots = harness.roots()[142];
  expect(find(roots, name)).toEqual([]);
  expect(harness.calls.filter((call) => call.startsWith("engine.registerForeign"))).toEqual([]);
  const [view] = find(roots, "RCTView");
  expect(view.props).toMatchObject({ shadowColor: 0xff112233, shadowOpacity: 0.4, shadowRadius: 12, shadowOffset: { width: 5, height: 3 }, backgroundColor: 0xffffffff, borderRadius: 10, padding: 8, accessibilityLabel: "card" });
});

test("iOS: the view is laid out by the author's style alone, so it is as large as its content or its width, never the parent's width", async () => {
  const harness = createHarness("ios");
  const loaded = await harness.load("shadow-fixture.svelte");
  loaded.startSurface(143, loaded.Fixture, {});
  const [view] = find(harness.roots()[143], "RCTView");
  // No absolute fill, no flex and no alignment of its own: whatever size Yoga gives the card is the size the author's style asks for (the iPhone's native view is the size the engine measured).
  for (const key of ["position", "left", "top", "right", "bottom", "flex", "flexGrow", "flexShrink", "flexBasis", "alignSelf", "minWidth", "height"]) expect(key in view.props, key).toBe(false);
  expect(view.props.width).toBe(120);
  expect(view.children.map((node) => node.name)).toEqual(["RCTText"]);
});

test("the style is split between the box and the container: the box takes what it paints, both keep the border widths", () => {
  const parts = shadowedParts([{ shadowOpacity: 0.5, backgroundColor: "red", borderTopEndRadius: 3, borderBottomWidth: 2, borderBottomColor: "blue", margin: 1, flex: 1 }, undefined, { shadowRadius: 4, overflow: "hidden" }], false);
  expect(parts.shadow).toEqual({ shadowOpacity: 0.5, shadowRadius: 4 });
  expect(parts.box).toEqual({ backgroundColor: "red", borderTopEndRadius: 3, borderBottomWidth: 2, borderBottomColor: "blue" });
  expect(parts.content).toEqual({ borderBottomWidth: 2, margin: 1, flex: 1, overflow: "hidden" });
  expect(parts.cornerRadii).toEqual({ topLeft: 0, topRight: 3, bottomLeft: 0, bottomRight: 0 });
});

// The library's own `ShadowedView` (its Android file) and `shadowStyle`, bundled with React Native stubbed, answer what ours answers. The stand-in for `react-native` reads the
// direction and the platform from `state`, which the bundle exports for the test to set.
type Library = {
  ShadowedView: new (props: object) => { render(): { props: { cornerRadii: object } } };
  shadowStyle(params: object): object;
  state: { rtl: boolean; platform: string };
};
const library = () => loadLibrary<Library>({
  entry: `export { ShadowedView } from "react-native-fast-shadow/src/ShadowedView.android.tsx"; export { shadowStyle } from "react-native-fast-shadow/src/utils.ts"; export { state } from "shadow-state";`,
  conditions: ["browser"],
  stubs: [
    ["shadow-state", "export const state = { rtl: false, platform: 'android' };"],
    [/^react-native$/, `import { state } from "shadow-state";
      const flatten = (style) => (Array.isArray(style) ? style.reduce((all, item) => Object.assign(all, flatten(item)), {}) : style || {});
      export const I18nManager = { get isRTL() { return state.rtl; } };
      export const StyleSheet = { flatten };
      export const Platform = { select: (options) => options[state.platform] ?? options.default };`],
    [/\/FastShadowView$/, "export const FastShadowView = 'FastShadowView';"],
  ],
});

test("the corner radii are the library's, for every spelling of a radius and in both directions", async () => {
  const reference = await library();
  const styles: unknown[] = [
    undefined, {}, { opacity: 1 }, { backgroundColor: "red" }, { borderRadius: 8 }, { borderTopLeftRadius: 3 }, { borderRadius: 8, borderTopLeftRadius: 1, borderBottomRightRadius: 2 },
    { borderTopStartRadius: 4, borderTopEndRadius: 5, borderBottomStartRadius: 6, borderBottomEndRadius: 7 },
    { borderRadius: 9, borderTopStartRadius: 4, borderTopLeftRadius: 1, borderBottomEndRadius: 6 },
    [{ borderRadius: 2 }, null, { borderBottomLeftRadius: 5 }], [{ backgroundColor: "blue" }, [{ borderTopRightRadius: 12 }]], { borderRadius: 0, shadowOpacity: 1 },
  ];
  for (const rtl of [false, true]) {
    reference.state.rtl = rtl;
    for (const style of styles) {
      const expected = new reference.ShadowedView({ style }).render().props.cornerRadii;
      expect(cornerRadiiFromStyle(style, rtl) ?? { topLeft: 0, topRight: 0, bottomLeft: 0, bottomRight: 0 }, `${rtl ? "rtl " : ""}${JSON.stringify(style)}`).toEqual(expected);
      expect(shadowedParts(style, rtl).cornerRadii).toEqual(expected);
    }
  }
});

test("shadowStyle halves the radius on iOS, as the library's does", async () => {
  const reference = await library();
  const inputs = [{}, { color: "#000", opacity: 0.4, radius: 12, offset: [5, 3] as [number, number] }, { radius: 0 }, { opacity: 1, offset: [0, 0] as [number, number] }];
  for (const platform of ["android", "ios"] as const) {
    reference.state.platform = platform;
    for (const input of inputs) expect(shadowStyle(input, platform), `${platform} ${JSON.stringify(input)}`).toEqual(reference.shadowStyle(input));
  }
});
