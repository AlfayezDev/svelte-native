import { expect, test } from "bun:test";
import { parseNativeID } from "../../src/fabric/navigation.ts";
import { type FakeNode, find, ofKind, ofTestID, withInsets, onPlatform, settle, flat, navigationWorld } from "./support/world.ts";

/** `Screen` through the Fabric host: the tags reach the engine as RCTView nodes carrying the encoded nativeID (SPEC.md "Screen API contract"). */
const { host, load } = navigationWorld();

test("native-stack and native-screen mount as RCTView nodes the engine recognises by nativeID, with absolute screen styles", async () => {
  const m = await load();
  const app = m.startSurface(21, m.Fixture, {}) as App;
  const stack = host.roots[21][0];
  expect(stack.name).toBe("RCTView");
  expect(stack.props.nativeID).toBe("svelte:stack");
  expect(stack.props.style).toEqual([{ flex: 1 }, { flex: 1 }]);
  expect(stack.children).toHaveLength(1);
  const [first] = stack.children;
  expect(first.name).toBe("RCTView");
  expect(first.props.nativeID).toBe("svelte:screen;a=2;p=push;g=1;s=default;b=1");
  expect(first.props.style).toEqual([{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }, { backgroundColor: "white" }]);

  app.push(2);
  app.push(3);
  await settle(m);
  const screens = host.roots[21][0].children;
  expect(screens.map((screen) => screen.props.nativeID)).toEqual([
    "svelte:screen;a=2;p=push;g=1;s=default;b=1",
    "svelte:screen;a=2;p=push;g=0;s=default;b=1",
    "svelte:screen;a=2;p=modal;g=1;s=default;b=1",
  ]);
  expect(find(host.roots[21], "RCTView").filter((node) => node.props.nativeID === "svelte:stack")).toHaveLength(1);

  app.pop();
  await settle(m);
  expect(host.roots[21][0].children).toHaveLength(2);
});

test("topDismissed on a screen reaches its onDismissed handler", async () => {
  const m = await load();
  const app = m.startSurface(22, m.Fixture, {}) as App;
  app.push(2);
  await settle(m);
  const [first, second] = host.roots[22][0].children;
  expect(first.props.onDismissed).toBe(true);
  host.emit(second.target, "topDismissed", { dismissCount: 1 });
  host.emit(first.target, "topDismissed", {});
  expect(app.dismissedLog()).toEqual([2, 1]);
});

type ScreenApp = { set: (patch: object) => void; show: (patch: object) => void; nest: (value: object | null) => void; events: () => string[] };
async function mountScreen(surface: number) {
  const m = await load("screen-fixture.svelte");
  const app = m.startSurface(surface, m.Fixture, {}) as ScreenApp;
  await settle(m);
  const screen = () => ofKind(host.roots[surface], "screen")[0];
  const header = () => ofKind(host.roots[surface], "header")[0];
  return { m, app, screen, header, flush: () => settle(m), tree: () => host.roots[surface] };
}

test("a Screen inside a Modal is a screen of its own, in a stack of its own, and leaves the title of the screen around the Modal alone; a Modal in a tab pane pads its own bottom inset", async () => {
  withInsets(24);
  const m = await load("modal-screen-fixture.svelte");
  const probes = globalThis as { __paneProbe?: Record<string, boolean> };
  probes.__paneProbe = {};
  const app = m.startSurface(40, m.Fixture, {}) as { setOpen: (value: boolean) => void };
  await settle(m);
  const titleOf = (header: FakeNode) => decodeURIComponent(String(parseNativeID(String(header.props.nativeID))?.pairs.t));
  const titles = () => ofKind(host.roots[40], "header").map(titleOf);
  expect(titles()).toEqual(["Outer", "Inner", "Pane modal"]); // the modals' titles are their own headers, not the outer screen's
  // iOS draws a screen's header only under a stack: a modal's screen gets a one-entry stack of its own, `native-stack > native-screen`.
  expect(ofKind(host.roots[40], "stack")).toHaveLength(3); // the outer one, and one in each modal
  for (const title of ["Outer", "Inner", "Pane modal"]) {
    const stack = ofKind(host.roots[40], "stack").find((candidate) => candidate.children.some((screen) => ofKind(screen.children, "header").map(titleOf).includes(title) && !ofKind(screen.children, "stack").some((below) => ofKind(below.children, "header").map(titleOf).includes(title))));
    expect(stack?.children.map((child) => parseNativeID(String(child.props.nativeID))?.kind)).toEqual(["screen"]);
  }
  expect(probes.__paneProbe).toEqual({ screen: false, pane: true, "modal-in-pane": false }); // a modal covers the tab bar: no pane around it
  app.setOpen(false);
  await settle(m);
  expect(titles()[0]).toBe("Outer");
});

test("a Screen with no stack above it is a one-entry stack: native-stack > native-screen at the root, none for a nested Screen", async () => {
  withInsets(24);
  const m = await load("screen-root-fixture.svelte");
  m.startSurface(42, m.Fixture, {});
  await settle(m);
  const [top] = host.roots[42];
  expect(parseNativeID(String(top.props.nativeID))?.kind).toBe("stack");
  expect(top.props.style).toEqual([{ flex: 1 }, { flex: 1 }]);
  expect(top.children.map((child) => parseNativeID(String(child.props.nativeID))?.kind)).toEqual(["screen"]);
  expect(top.children[0].props.nativeID).toBe("svelte:screen;a=2;p=push;g=1;s=default;b=1");
  expect(ofKind(host.roots[42], "stack")).toHaveLength(1);
  expect(ofKind(host.roots[42], "screen")).toHaveLength(1); // the nested Screen hands its options over
  expect(ofKind(host.roots[42], "header")).toHaveLength(1);
  expect(parseNativeID(String(ofKind(host.roots[42], "header")[0].props.nativeID))?.pairs).toMatchObject({ t: "Root", st: "Nested" });
});

test("a Screen renders its native-screen, an opt-in header sized from the insets store, and a content view", async () => {
  withInsets(24);
  const { app, screen, header, flush } = await mountScreen(41);
  expect(screen().props.nativeID).toBe("svelte:screen;a=2;p=push;g=1;s=default;b=1");
  expect(screen().children.map((child) => child.props.nativeID ?? "content")).toEqual(["svelte:header;t=Inbox", "content"]);
  expect(flat(header().props.style)).toEqual({ height: 80, paddingTop: 24, paddingStart: 0, flexDirection: "row", alignItems: "center" });
  expect(screen().children[1].props.style).toEqual({ flex: 1 });
  expect(ofTestID(host.roots[41], "page")).toHaveLength(1);

  app.set({ title: undefined });
  await flush();
  expect(ofKind(host.roots[41], "header")).toHaveLength(0);
  expect(screen().children).toHaveLength(1);

  app.set({ header: { large: true, translucent: true, background: "#102030", tint: "#fff", hideShadow: true, backTitle: "Home" } });
  await flush();
  expect(header().props.nativeID).toBe("svelte:header;bt=Home;l=1;tl=1;hs=1;tc=ffffffff;bg=102030ff");
  expect(flat(header().props.style)).toMatchObject({ position: "absolute", top: 0, left: 0, right: 0, height: 136, paddingTop: 24 });

  app.set({ header: { hidden: true }, title: "Hidden" });
  await flush();
  expect(ofKind(host.roots[41], "header")).toHaveLength(0);
});

test("the header height estimate follows the platform and the native metrics correct it", async () => {
  withInsets(59);
  onPlatform("ios");
  const { header, flush } = await mountScreen(42);
  expect(flat(header().props.style)).toMatchObject({ height: 103, paddingTop: 59 });
  expect(ofKind(host.roots[42], "header-center")).toHaveLength(0);
  host.emit(header().target, "topMetrics", { height: 110, inset: 62 });
  await flush();
  expect(flat(header().props.style)).toMatchObject({ height: 110, paddingTop: 62 });
  expect(ofTestID(host.roots[42], "header-110-62")).toHaveLength(1);
});

test("measured metrics apply to the large state they were measured in only", async () => {
  withInsets(24);
  const { app, header, flush } = await mountScreen(43);
  host.emit(header().target, "topMetrics", { height: 90, inset: 30 });
  await flush();
  expect(flat(header().props.style)).toMatchObject({ height: 90, paddingTop: 30 });
  app.set({ header: { large: true } });
  await flush();
  expect(flat(header().props.style)).toMatchObject({ height: 136, paddingTop: 24 });
  host.emit(header().target, "topMetrics", { height: 146, inset: 30 });
  await flush();
  expect(flat(header().props.style)).toMatchObject({ height: 146, paddingTop: 30 });
  expect(ofTestID(host.roots[43], "header-146-30")).toHaveLength(1);
});

test("the back button is reserved only for a pushed screen that has a screen below and no left slot", async () => {
  withInsets(0);
  const { app, header, flush } = await mountScreen(44);
  expect(header().props.nativeID).toBe("svelte:header;t=Inbox");
  app.set({ canGoBack: true });
  await flush();
  expect(header().props.nativeID).toBe("svelte:header;t=Inbox;bk=1");
  expect(flat(header().props.style).paddingStart).toBe(48);
  app.set({ header: { hideBack: true } });
  await flush();
  expect(header().props.nativeID).toBe("svelte:header;t=Inbox");
  app.set({ header: { backTitle: "Inbox" } });
  app.show({ left: true });
  await flush();
  expect(header().props.nativeID).toBe("svelte:header;t=Inbox;bt=Inbox;sl=1");
  app.show({ left: false });
  app.set({ presentation: "modal" });
  await flush();
  expect(header().props.nativeID).toBe("svelte:header;t=Inbox;bt=Inbox");
});

test("header slots mount in reading order with their presence mask, and the center slot aligns by platform", async () => {
  withInsets(24);
  const { app, header, flush } = await mountScreen(45);
  app.show({ left: true, center: true, right: true, results: true });
  app.set({ search: { placeholder: "Search" } });
  await flush();
  expect(header().props.nativeID).toBe("svelte:header;t=Inbox;sl=15");
  expect(header().children.map((child) => parseNativeID(String(child.props.nativeID))?.kind)).toEqual(["header-left", "header-center", "header-right", "header-search"]);
  expect(header().children.map((child) => child.children[0].props.testID)).toEqual(["left", "center", "right", "results"]);
  expect(flat(header().children[1].props.style).justifyContent).toBe("flex-start");
  expect(flat(header().children[3].props.style)).toMatchObject({ position: "absolute", top: "100%", height: 720 });
  app.show({ center: false, results: false });
  await flush();
  expect(header().props.nativeID).toBe("svelte:header;t=Inbox;sl=13");
  expect(header().children).toHaveLength(3);
  expect(header().children[2].children).toHaveLength(0);
});

test("on iOS the center slot of the header is centered", async () => {
  withInsets(24);
  onPlatform("ios");
  const { app, header, flush } = await mountScreen(46);
  app.show({ center: true });
  await flush();
  expect(flat(header().children[0].props.style).justifyContent).toBe("center");
});

test("search: native text events reach the handlers unwrapped and the acknowledged count travels back", async () => {
  withInsets(24);
  const { app, header, flush } = await mountScreen(47);
  const texts: string[] = [];
  const log: string[] = [];
  app.set({ search: { placeholder: "Search", value: "ab", onChangeText: (text: string) => texts.push(text), onSubmit: (text: string) => log.push(`submit ${text}`), onCancel: () => log.push("cancel") } });
  await flush();
  const search = () => ofKind(host.roots[47], "header-search")[0];
  expect(search().props.nativeID).toBe("svelte:header-search;ph=Search;v=ab");
  expect(header().props.nativeID).toBe("svelte:header;t=Inbox;sl=8");
  host.emit(search().target, "topChange", { text: "abc", eventCount: 3 });
  await flush();
  expect(texts).toEqual(["abc"]);
  expect(search().props.nativeID).toBe("svelte:header-search;ph=Search;v=ab;ec=3");
  host.emit(search().target, "topSubmitEditing", { text: "abc" });
  host.emit(search().target, "topCancel", {});
  expect(log).toEqual(["submit abc", "cancel"]);
  app.set({ search: { placeholder: "Search", value: "abc" } });
  await flush();
  expect(search().props.nativeID).toBe("svelte:header-search;ph=Search;v=abc;ec=3");
});

test("presentation, sheet and system bar options reach the screen nativeID and style", async () => {
  withInsets(24);
  const { app, screen, flush } = await mountScreen(48);
  app.set({ presentation: "sheet", sheet: { detents: [0.4, 1], initialDetent: 1, grabber: false } });
  await flush();
  expect(screen().props.nativeID).toBe("svelte:screen;a=2;p=sheet;g=1;s=default;b=1;dt=0.4,1;di=1;gr=0");
  expect(flat(screen().props.style)).toEqual({ position: "absolute", left: 0, right: 0, bottom: 0, maxHeight: 776, height: 776 });
  app.set({ presentation: "formSheet" });
  await flush();
  expect(screen().props.nativeID).toBe("svelte:screen;a=2;p=formSheet;g=1;s=default;b=1");
  expect(flat(screen().props.style)).toEqual({ position: "absolute", top: 24, left: 0, right: 0, bottom: 0 });
  app.set({ presentation: "transparentModal", animation: "fade", gestureEnabled: false, nativeBackButtonDismissalEnabled: false, activityState: 1, statusBar: { style: "light", hidden: true }, navigationBar: { color: "#000", style: "light" } });
  await flush();
  expect(screen().props.nativeID).toBe("svelte:screen;a=1;p=transparentModal;g=0;s=fade;b=0;ss=l;sx=1;nc=000000ff;ns=l");
});

test("screen events reach the handlers: appear, disappear, dismissed and detent changes carry their payloads", async () => {
  withInsets(24);
  const { app, screen, flush } = await mountScreen(49);
  expect(screen().props.onAppear).toBe(true);
  expect(screen().props.onDisappear).toBe(true);
  expect(screen().props.onDismissed).toBe(true);
  expect(screen().props.onDetentChange).toBe(true);
  host.emit(screen().target, "topAppear", {});
  host.emit(screen().target, "topDetentChange", { index: 1, fraction: 0.5 });
  host.emit(screen().target, "topDisappear", {});
  host.emit(screen().target, "topDismissed", { dismissCount: 1 });
  expect(app.events()).toEqual(["appear", "detent 1 0.5", "disappear", "dismiss"]);
  await flush();
});

test("a Screen inside a Screen hands its options to the outer one and renders only its content", async () => {
  withInsets(24);
  const { app, screen, header, flush, tree } = await mountScreen(50);
  app.nest({ title: "Page", header: { large: true }, statusBar: { style: "dark" } });
  await flush();
  expect(ofKind(tree(), "screen")).toHaveLength(1);
  expect(screen().props.nativeID).toBe("svelte:screen;a=2;p=push;g=1;s=default;b=1;ss=d");
  expect(header().props.nativeID).toBe("svelte:header;t=Page;l=1");
  expect(ofKind(tree(), "header")).toHaveLength(1);
  expect(ofTestID(tree(), "page")).toHaveLength(1);
  expect(ofTestID(tree(), "header-136-24")).toHaveLength(1);
  host.emit(screen().target, "topDismissed", { dismissCount: 1 });
  expect(app.events()).toEqual(["dismiss", "inner dismiss"]);
  app.nest(null);
  await flush();
  expect(header().props.nativeID).toBe("svelte:header;t=Inbox");
  expect(screen().props.nativeID).toBe("svelte:screen;a=2;p=push;g=1;s=default;b=1");
});

test("replacement nested Screen retains its header and toolbar after the old branch cleanup", async () => {
  const m = await load("screen-ownership-fixture.svelte");
  host.roots = {};
  const app = m.startSurface(901, m.Fixture, {}) as { change(mode: string): void };
  const ids = () => find(host.roots[901], "RCTView").map(node => String(node.props.nativeID ?? ""));
  await settle(m);
  expect(ids()).toContain("svelte:header;t=Native%20screens");
  app.change("header"); await settle(m);
  expect(ids()).toContain("svelte:header;t=Screen%201;st=Native%20header");
  app.change("toolbar"); await settle(m);
  expect(ids()).toContain("svelte:header;t=Toolbar");
  expect(ids().some(id => id === "svelte:toolbar" || id.startsWith("svelte:toolbar;"))).toBe(true);
  app.change("plain"); await settle(m);
  expect(ids().some(id => id.startsWith("svelte:header") || id.startsWith("svelte:toolbar"))).toBe(false);
  app.change("header"); await settle(m);
  expect(ids()).toContain("svelte:header;t=Screen%201;st=Native%20header");
  app.change("none"); await settle(m);
  expect(ids().some(id => id.startsWith("svelte:header"))).toBe(false);
});
