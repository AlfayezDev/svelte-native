import { expect, test } from "bun:test";
import { parseNativeID } from "../../src/fabric/navigation.ts";
import { type FakeNode, ofKind, ofTestID, withInsets, onPlatform, settle, shared, flat, navigationWorld } from "./support/world.ts";

/** The toolbar of a `Screen` (SPEC.md "Toolbar") through the Fabric host. */
const { host, load } = navigationWorld();

// The toolbar (SPEC.md "Toolbar"): the last child of the screen, one item node per item, then the optional center.
type ToolbarApp = { set: (patch: object) => void; setToolbar: (patch: object | undefined) => void; showCenter: (value: boolean) => void; nest: (value: object | null) => void; events: () => string[] };
const ids = (nodes: FakeNode[]) => nodes.map((node) => node.props.nativeID);
const itemIds = [
  "svelte:toolbar-item;k=reply;t=Reply;ic=asset%3A%2Freply.png",
  "svelte:toolbar-item;k=archive;t=Archive;iv=1;bd=99%2B",
  "svelte:toolbar-item;sp=1",
  "svelte:toolbar-item;k=flag;t=Flag;ic=asset%3A%2Fflag.png;bd=",
  "svelte:toolbar-item;k=delete;t=Delete;ds=1",
];

async function mountToolbar(surface: number) {
  const m = await load(shared("toolbar-fixture.svelte"));
  const app = m.startSurface(surface, m.Fixture, {}) as ToolbarApp;
  await settle(m);
  const screen = () => ofKind(host.roots[surface], "screen")[0];
  const toolbar = () => ofKind(host.roots[surface], "toolbar")[0];
  return { m, app, screen, toolbar, items: () => ofKind(host.roots[surface], "toolbar-item"), flush: () => settle(m), tree: () => host.roots[surface] };
}

test("a Screen renders its toolbar as the last child, one item node per item in order, sized from the platform bar and the bottom inset", async () => {
  withInsets(24, 34);
  const { screen, toolbar, items, tree } = await mountToolbar(70);
  expect(screen().children.map((child) => child.props.nativeID ?? "content")).toEqual(["svelte:header;t=Thread", "content", "svelte:toolbar"]);
  expect(flat(toolbar().props.style)).toEqual({ height: 90, paddingBottom: 34, paddingHorizontal: 4, flexDirection: "row", alignItems: "center" });
  expect(ids(toolbar().children)).toEqual(itemIds);
  expect(ids(items())).toEqual(itemIds);
  expect(items()[0].props.accessibilityLabel).toBe("Reply to thread");
  expect(items()[0].props.testID).toBe("tb-reply");
  expect(flat(items()[2].props.style)).toEqual({ flexGrow: 1 });
  // An item is 48 dp wide in Yoga, as the engine places it.
  expect(flat(items()[0].props.style)).toMatchObject({ width: 48, marginHorizontal: 0 });
  expect(flat(items()[1].props.style)).toMatchObject({ width: 48, marginHorizontal: 0 });
  // The snippet icon's item takes the touch as a box: a Pressable inside the snippet is out of its reach.
  expect(items().map((item) => item.props.pointerEvents)).toEqual(["box-only", "box-only", undefined, "box-only", "box-only"]);
  // An asset icon is a uri on the node; a snippet icon is the node's child, drawn live with `pressed` false.
  expect(items()[0].children).toHaveLength(0);
  expect(ofTestID(items()[1].children, "glyph-false")).toHaveLength(1);
  expect(ofTestID(tree(), "glyph-false")).toHaveLength(1);
  expect(ofTestID(tree(), "toolbar-90-34")).toHaveLength(1);
  // The engine's `topPress` is a native event, not a responder handler: the toolbar is neither clickable nor an accessibility element.
  expect(toolbar().props.onPress).toBe(true);
  expect(toolbar().props.onClick).toBeUndefined();
  expect(toolbar().props.accessible).toBeUndefined();
});

test("the toolbar follows its options: center content last, translucent overlay at the bottom, hidden or absent leaves no node", async () => {
  withInsets(24, 34);
  const { app, toolbar, items, flush, tree } = await mountToolbar(71);
  app.showCenter(true);
  await flush();
  expect(toolbar().props.nativeID).toBe("svelte:toolbar;sl=1");
  expect(toolbar().children.map((child) => parseNativeID(String(child.props.nativeID))?.kind)).toEqual(["toolbar-item", "toolbar-item", "toolbar-item", "toolbar-item", "toolbar-item", "toolbar-center"]);
  expect(toolbar().children[5].props.nativeID).toBe("svelte:toolbar-center");
  expect(ofTestID(toolbar().children[5].children, "composer")).toHaveLength(1);
  // With a center the spacer does not grow: the center's `flex: 1` is all the free width, as the native sides place it.
  expect(flat(items()[2].props.style)).toEqual({ flexGrow: 0 });

  app.setToolbar({ translucent: true, tint: "#fff", background: "#102030" });
  await flush();
  expect(flat(items()[2].props.style)).toEqual({ flexGrow: 0 });
  expect(toolbar().props.nativeID).toBe("svelte:toolbar;tl=1;tc=ffffffff;bg=102030ff;sl=1");
  expect(flat(toolbar().props.style)).toEqual({ position: "absolute", left: 0, right: 0, bottom: 0, height: 90, paddingBottom: 34, paddingHorizontal: 4, flexDirection: "row", alignItems: "center" });
  expect(ofTestID(tree(), "toolbar-90-34")).toHaveLength(1);

  app.setToolbar({ translucent: false, tint: undefined, background: undefined, items: [{ key: "only", title: "Only", disabled: true }] });
  await flush();
  expect(toolbar().props.nativeID).toBe("svelte:toolbar;sl=1");
  expect(ids(items())).toEqual(["svelte:toolbar-item;k=only;t=Only;ds=1"]);

  app.setToolbar({ hidden: true });
  await flush();
  expect(ofKind(tree(), "toolbar")).toHaveLength(0);
  expect(ofKind(tree(), "toolbar-item")).toHaveLength(0);
  expect(ofKind(tree(), "toolbar-center")).toHaveLength(0);
  expect(ofTestID(tree(), "toolbar-0-0")).toHaveLength(1);

  // `toolbarCenter` alone is enough, as a header snippet is for the header; without either there is no toolbar.
  app.setToolbar(undefined);
  await flush();
  expect(toolbar().props.nativeID).toBe("svelte:toolbar;sl=1");
  expect(toolbar().children).toHaveLength(1);
  app.showCenter(false);
  await flush();
  expect(ofKind(tree(), "toolbar")).toHaveLength(0);
});

test("a press reaches toolbar.onPress with the key; an inner Screen's toolbar merges into the outer one and its handler wins", async () => {
  withInsets(24, 34);
  const { app, toolbar, flush, tree } = await mountToolbar(72);
  host.emit(toolbar().target, "topPress", { key: "archive", index: 1 });
  expect(app.events()).toEqual(["press archive"]);
  const inner: string[] = [];
  app.nest({ toolbar: { tint: "#0a84ff", onPress: (key: string) => inner.push(key) } });
  await flush();
  expect(ofKind(tree(), "screen")).toHaveLength(1);
  expect(ofKind(tree(), "toolbar")).toHaveLength(1);
  expect(toolbar().props.nativeID).toBe("svelte:toolbar;tc=0a84ffff");
  expect(ids(toolbar().children)).toEqual(itemIds);
  host.emit(toolbar().target, "topPress", { key: "reply", index: 0 });
  expect(inner).toEqual(["reply"]);
  expect(app.events()).toEqual(["press archive"]);
  expect(ofTestID(tree(), "toolbar-90-34")).toHaveLength(1);
});

test("toolbar metrics from the native side correct the estimate, which uses the platform bar and the bottom inset", async () => {
  withInsets(59, 34);
  onPlatform("ios");
  const { toolbar, items, flush, tree } = await mountToolbar(73);
  expect(flat(toolbar().props.style)).toMatchObject({ height: 78, paddingBottom: 34, paddingHorizontal: 16 });
  // An iOS item is UIKit's 44 pt button with 4 pt each side.
  expect(flat(items()[0].props.style)).toMatchObject({ width: 44, marginHorizontal: 4 });
  expect(ofTestID(tree(), "toolbar-78-34")).toHaveLength(1);
  host.emit(toolbar().target, "topMetrics", { height: 83, inset: 39 });
  await flush();
  expect(flat(toolbar().props.style)).toMatchObject({ height: 83, paddingBottom: 39 });
  expect(ofTestID(tree(), "toolbar-83-39")).toHaveLength(1);
});

test("inside a tab pane the bar sits above the tab bar: it takes no bottom inset of its own", async () => {
  withInsets(24, 34);
  const m = await load("toolbar-tabs-fixture.svelte");
  const app = m.startSurface(74, m.Fixture, {}) as { select: (key: string) => void };
  await settle(m);
  const panes = () => ofKind(host.roots[74], "tab");
  const bars = () => ofKind(host.roots[74], "toolbar");
  expect(bars()).toHaveLength(1);
  expect(ofKind(panes()[0].children, "toolbar")).toHaveLength(1);
  expect(flat(bars()[0].props.style)).toEqual({ height: 56, paddingBottom: 0, paddingHorizontal: 4, flexDirection: "row", alignItems: "center" });
  expect(ids(bars()[0].children)).toEqual(["svelte:toolbar-item;k=reply;t=Reply", "svelte:toolbar-item;sp=1", "svelte:toolbar-item;k=archive;t=Archive"]);
  expect(ofTestID(host.roots[74], "toolbar-56-0")).toHaveLength(1);
  // The pane's bottom edge is the tab bar's top; the screen that holds the tabs has no toolbar.
  expect(flat(panes()[0].props.style).bottom).toBe(98);
  app.select("inbox");
  await settle(m);
  expect(bars()).toHaveLength(2);
  expect(bars().map((bar) => flat(bar.props.style).paddingBottom)).toEqual([0, 0]);
});

test("on iOS the bar inside a tab pane is the platform's 44 pt and takes no bottom inset either", async () => {
  withInsets(24, 34);
  onPlatform("ios");
  const m = await load("toolbar-tabs-fixture.svelte");
  m.startSurface(75, m.Fixture, {});
  await settle(m);
  expect(flat(ofKind(host.roots[75], "toolbar")[0].props.style)).toMatchObject({ height: 44, paddingBottom: 0, paddingHorizontal: 16 });
});
