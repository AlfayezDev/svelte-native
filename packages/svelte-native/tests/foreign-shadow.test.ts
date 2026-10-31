import { afterAll, beforeAll, expect, test } from "bun:test";
import { build } from "esbuild";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { createHarness, find, settle } from "./foreign-harness.ts";
import { cornerRadiiFromStyle, shadowStyle, shadowedParts } from "../src/fabric/foreign-shadow.ts";

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
  const loaded = await harness.load("foreign-shadow-fixture.svelte");
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
    // The container keeps the border width (1), so the native view reaches out of its padding box by it and covers the border box (`foreign-shadow-geometry.test.ts` asks Yoga).
    position: "absolute", left: -1, top: -1, right: -1, bottom: -1,
  });
  for (const key of ["padding", "margin", "opacity", "width", "style", "nativeProps", "component", "ref", "children"]) expect(key in shadow.props, key).toBe(false);
  expect(harness.calls.indexOf(`engine.registerForeign ${name}`)).toBeGreaterThanOrEqual(0);
  expect(harness.calls.indexOf(`engine.registerForeign ${name}`)).toBeLessThan(harness.calls.indexOf(`create ${name}`));
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
  const loaded = await harness.load("foreign-shadow-fixture.svelte");
  loaded.startSurface(142, loaded.Fixture, {});
  const roots = harness.roots()[142];
  expect(find(roots, name)).toEqual([]);
  expect(harness.calls.filter((call) => call.startsWith("engine.registerForeign"))).toEqual([]);
  const [view] = find(roots, "RCTView");
  expect(view.props).toMatchObject({ shadowColor: 0xff112233, shadowOpacity: 0.4, shadowRadius: 12, shadowOffset: { width: 5, height: 3 }, backgroundColor: 0xffffffff, borderRadius: 10, padding: 8, accessibilityLabel: "card" });
});

test("the style is split between the box and the container: the box takes what it paints, both keep the border widths", () => {
  const parts = shadowedParts([{ shadowOpacity: 0.5, backgroundColor: "red", borderTopEndRadius: 3, borderBottomWidth: 2, borderBottomColor: "blue", margin: 1, flex: 1 }, undefined, { shadowRadius: 4, overflow: "hidden" }], false);
  expect(parts.shadow).toEqual({ shadowOpacity: 0.5, shadowRadius: 4 });
  expect(parts.box).toEqual({ backgroundColor: "red", borderTopEndRadius: 3, borderBottomWidth: 2, borderBottomColor: "blue" });
  expect(parts.content).toEqual({ borderBottomWidth: 2, margin: 1, flex: 1, overflow: "hidden" });
  expect(parts.cornerRadii).toEqual({ topLeft: 0, topRight: 3, bottomLeft: 0, bottomRight: 0 });
});

// The library's own `ShadowedView` (its Android file) and `shadowStyle`, bundled with React Native stubbed, answer what ours answers.
type Library = { ShadowedView: new (props: object) => { render(): { props: { cornerRadii: object } } }; shadowStyle(params: object): object };
let library: Library;
let directory = "";
beforeAll(async () => {
  const bundle = await build({
    stdin: {
      contents: `export { ShadowedView } from "react-native-fast-shadow/src/ShadowedView.android.tsx"; export { shadowStyle } from "react-native-fast-shadow/src/utils.ts";`,
      resolveDir: resolve(import.meta.dirname, "../../../node_modules"),
    },
    bundle: true, format: "esm", platform: "neutral", write: false, mainFields: ["main"], conditions: ["browser"],
    plugins: [{
      name: "fast-shadow-stubs",
      setup(builder) {
        builder.onResolve({ filter: /^react-native$|\/FastShadowView$/ }, (args) => ({ path: args.path, namespace: "stub" }));
        builder.onLoad({ filter: /.*/, namespace: "stub" }, (args) => ({
          contents: args.path === "react-native"
            ? `const flatten = (style) => (Array.isArray(style) ? style.reduce((all, item) => Object.assign(all, flatten(item)), {}) : style || {});
               export const I18nManager = { get isRTL() { return globalThis.__shadowRtl === true; } };
               export const StyleSheet = { flatten };
               export const Platform = { select: (options) => options[globalThis.__shadowPlatform] ?? options.default };`
            : "export const FastShadowView = 'FastShadowView';",
          loader: "js",
        }));
      },
    }],
  });
  directory = await mkdtemp(resolve(tmpdir(), "svelte-native-fast-shadow-"));
  const file = resolve(directory, "library.mjs");
  await writeFile(file, bundle.outputFiles[0].contents);
  library = await import(pathToFileURL(file).href) as Library;
});
afterAll(async () => { await rm(directory, { recursive: true }); });

test("the corner radii are the library's, for every spelling of a radius and in both directions", () => {
  const styles: unknown[] = [
    undefined, {}, { opacity: 1 }, { backgroundColor: "red" }, { borderRadius: 8 }, { borderTopLeftRadius: 3 }, { borderRadius: 8, borderTopLeftRadius: 1, borderBottomRightRadius: 2 },
    { borderTopStartRadius: 4, borderTopEndRadius: 5, borderBottomStartRadius: 6, borderBottomEndRadius: 7 },
    { borderRadius: 9, borderTopStartRadius: 4, borderTopLeftRadius: 1, borderBottomEndRadius: 6 },
    [{ borderRadius: 2 }, null, { borderBottomLeftRadius: 5 }], [{ backgroundColor: "blue" }, [{ borderTopRightRadius: 12 }]], { borderRadius: 0, shadowOpacity: 1 },
  ];
  const scope = globalThis as { __shadowRtl?: boolean };
  for (const rtl of [false, true]) {
    scope.__shadowRtl = rtl;
    for (const style of styles) {
      const reference = new library.ShadowedView({ style }).render().props.cornerRadii;
      expect(cornerRadiiFromStyle(style, rtl) ?? { topLeft: 0, topRight: 0, bottomLeft: 0, bottomRight: 0 }, `${rtl ? "rtl " : ""}${JSON.stringify(style)}`).toEqual(reference);
      expect(shadowedParts(style, rtl).cornerRadii).toEqual(reference);
    }
  }
  scope.__shadowRtl = undefined;
});

test("shadowStyle halves the radius on iOS, as the library's does", () => {
  const scope = globalThis as { __shadowPlatform?: string };
  const inputs = [{}, { color: "#000", opacity: 0.4, radius: 12, offset: [5, 3] as [number, number] }, { radius: 0 }, { opacity: 1, offset: [0, 0] as [number, number] }];
  for (const platform of ["android", "ios"] as const) {
    scope.__shadowPlatform = platform;
    for (const input of inputs) expect(shadowStyle(input, platform), `${platform} ${JSON.stringify(input)}`).toEqual(library.shadowStyle(input));
  }
  scope.__shadowPlatform = undefined;
});
