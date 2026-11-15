import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { baseStubs, load, src, tests } from "../support/bundle.ts";
import { type FakeNode, flatten, settle } from "../support/host.ts";
import { fakeHost } from "../support/fake-host.ts";
import { parseNativeID } from "../../src/fabric/navigation.ts";

/**
 * The iOS bridges of `native/svelte-core/ios/screens` as the host sees them: the view names the host picks per platform for screens, tabs and toolbars (the Svelte components on iOS,
 * `RCTView` on Android, the same nativeIDs), the nine view configs registered once with their events, a Modal that mounts no host while it is hidden, and which elements are accessibility
 * elements. The native decoder that reads those nativeIDs is in `native-host/screens-ios-records.test.ts`.
 */
const host = fakeHost();

const stubs = {
  ...baseStubs(),
  // React Native's registry and `createViewConfig`, recording what the host registers (and refusing a second registration, as the real registry does).
  "react-native/Libraries/Renderer/shims/ReactNativeViewConfigRegistry": "export const register = (name, config) => { const known = (globalThis.__registeredViewConfigs ??= new Map()); if (known.has(name)) throw new Error('Tried to register two views with the same name ' + name); known.set(name, config); return name; }; export const get = () => ({});",
  "react-native/Libraries/NativeComponent/ViewConfig": "export const createViewConfig = (partial) => ({ ...partial, base: true });",
  "react-native/Libraries/Utilities/Platform": "export default { get OS() { return globalThis.__navigationOS ?? 'android'; }, Version: 34 };",
  "react-native/Libraries/Utilities/BackHandler": "export default { addEventListener: () => ({ remove() {} }) };",
  "react-native/Libraries/Components/Keyboard/Keyboard": "export default { isVisible: () => false, dismiss() {} };",
  "react-native/Libraries/Linking/Linking": "export default { addEventListener: () => ({ remove() {} }), getInitialURL: () => Promise.resolve(null) };",
  "expo-modules-core": "export const EventEmitter = class {}; export const requireOptionalNativeModule = () => null;",
};

/** A fixture bundled with the host and the pass-through view configs; the platform is chosen per run by `mount` (the `Platform` stand-in reads it). */
const loadFixture = (path: string) => load<{ startSurface: typeof import("../../src/fabric/host.ts").startSurface; tick: () => Promise<void>; Fixture: never }>({
  entry: `import Fixture from ${JSON.stringify(path)};
    import { startSurface } from ${JSON.stringify(src("fabric/host.ts"))};
    import { tick } from 'svelte';
    export { startSurface, tick, Fixture };`,
  stubs,
  viewConfigs: "pass-through",
  converters: false,
});
/** Screens, tabs and toolbars are fixtures of the navigation tests (`navigation.test.ts`); the Modal and the pressable ones are this file's. */
const shared = (name: string) => resolve(tests, name);
const own = (name: string) => resolve(import.meta.dirname, "fixtures", name);

const environment = globalThis as { __navigationOS?: string; __registeredViewConfigs?: Map<string, () => unknown> };

/** Mounts a fixture on a platform; returns the tags it produced as `[nativeID kind, Fabric component name]` pairs, in tree order. */
async function mount(path: string, platform: "android" | "ios", surface: number) {
  environment.__navigationOS = platform;
  environment.__registeredViewConfigs = new Map();
  try {
    const m = await loadFixture(path);
    host.roots = {};
    m.startSurface(surface, m.Fixture, {});
    await settle(m);
    const nodes = flatten(host.roots[surface]).filter((node: FakeNode) => typeof node.props.nativeID === "string" && node.props.nativeID.startsWith("svelte:"));
    return { pairs: nodes.map((node) => [parseNativeID(String(node.props.nativeID))?.kind, node.name] as const), ids: nodes.map((node) => node.props.nativeID) };
  } finally { delete environment.__navigationOS; }
}

test("a hidden Modal mounts no host on iOS (a hidden RCTModalHostView would take every touch), stays until onDismiss after hiding; Android keeps its host", async () => {
  const emit = (target: unknown, type: string) => host.emit(target, type, {});
  const modals = (surface: number) => flatten(host.roots[surface] ?? []).filter((node) => node.name === "RCTModalHostView" || node.name === "ModalHostView");
  for (const platform of ["ios", "android"] as const) {
    environment.__navigationOS = platform;
    environment.__registeredViewConfigs = new Map();
    try {
      const surface = platform === "ios" ? 66 : 67;
      const m = await loadFixture(own("modal-visible-fixture.svelte"));
      host.roots = {};
      const app = m.startSurface(surface, m.Fixture, {}) as { setOpen(value: boolean): void; dismissed(): number };
      await settle(m);
      if (platform === "android") {
        // The engine's host takes no touches and animates its layer from `visible`: it stays mounted, hidden.
        expect(modals(surface).map((node) => node.props.visible)).toEqual([false]);
        continue;
      }
      expect(modals(surface)).toHaveLength(0);
      app.setOpen(true);
      await settle(m);
      expect(modals(surface).map((node) => node.props.visible)).toEqual([true]);
      // UIKit presented the controller (a window, a finished transition): onShow.
      emit(modals(surface)[0]?.target, "topShow");
      await settle(m);
      app.setOpen(false);
      await settle(m);
      // Still there with visible false while UIKit animates the dismissal; gone once it reports onDismiss.
      expect(modals(surface).map((node) => node.props.visible)).toEqual([false]);
      emit(modals(surface)[0]?.target, "topDismiss");
      await settle(m);
      expect(modals(surface)).toHaveLength(0);
      expect(app.dismissed()).toBe(1);
      app.setOpen(true);
      await settle(m);
      expect(modals(surface)).toHaveLength(1);
      // A Modal toggled true to false while its host has no window (a hidden eager tab pane) is never presented: RN emits onDismiss only
      // for a presented controller, so nothing would unmount the hidden host, and it would swallow the pane's touches. No onShow came:
      // it goes away with `visible`, and no dismissal is reported for a modal that was never shown.
      app.setOpen(false);
      await settle(m);
      expect(modals(surface)).toHaveLength(0);
      expect(app.dismissed()).toBe(1);
      // Presented again, after an onShow of the earlier round; the stale onShow does not count for this one.
      app.setOpen(true);
      await settle(m);
      expect(modals(surface).map((node) => node.props.visible)).toEqual([true]);
      app.setOpen(false);
      await settle(m);
      expect(modals(surface)).toHaveLength(0);
      // The sequence of a window that appears late: visible, still no onShow, then onShow, then hidden: the dismissal animates as usual.
      app.setOpen(true);
      await settle(m);
      emit(modals(surface)[0]?.target, "topShow");
      await settle(m);
      app.setOpen(false);
      await settle(m);
      expect(modals(surface).map((node) => node.props.visible)).toEqual([false]);
      emit(modals(surface)[0]?.target, "topDismiss");
      await settle(m);
      expect(modals(surface)).toHaveLength(0);
      expect(app.dismissed()).toBe(2);
    } finally { delete environment.__navigationOS; }
  }
});

const bridges: { name: string; fixture: string; android: number; ios: number; names: Record<string, string>; counts: Record<string, number> }[] = [
  { name: "the host mounts the screen tags as the Svelte components on iOS and as RCTView on Android, with the same nativeIDs", fixture: "screen-fixture.svelte", android: 61, ios: 62, names: { stack: "SvelteStack", screen: "SvelteScreen", header: "SvelteHeader" }, counts: {} },
  { name: "tabs, tab panes and their stacks mount as the Svelte components on iOS; the tab icon view stays RCTView", fixture: "tabs-fixture.svelte", android: 63, ios: 64, names: { stack: "SvelteStack", screen: "SvelteScreen", header: "SvelteHeader", tabs: "SvelteTabs", tab: "SvelteTab", "tab-icon": "RCTView" }, counts: { tabs: 1, tab: 3 } },
  { name: "a toolbar, its items and its center mount as the Svelte components on iOS and as RCTView on Android, with the same nativeIDs", fixture: "toolbar-fixture.svelte", android: 76, ios: 77, names: { stack: "SvelteStack", screen: "SvelteScreen", header: "SvelteHeader", toolbar: "SvelteToolbar", "toolbar-item": "SvelteToolbarItem", "toolbar-center": "SvelteToolbarCenter" }, counts: { toolbar: 1, "toolbar-item": 5 } },
];

for (const { name, fixture, android: androidSurface, ios: iosSurface, names, counts } of bridges) {
  test(name, async () => {
    const android = await mount(shared(fixture), "android", androidSurface);
    const phone = await mount(shared(fixture), "ios", iosSurface);
    expect(new Set(android.pairs.map(([, component]) => component))).toEqual(new Set(["RCTView"]));
    expect(phone.pairs).toEqual(android.pairs.map(([kind]) => [kind, names[String(kind)]]));
    const kinds = phone.pairs.map(([kind]) => kind);
    for (const kind of ["stack", "screen", "header"]) expect(kinds).toContain(kind);
    for (const [kind, count] of Object.entries(counts)) expect(kinds.filter((candidate) => candidate === kind)).toHaveLength(count);
    expect(phone.ids).toEqual(android.ids);
  });
}

test("the first iOS navigation node registers the view configs of the nine components, once, with their events", async () => {
  const android = await mount(shared("screen-fixture.svelte"), "android", 65);
  expect(android.pairs.length).toBeGreaterThan(0);
  expect(environment.__registeredViewConfigs?.size).toBe(0);
  await mount(shared("screen-fixture.svelte"), "ios", 66);
  const configs = environment.__registeredViewConfigs ?? new Map();
  expect([...configs.keys()].sort()).toEqual(["SvelteHeader", "SvelteHeaderSlot", "SvelteScreen", "SvelteStack", "SvelteTab", "SvelteTabs", "SvelteToolbar", "SvelteToolbarCenter", "SvelteToolbarItem"]);
  const configOf = (name: string) => {
    const config = configs.get(name);
    if (!config) throw new Error(`${name} is not registered`);
    return config() as { directEventTypes: Record<string, { registrationName: string }> };
  };
  const eventsOf = (name: string) => configOf(name).directEventTypes;
  expect(configOf("SvelteStack")).toEqual({ uiViewClassName: "SvelteStack", directEventTypes: {}, validAttributes: {}, base: true });
  expect(eventsOf("SvelteScreen")).toEqual({
    topAppear: { registrationName: "onAppear" },
    topDisappear: { registrationName: "onDisappear" },
    topDismissed: { registrationName: "onDismissed" },
    topExited: { registrationName: "onExited" },
    topDetentChange: { registrationName: "onDetentChange" },
  });
  expect(eventsOf("SvelteHeader")).toEqual({ topMetrics: { registrationName: "onMetrics" } });
  expect(eventsOf("SvelteHeaderSlot")).toEqual({ topCancel: { registrationName: "onCancel" } });
  expect(eventsOf("SvelteTabs")).toEqual({ topSelect: { registrationName: "onSelect" }, topMetrics: { registrationName: "onMetrics" } });
  expect(eventsOf("SvelteTab")).toEqual({});
  expect(eventsOf("SvelteToolbar")).toEqual({ topPress: { registrationName: "onPress" }, topMetrics: { registrationName: "onMetrics" } });
  expect(eventsOf("SvelteToolbarItem")).toEqual({});
  expect(eventsOf("SvelteToolbarCenter")).toEqual({});
});

test("a pressable and a block of text are accessibility elements on iOS, so VoiceOver reads a button as a button and the text at all; on Android the engine exposes them itself", async () => {
  const lowered = (platform: "android" | "ios", surface: number) => async () => {
    environment.__navigationOS = platform;
    try {
      const m = await loadFixture(own("pressable-fixture.svelte"));
      host.roots = {};
      m.startSurface(surface, m.Fixture, {});
      await settle(m);
      const byTestID = (id: string) => flatten(host.roots[surface]).find((node) => node.props.testID === id);
      return { plain: byTestID("plain")?.props.accessible, hidden: byTestID("hidden")?.props.accessible, passive: byTestID("passive")?.props.accessible, label: byTestID("plain")?.props.accessibilityLabel, words: byTestID("words")?.props.accessible, silent: byTestID("silent")?.props.accessible };
    } finally { delete environment.__navigationOS; }
  };
  expect(await lowered("ios", 67)()).toEqual({ plain: true, hidden: false, passive: undefined, label: "Go", words: true, silent: false });
  expect(await lowered("android", 68)()).toEqual({ plain: undefined, hidden: false, passive: undefined, label: "Go", words: undefined, silent: false });
});
