import { describe, expect, spyOn, test } from "bun:test";
import { resolve } from "node:path";
import { applyAriaProps, isAriaKey } from "../../src/fabric/accessibility.ts";
import { type Platform, baseStubs, load, src } from "../support/bundle.ts";
import { type FakeNode, flatten, settle } from "../support/host.ts";
import { fakeHost } from "../support/fake-host.ts";

/**
 * `aria-*` is resolved in React Native's `View.js` (the branch for `enableNativeViewPropTransformations` being off, its default); the host has no `View.js`, so
 * `src/fabric/accessibility.ts` does it, once for both platforms. The first half pins that function, on the values of a React component and on the strings plain HTML writes;
 * the second half runs the host. The rules of `View.js` that the function mirrors are pinned in `upstream/react-native-aria.test.ts`.
 */
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

  test("aria-labelledby is a list of ids, written with commas as React Native does or with the whitespace HTML uses", () => {
    expect(aria({ "aria-labelledby": "one, two ,three" })).toEqual({ accessibilityLabelledBy: ["one", "two", "three"] });
    expect(aria({ "aria-labelledby": "heading, help,, extra" })).toEqual({ accessibilityLabelledBy: ["heading", "help", "extra"] });
    expect(aria({ "aria-labelledby": " heading\t help\nextra " })).toEqual({ accessibilityLabelledBy: ["heading", "help", "extra"] });
    expect(aria({ "aria-labelledby": "  " })).toEqual({ accessibilityLabelledBy: [] });
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

  test("the strings plain HTML writes: booleans reach Fabric as booleans (mixed stays mixed), numbers as numbers, value text stays text", () => {
    expect(aria({ "aria-hidden": "true", "aria-disabled": "false", "aria-expanded": "true", "aria-checked": "mixed" }))
      .toEqual({ accessibilityElementsHidden: true, importantForAccessibility: "no-hide-descendants", accessibilityState: { disabled: false, expanded: true, checked: "mixed" } });
    expect(aria({ "aria-hidden": "false" })).toEqual({ accessibilityElementsHidden: false });
    expect(aria({ "aria-valuemin": "0", "aria-valuemax": "100", "aria-valuenow": "12.5", "aria-valuetext": "12.5" }))
      .toEqual({ accessibilityValue: { min: 0, max: 100, now: 12.5, text: "12.5" } });
  });

  test("a null alias says nothing and leaves the plain prop alone; a key nobody set is not in the object", () => {
    expect(aria({ "aria-checked": null, accessibilityState: { disabled: true } })).toEqual({ accessibilityState: { disabled: true } });
    expect(aria({ "aria-selected": null })).toEqual({});
    expect(aria({ "aria-checked": true })).toEqual({ accessibilityState: { checked: true } });
    expect(aria({ "aria-label": null, "aria-live": null, "aria-hidden": null, accessibilityLabel: "Kept", accessibilityLiveRegion: "polite", accessibilityElementsHidden: true }))
      .toEqual({ accessibilityLabel: "Kept", accessibilityLiveRegion: "polite", accessibilityElementsHidden: true });
  });

  test("the aliases are consumed and everything else is kept, role included", () => {
    const result = aria({ role: "slider", "aria-valuenow": 1, testID: "x", accessibilityHint: "Hint", style: { flex: 1 } });
    expect(Object.keys(result).sort()).toEqual(["accessibilityHint", "accessibilityValue", "role", "style", "testID"]);
    expect(isAriaKey("aria-label") && isAriaKey("aria-valuetext")).toBe(true);
    expect(isAriaKey("accessibilityLabel") || isAriaKey("arial") || isAriaKey("role")).toBe(false);
  });

  test("a props bag without an alias comes out equal", () => {
    const props = { accessibilityLabel: "Same", accessibilityState: { selected: true } };
    expect(aria(props)).toEqual(props);
  });
});

const host = fakeHost();

type Mounted = { startSurface: typeof import("../../src/fabric/host.ts").startSurface; tick: () => Promise<void>; Fixture: never };
type App = { setChecked(next: boolean): void; setLabel(next: string): void; setHidden(next: boolean): void; actionLog(): string[] };

/** The Android engine installed (`SvelteEngine.install` answers true), or no native module at all. */
const engineStub = "export const requireOptionalNativeModule = (name) => name === 'SvelteEngine' ? { install: () => true, addListener: () => ({ remove() {} }), getInsets: () => null } : null;";
const mount = (platform: Platform, engine = false) => load<Mounted>({
  entry: `import Fixture from ${JSON.stringify(resolve(import.meta.dirname, "fixtures/accessibility-fixture.svelte"))};
    import { startSurface } from ${JSON.stringify(src("fabric/host.ts"))};
    import { tick } from 'svelte';
    export { startSurface, tick, Fixture };`,
  platform,
  stubs: { ...baseStubs(platform), ...(engine ? { "expo-modules-core": engineStub } : {}) },
});

const byId = (root: number, testID: string) => flatten(host.roots[root] ?? []).find((node) => node.props.testID === testID) as FakeNode;

describe("accessibilityLabelledBy on the Android engine", () => {
  async function warnings(engine: boolean, development: boolean): Promise<string[]> {
    const warned: string[] = [];
    const warn = spyOn(console, "warn").mockImplementation((...args: unknown[]) => { warned.push(args.map(String).join(" ")); });
    (globalThis as { __DEV__?: boolean }).__DEV__ = development;
    try {
      const m = await mount("android", engine);
      const app = m.startSurface(26, m.Fixture, {}) as App;
      app.setLabel("Again");
      await settle(m);
      expect(byId(26, "named").props.accessibilityLabelledBy).toEqual(["terms", "other"]); // the prop still reaches the shadow tree: React Native's own mounting reads it
    } finally { warn.mockRestore(); }
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

describe.each(["android", "ios"] as const)("the host on %s", (platform) => {
  test("aria props reach the shadow tree as the accessibility props the engine encodes, and follow their updates", async () => {
    const m = await mount(platform);
    const app = m.startSurface(21, m.Fixture, {}) as App;
    const box = byId(21, "box");
    expect(box.props).toMatchObject({ role: "checkbox", accessibilityState: { checked: true }, accessibilityLabel: "Terms" });
    expect(Object.keys(box.props).filter(isAriaKey)).toEqual([]);
    const plain = byId(21, "plain");
    expect(plain.props).toMatchObject({ accessibilityState: { busy: true, selected: true }, accessibilityValue: { max: 10, min: 0, now: 4, text: "four" } });
    expect(byId(21, "bare").props).toMatchObject({ accessibilityLabel: "Bare", accessibilityState: { disabled: true } });

    app.setChecked(false);
    app.setLabel("Terms and conditions");
    app.setHidden(true);
    await settle(m);
    expect(byId(21, "box").props).toMatchObject({ accessibilityState: { checked: false }, accessibilityLabel: "Terms and conditions" });
    // What `aria-hidden` becomes is the platform's: Android hides the descendants, iOS the elements (React Native's own view configs).
    const hidden = byId(21, "plain").props;
    if (platform === "android") expect(hidden.importantForAccessibility).toBe("no-hide-descendants");
    else expect(hidden.accessibilityElementsHidden).toBe(true);
  });

  test("onAccessibilityAction receives the engine's topAccessibilityAction with the action name", async () => {
    const m = await mount(platform);
    const app = m.startSurface(22, m.Fixture, {}) as App;
    const box = byId(22, "box");
    host.emit(box.target, "topAccessibilityAction", { actionName: "archive" });
    host.emit(box.target, "topAccessibilityAction", { actionName: "activate" });
    expect(app.actionLog()).toEqual(["archive", "activate"]);
    // A view with no handler, and the other view's handler, are left alone.
    host.emit(byId(22, "bare").target, "topAccessibilityAction", { actionName: "archive" });
    expect(app.actionLog()).toEqual(["archive", "activate"]);
  });
});

test("on Android the actions and the live region reach the shadow tree, and aria-hidden={false} sets nothing React Native's Android view config reads", async () => {
  const m = await mount("android");
  m.startSurface(24, m.Fixture, {});
  expect(byId(24, "box").props).toMatchObject({ accessibilityLiveRegion: "none", accessibilityActions: [{ name: "archive", label: "Archive" }, { name: "activate" }] });
  const plain = byId(24, "plain");
  expect(plain.props.importantForAccessibility).toBeUndefined(); // aria-hidden={false}
  expect("accessibilityElementsHidden" in plain.props).toBe(false); // iOS only in React Native's Android view config
});

test("on iOS aria-hidden={false} reaches the shadow tree as accessibilityElementsHidden: false", async () => {
  const m = await mount("ios");
  m.startSurface(25, m.Fixture, {});
  expect(byId(25, "plain").props.accessibilityElementsHidden).toBe(false);
});
