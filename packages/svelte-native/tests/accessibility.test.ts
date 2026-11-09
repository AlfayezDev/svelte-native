import { afterAll, describe, expect, test } from "bun:test";
import { build } from "esbuild";
import { readFile, mkdtemp, writeFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { compile } from "svelte/compiler";
import { reanimatedStubs } from "./reanimated-stubs.ts";
import { reactNativeConverters, type Platform } from "./rn-reference.ts";
import { applyAriaProps, isAriaKey } from "../src/fabric/accessibility.ts";

// `aria-*` is resolved in React Native's `View.js` (the branch for `enableNativeViewPropTransformations` being off, its default); the host has no
// `View.js`, so `src/fabric/accessibility.ts` does it, once for both platforms. The first half pins that function; the second half runs the host.

const aria = (props: Record<string, unknown>) => {
  const copy = { ...props };
  applyAriaProps(copy);
  return copy;
};

describe("applyAriaProps, the rules of React Native's View.js", () => {
  test("aria-label becomes accessibilityLabel and wins over it", () => {
    expect(aria({ "aria-label": "Save" })).toEqual({ accessibilityLabel: "Save" });
    expect(aria({ accessibilityLabel: "Old", "aria-label": "New" })).toEqual({ accessibilityLabel: "New" });
    expect(aria({ accessibilityLabel: "Kept", "aria-hidden": false })).toMatchObject({ accessibilityLabel: "Kept" });
  });

  test("aria-live becomes accessibilityLiveRegion, off being none", () => {
    expect(aria({ "aria-live": "polite" })).toEqual({ accessibilityLiveRegion: "polite" });
    expect(aria({ "aria-live": "assertive" })).toEqual({ accessibilityLiveRegion: "assertive" });
    expect(aria({ "aria-live": "off" })).toEqual({ accessibilityLiveRegion: "none" });
  });

  test("aria-hidden becomes accessibilityElementsHidden, and true also hides the descendants for Android", () => {
    expect(aria({ "aria-hidden": true })).toEqual({ accessibilityElementsHidden: true, importantForAccessibility: "no-hide-descendants" });
    expect(aria({ "aria-hidden": false })).toEqual({ accessibilityElementsHidden: false });
    expect(aria({ "aria-hidden": false, importantForAccessibility: "no" })).toEqual({ accessibilityElementsHidden: false, importantForAccessibility: "no" });
  });

  test("aria-labelledby is a list of ids", () => {
    expect(aria({ "aria-labelledby": "one, two ,three" })).toEqual({ accessibilityLabelledBy: ["one", "two", "three"] });
  });

  test("the state aliases are laid over accessibilityState one key each, and win over it", () => {
    expect(aria({ "aria-busy": true, "aria-checked": "mixed", "aria-disabled": false, "aria-expanded": true, "aria-selected": true }))
      .toEqual({ accessibilityState: { busy: true, checked: "mixed", disabled: false, expanded: true, selected: true } });
    expect(aria({ accessibilityState: { disabled: true, selected: false, checked: true }, "aria-selected": true }))
      .toEqual({ accessibilityState: { checked: true, disabled: true, selected: true } });
    expect(aria({ accessibilityState: { selected: true } })).toEqual({ accessibilityState: { selected: true } });
  });

  test("the value aliases are laid over accessibilityValue one key each, and win over it", () => {
    expect(aria({ "aria-valuemin": 0, "aria-valuemax": 100, "aria-valuenow": 40, "aria-valuetext": "40 percent" }))
      .toEqual({ accessibilityValue: { max: 100, min: 0, now: 40, text: "40 percent" } });
    expect(aria({ accessibilityValue: { min: 0, max: 5, now: 1, text: "one" }, "aria-valuenow": 2 }))
      .toEqual({ accessibilityValue: { max: 5, min: 0, now: 2, text: "one" } });
  });

  test("a null alias says nothing and leaves the plain prop alone; a key nobody set is not in the object", () => {
    expect(aria({ "aria-checked": null, accessibilityState: { disabled: true } })).toEqual({ accessibilityState: { disabled: true } });
    expect(aria({ "aria-selected": null })).toEqual({});
    expect(aria({ "aria-checked": true })).toEqual({ accessibilityState: { checked: true } });
  });

  test("the aliases are consumed and everything else is kept, role included", () => {
    const result = aria({ role: "slider", "aria-valuenow": 1, testID: "x", accessibilityHint: "Hint", style: { flex: 1 } });
    expect(Object.keys(result).sort()).toEqual(["accessibilityHint", "accessibilityValue", "role", "style", "testID"]);
    expect(isAriaKey("aria-label") && isAriaKey("aria-valuetext")).toBe(true);
    expect(isAriaKey("accessibilityLabel") || isAriaKey("arial") || isAriaKey("role")).toBe(false);
  });

  test("a props bag without an alias comes out equal", () => {
    const props = { accessibilityLabel: "Same", accessibilityState: { selected: true } };
    const copy = { ...props };
    applyAriaProps(copy);
    expect(copy).toEqual(props);
  });
});

describe("the source being mirrored", () => {
  const reactNative = resolve(createRequire(import.meta.url).resolve("react-native/package.json"), "..");

  // If React Native turns its native transformation on, the shadow node resolves the aliases itself and this file is redundant (and a second
  // pass over the same props is harmless but dead code). If View.js changes a rule, the first test above is out of date. Either is an upgrade to look at.
  test("View.js maps the aliases as accessibility.ts does, and the native transformation is off", async () => {
    const view = await readFile(resolve(reactNative, "Libraries/Components/View/View.js"), "utf8");
    const flags = await readFile(resolve(reactNative, "src/private/featureflags/ReactNativeFeatureFlags.js"), "utf8");
    expect(flags).toContain("enableNativeViewPropTransformations: Getter<boolean> = createNativeFlagGetter('enableNativeViewPropTransformations', false)");
    for (const rule of [
      "processedProps.accessibilityLabel = ariaLabel;",
      "ariaLive === 'off' ? 'none' : ariaLive;",
      "processedProps.accessibilityElementsHidden = ariaHidden;",
      "processedProps.importantForAccessibility = 'no-hide-descendants';",
      "ariaLabelledBy?.split(/\\s*,\\s*/g)",
      "busy: ariaBusy ?? accessibilityState?.busy,",
      "checked: ariaChecked ?? accessibilityState?.checked,",
      "disabled: ariaDisabled ?? accessibilityState?.disabled,",
      "expanded: ariaExpanded ?? accessibilityState?.expanded,",
      "selected: ariaSelected ?? accessibilityState?.selected,",
      "max: ariaValueMax ?? accessibilityValue?.max,",
      "min: ariaValueMin ?? accessibilityValue?.min,",
      "now: ariaValueNow ?? accessibilityValue?.now,",
      "text: ariaValueText ?? accessibilityValue?.text,",
    ]) expect(view).toContain(rule);
  });
});

type FakeNode = { tag: number; name: string; props: Record<string, unknown>; children: FakeNode[]; target?: unknown };
let roots: Record<number, FakeNode[]> = {};
let handler: ((target: unknown, type: string, event: object) => void) | undefined;
const fake = {
  createNode(tag: number, name: string, _root: number, props: Record<string, unknown>, target: unknown): FakeNode { return { tag, name, props: { ...props }, children: [], target }; },
  cloneNodeWithNewChildren(node: FakeNode): FakeNode { return { ...node, children: [] }; },
  cloneNodeWithNewProps(node: FakeNode, props: Record<string, unknown>): FakeNode { return { ...node, props: { ...node.props, ...props }, children: [...node.children] }; },
  cloneNodeWithNewChildrenAndProps(node: FakeNode, props: Record<string, unknown>): FakeNode { return { ...node, props: { ...node.props, ...props }, children: [] }; },
  appendChild(parent: FakeNode, child: FakeNode) { parent.children.push(child); },
  createChildSet(root: number) { return { root, children: [] as FakeNode[] }; },
  appendChildToSet(set: { children: FakeNode[] }, child: FakeNode) { set.children.push(child); },
  completeRoot(root: number, set: { children: FakeNode[] }) { roots[root] = set.children; },
  registerEventHandler(next: typeof handler) { handler = next; },
};
const scope = globalThis as { nativeFabricUIManager?: unknown };
scope.nativeFabricUIManager = fake;
afterAll(() => { delete scope.nativeFabricUIManager; });

async function load(platform: Platform, engine = false) {
  const stubs: Record<string, string> = {
    ...reanimatedStubs,
    "react-native/Libraries/Utilities/Platform": `export default { OS: '${platform}', Version: 34 };`,
    "react-native/Libraries/Image/resolveAssetSource": "export default () => null;",
    "react-native/Libraries/Components/View/ViewNativeComponent": "export {};",
    "react-native/Libraries/Text/TextNativeComponent": "export {};",
    "react-native/Libraries/Components/ScrollView/ScrollViewNativeComponent": "export {};",
    // The Android engine installed (`SvelteEngine.install` answers true), or no native module at all.
    "expo-modules-core": engine
      ? "export const requireOptionalNativeModule = (name) => name === 'SvelteEngine' ? { install: () => true, addListener: () => ({ remove() {} }), getInsets: () => null } : null;"
      : "export const requireOptionalNativeModule = () => null;",
    "react-native": "export const AppRegistry = { registerRunnable() {} };",
  };
  const bundle = await build({
    stdin: {
      contents: `import Fixture from './accessibility-fixture.svelte';
        import { startSurface, flush } from '../src/fabric/host.ts';
        import { tick } from 'svelte';
        export { startSurface, flush, tick, Fixture };`,
      resolveDir: import.meta.dirname,
    },
    bundle: true, format: "esm", platform: "neutral", conditions: ["browser"], mainFields: ["main"], write: false,
    plugins: [...reactNativeConverters(platform), {
      name: "accessibility-fixture",
      setup(builder) {
        builder.onResolve({ filter: /^(react-native|expo-modules-core)/ }, (args) => (args.path.startsWith("react-native-gesture-handler") ? undefined : { path: args.path, namespace: "stub" }));
        builder.onLoad({ filter: /.*/, namespace: "stub" }, (args) => ({ contents: stubs[args.path] ?? "export {};", loader: "js" }));
        builder.onResolve({ filter: /^@example\/svelte-native\/renderer$/ }, () => ({ path: resolve(import.meta.dirname, "../src/renderer.ts") }));
        builder.onResolve({ filter: /^esm-env$/ }, () => ({ path: resolve(import.meta.dirname, "../src/environment.ts") }));
        builder.onLoad({ filter: /\.svelte$/ }, async ({ path }) => ({
          contents: compile(await readFile(path, "utf8"), { filename: path, css: "external", dev: false, experimental: { customRenderer: "@example/svelte-native/renderer" } }).js.code,
          loader: "js",
        }));
      },
    }],
  });
  const directory = await mkdtemp(resolve(tmpdir(), "svelte-native-a11y-"));
  const file = resolve(directory, "bundle.mjs");
  await writeFile(file, bundle.outputFiles[0].contents);
  const m = await import(pathToFileURL(file).href);
  await rm(directory, { recursive: true });
  return m;
}

const views = (nodes: FakeNode[]): FakeNode[] => nodes.flatMap((n) => [n, ...views(n.children)]);
const byId = (root: number, testID: string) => views(roots[root] ?? []).find((n) => n.props.testID === testID) as FakeNode;
const settle = async (m: { tick: () => Promise<void> }) => { await m.tick(); await Promise.resolve(); await Promise.resolve(); };
const emit = (target: unknown, type: string, event: object) => (handler as NonNullable<typeof handler>)(target, type, event);
type App = { setChecked(next: boolean): void; setLabel(next: string): void; setHidden(next: boolean): void; actionLog(): string[] };

describe("accessibilityLabelledBy on the Android engine", () => {
  const dev = globalThis as { __DEV__?: boolean };
  async function warnings(engine: boolean, development: boolean): Promise<string[]> {
    const warned: string[] = [];
    const warn = console.warn;
    console.warn = (...args: unknown[]) => { warned.push(args.map(String).join(" ")); };
    dev.__DEV__ = development;
    try {
      const m = await load("android", engine);
      roots = {};
      const app = m.startSurface(26, m.Fixture, {}) as App;
      app.setLabel("Again");
      await settle(m);
      expect(byId(26, "named").props.accessibilityLabelledBy).toEqual(["terms", "other"]); // the prop still reaches the shadow tree: React Native's own mounting reads it
    } finally { console.warn = warn; delete dev.__DEV__; }
    return warned.filter((line) => line.includes("accessibilityLabelledBy"));
  }

  test("the engine ignores it, so development says so, once", async () => {
    const lines = await warnings(true, true);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("aria-labelledby");
    expect(lines[0]).toContain("Android");
  });

  test("it says nothing in a release build, nor when React Native's own mounting reads the prop", async () => {
    expect(await warnings(true, false)).toEqual([]);
    expect(await warnings(false, true)).toEqual([]);
  });
});

describe("the host on Android", () => {
  test("aria props reach the shadow tree as the accessibility props the engine encodes, and follow their updates", async () => {
    const m = await load("android");
    roots = {};
    const app = m.startSurface(21, m.Fixture, {}) as App;
    const box = byId(21, "box");
    expect(box.props).toMatchObject({
      role: "checkbox", accessibilityState: { checked: true }, accessibilityLabel: "Terms", accessibilityLiveRegion: "none",
      accessibilityActions: [{ name: "archive", label: "Archive" }, { name: "activate" }],
    });
    expect(Object.keys(box.props).filter(isAriaKey)).toEqual([]);
    const plain = byId(21, "plain");
    expect(plain.props.accessibilityState).toEqual({ busy: true, selected: true });
    expect(plain.props.accessibilityValue).toEqual({ max: 10, min: 0, now: 4, text: "four" });
    expect(plain.props.importantForAccessibility).toBeUndefined(); // aria-hidden={false}
    expect("accessibilityElementsHidden" in plain.props).toBe(false); // iOS only in React Native's Android view config

    app.setChecked(false);
    app.setLabel("Terms and conditions");
    app.setHidden(true);
    await settle(m);
    expect(byId(21, "box").props).toMatchObject({ accessibilityState: { checked: false }, accessibilityLabel: "Terms and conditions" });
    expect(byId(21, "plain").props.importantForAccessibility).toBe("no-hide-descendants");
    expect(byId(21, "bare").props).toMatchObject({ accessibilityLabel: "Bare", accessibilityState: { disabled: true } });
  });

  test("onAccessibilityAction receives the engine's topAccessibilityAction with the action name", async () => {
    const m = await load("android");
    roots = {};
    const app = m.startSurface(22, m.Fixture, {}) as App;
    const box = byId(22, "box");
    emit(box.target, "topAccessibilityAction", { actionName: "archive" });
    emit(box.target, "topAccessibilityAction", { actionName: "activate" });
    expect(app.actionLog()).toEqual(["archive", "activate"]);
    // A view with no handler, and the other view's handler, are left alone.
    emit(byId(22, "bare").target, "topAccessibilityAction", { actionName: "archive" });
    expect(app.actionLog()).toEqual(["archive", "activate"]);
  });
});

describe("the host on iOS", () => {
  test("the same aliases are resolved, for React Native's own views", async () => {
    const m = await load("ios");
    roots = {};
    const app = m.startSurface(23, m.Fixture, {}) as App;
    const box = byId(23, "box");
    expect(box.props).toMatchObject({ role: "checkbox", accessibilityState: { checked: true }, accessibilityLabel: "Terms" });
    expect(Object.keys(box.props).filter(isAriaKey)).toEqual([]);
    expect(byId(23, "plain").props).toMatchObject({ accessibilityState: { busy: true, selected: true }, accessibilityElementsHidden: false });
    app.setHidden(true);
    await settle(m);
    expect(byId(23, "plain").props).toMatchObject({ accessibilityElementsHidden: true });
    emit(box.target, "topAccessibilityAction", { actionName: "archive" });
    expect(app.actionLog()).toEqual(["archive"]);
  });
});
