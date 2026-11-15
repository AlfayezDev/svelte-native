import { expect, test } from "bun:test";
import { ofKind, ofTestID, withInsets, onPlatform, settle, shared, flat, navigationWorld } from "./support/world.ts";

/** `Tabs` through the Fabric host: one pane per item, the selection, the bar's metrics and the events that come back. */
const { host, load } = navigationWorld();

type TabsApp = { select: (key: string) => void; setItems: (items: object[]) => void; setLazy: (value: boolean) => void; selection: () => string; events: () => string[]; handle: (key: string) => { key: string; selected: boolean } };
async function mountTabs(surface: number) {
  const m = await load(shared("tabs-fixture.svelte"));
  const app = m.startSurface(surface, m.Fixture, {}) as TabsApp;
  await settle(m);
  const tabs = () => ofKind(host.roots[surface], "tabs")[0];
  const panes = () => ofKind(host.roots[surface], "tab");
  return { m, app, tabs, panes, flush: () => settle(m), tree: () => host.roots[surface] };
}

test("Tabs render one pane per item with the selection, icons and badges; panes mount lazily and keep their own screens", async () => {
  withInsets(24);
  const { tabs, panes, tree } = await mountTabs(51);
  expect(tabs().props.nativeID).toBe("svelte:tabs;sel=0;tc=0a84ffff;uc=8e8e93ff;bg=ffffffff");
  expect(tabs().props.onSelect).toBe(true);
  expect(panes().map((pane) => pane.props.nativeID)).toEqual([
    "svelte:tab;k=home;t=Home;ic=asset%3A%2Fhome.png;is=asset%3A%2Fhome-fill.png",
    "svelte:tab;k=inbox;t=Inbox;bd=99%2B",
    "svelte:tab;k=me;t=Me;iv=1;bd=;ds=1",
  ]);
  expect(panes().map((pane) => flat(pane.props.style).bottom)).toEqual([98, 98, 98]);
  expect(panes()[1].props.accessibilityLabel).toBe("Inbox, new messages");
  expect(panes()[1].props.testID).toBe("tab-inbox");
  expect(ofKind(panes()[2].children, "tab-icon")).toHaveLength(1);
  expect(ofTestID(tree(), "glyph-false")).toHaveLength(1);
  // Only the selected pane mounted; its screen is a real native-screen, not merged into the one that holds the tabs.
  expect(ofTestID(tree(), "pane-home")).toHaveLength(1);
  expect(ofTestID(tree(), "pane-inbox")).toHaveLength(0);
  expect(ofKind(tree(), "screen")).toHaveLength(2);
  expect(ofKind(tree(), "header").map((node) => node.props.nativeID)).toEqual(["svelte:header;t=Root", "svelte:header;t=Pane%20home"]);
});

test("selecting a tab mounts its pane and keeps the others; handles report which tab is selected", async () => {
  withInsets(24);
  const { app, tabs, flush, tree } = await mountTabs(52);
  expect(app.handle("home").selected).toBe(true);
  app.select("inbox");
  await flush();
  expect(tabs().props.nativeID).toBe("svelte:tabs;sel=1;tc=0a84ffff;uc=8e8e93ff;bg=ffffffff");
  expect(ofTestID(tree(), "pane-home")).toHaveLength(1);
  expect(ofTestID(tree(), "pane-inbox")).toHaveLength(1);
  expect(ofKind(tree(), "screen")).toHaveLength(3);
  expect(app.handle("home").selected).toBe(false);
  expect(app.handle("inbox").selected).toBe(true);
  expect(ofTestID(tree(), "glyph-false")).toHaveLength(1);
  app.setLazy(false);
  await flush();
  expect(ofTestID(tree(), "pane-me")).toHaveLength(1);
});

test("a tab press reports the key and the select count re-asserts the selection when the owner ignores it", async () => {
  withInsets(24);
  const { app, tabs, flush } = await mountTabs(53);
  host.emit(tabs().target, "topSelect", { key: "inbox", index: 1 });
  await flush();
  expect(app.events()).toEqual(["inbox"]);
  expect(app.selection()).toBe("home");
  expect(tabs().props.nativeID).toBe("svelte:tabs;sel=0;sc=1;tc=0a84ffff;uc=8e8e93ff;bg=ffffffff");
  app.select("inbox");
  host.emit(tabs().target, "topSelect", { key: "me", index: 2 });
  await flush();
  expect(tabs().props.nativeID).toBe("svelte:tabs;sel=1;sc=2;tc=0a84ffff;uc=8e8e93ff;bg=ffffffff");
});

test("tab bar metrics from the native side set the panes' bottom edge; the estimate uses the platform bar and the bottom inset", async () => {
  withInsets(24, 20);
  const { tabs, panes, flush } = await mountTabs(54);
  expect(panes().map((pane) => flat(pane.props.style).bottom)).toEqual([84, 84, 84]);
  host.emit(tabs().target, "topMetrics", { height: 100, inset: 34 });
  await flush();
  expect(panes().map((pane) => flat(pane.props.style).bottom)).toEqual([100, 100, 100]);
});

test("on iOS the tab bar estimate is the platform bar plus the bottom inset", async () => {
  withInsets(24, 34);
  onPlatform("ios");
  const { panes } = await mountTabs(55);
  expect(panes().map((pane) => flat(pane.props.style).bottom)).toEqual([83, 83, 83]);
});
