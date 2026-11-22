import { expect, test } from "bun:test";
import { NAV_KINDS, TOOLBAR_BAR, TOOLBAR_METRICS, badgeText, colorToWire, decodeList, decodeRecords, decodeValue, headerHeight, mergeScreenOptions, navigationProps, navigationTags, normalizeDetents, parseNativeID, sheetStyle, toolbarHeight } from "../../src/fabric/navigation.ts";

/** The pure half of the screen API contract (SPEC.md "Screen API contract (header, sheet, tabs)"): the nativeIDs the encoders write, the reference decoder the native sides are checked against, and the merge of screen options. */
// Screen API contract: the pure encoders (SPEC.md "Screen API contract (header, sheet, tabs)").
const screenId = (attributes: Record<string, unknown>) => navigationProps("native-screen", attributes).nativeID;
const noop = () => {};

test("the screen nativeID keeps its grammar and gains the sheet, status bar and navigation bar keys", () => {
  expect(screenId({})).toBe("svelte:screen;a=2;p=push;g=1;s=default;b=1");
  expect(screenId({ stackPresentation: "bogus", stackAnimation: "bogus" })).toBe("svelte:screen;a=2;p=push;g=1;s=default;b=1");
  expect(screenId({ stackPresentation: "modal", activityState: 1, gestureEnabled: false, stackAnimation: "fade", nativeBackButtonDismissalEnabled: false })).toBe("svelte:screen;a=1;p=modal;g=0;s=fade;b=0");
  expect(screenId({ stackPresentation: "transparentModal", stackAnimation: "slide_from_bottom" })).toBe("svelte:screen;a=2;p=transparentModal;g=1;s=slide_from_bottom;b=1");
  expect(screenId({ stackPresentation: "formSheet", sheetDetents: [0.3], sheetInitialDetent: 0.3 })).toBe("svelte:screen;a=2;p=formSheet;g=1;s=default;b=1");
  expect(screenId({ stackPresentation: "formSheet", sheetGrabber: true, sheetDismissible: false, sheetBackdrop: "none" })).toBe("svelte:screen;a=2;p=formSheet;g=1;s=default;b=1;gr=1;dm=0;bd=1");
  expect(screenId({ stackPresentation: "modal", sheetDetents: [0.3], sheetDismissible: false })).toBe("svelte:screen;a=2;p=modal;g=1;s=default;b=1");
  expect(screenId({ stackPresentation: "sheet" })).toBe("svelte:screen;a=2;p=sheet;g=1;s=default;b=1;dt=0.5,1");
  expect(screenId({ stackPresentation: "sheet", sheetDetents: ["auto", 0.75, 0.75, 2, "x", 1, 0.1], sheetInitialDetent: 0.75, sheetGrabber: false, sheetDismissible: false, sheetBackdrop: "none" }))
    .toBe("svelte:screen;a=2;p=sheet;g=1;s=default;b=1;dt=auto,0.75,1,0.1;di=1;gr=0;dm=0;bd=1");
  expect(screenId({ stackPresentation: "sheet", sheetInitialDetent: 0.9 })).toBe("svelte:screen;a=2;p=sheet;g=1;s=default;b=1;dt=0.5,1");
  expect(screenId({ statusBarStyle: "auto", navigationBarStyle: "auto" })).toBe("svelte:screen;a=2;p=push;g=1;s=default;b=1");
  expect(screenId({ statusBarStyle: "light", statusBarHidden: true, navigationBarColor: "#102030", navigationBarStyle: "dark" })).toBe("svelte:screen;a=2;p=push;g=1;s=default;b=1;ss=l;sx=1;nc=102030ff;ns=d");
  expect(screenId({ statusBarStyle: "dark", statusBarHidden: false, navigationBarColor: "papayawhip" })).toBe("svelte:screen;a=2;p=push;g=1;s=default;b=1;ss=d");
});

test("screen styles: absolute fill, bottom-anchored sheets sized from the detents, form sheets below the top inset", () => {
  expect(navigationProps("native-screen", {}).style).toEqual([{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }, undefined]);
  expect(navigationProps("native-screen", { stackPresentation: "formSheet", topInset: 59, style: { backgroundColor: "white" } }).style).toEqual([{ position: "absolute", top: 59, left: 0, right: 0, bottom: 0 }, { backgroundColor: "white" }]);
  expect(navigationProps("native-screen", { stackPresentation: "formSheet" }).style).toEqual([{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }, undefined]);
  expect(sheetStyle([0.5, 1], 700)).toEqual({ position: "absolute", left: 0, right: 0, bottom: 0, maxHeight: 700, height: 700 });
  expect(sheetStyle([0.4], 700)).toEqual({ position: "absolute", left: 0, right: 0, bottom: 0, maxHeight: 700, height: 280 });
  expect(sheetStyle([0.5], undefined)).toEqual({ position: "absolute", left: 0, right: 0, bottom: 0, maxHeight: "100%", height: "50%" });
  expect(sheetStyle(["auto"], 700)).toEqual({ position: "absolute", left: 0, right: 0, bottom: 0, maxHeight: 700 });
  expect(sheetStyle(["auto", 0.6], 700)).toEqual({ position: "absolute", left: 0, right: 0, bottom: 0, maxHeight: 700, minHeight: 420 });
  expect(sheetStyle(["auto", 0.6], undefined)).toEqual({ position: "absolute", left: 0, right: 0, bottom: 0, maxHeight: "100%", minHeight: "60%" });
  expect(navigationProps("native-screen", { stackPresentation: "sheet", sheetDetents: [0.5], availableHeight: 776 }).style).toEqual([sheetStyle([0.5], 776), undefined]);
});

test("encoders consume their own attributes and pass handlers, refs and accessibility props through", () => {
  const props = navigationProps("native-screen", { stackPresentation: "sheet", sheetDetents: [1], statusBarStyle: "light", onDismissed: noop, onDetentChange: noop, testID: "screen", accessibilityLabel: "Filters" });
  expect(props.onDismissed).toBe(noop);
  expect(props.onDetentChange).toBe(noop);
  expect(props.testID).toBe("screen");
  expect(props.accessibilityLabel).toBe("Filters");
  for (const key of ["stackPresentation", "sheetDetents", "statusBarStyle"]) expect(key in props).toBe(false);
  const header = navigationProps("native-header", { title: "A", onMetrics: noop, ref: noop });
  expect(header.onMetrics).toBe(noop);
  expect(header.ref).toBe(noop);
  expect("title" in header).toBe(false);
});

test("the header nativeID carries text percent-encoded, flags only when set, colors as rrggbbaa", () => {
  expect(navigationProps("native-header", {}).nativeID).toBe("svelte:header");
  const header = navigationProps("native-header", {
    title: "A;B=C, 100%", subtitle: "sub", backTitle: "Back", large: true, translucent: true, back: true, hideShadow: true,
    tint: "#fff", background: "rgba(0, 0, 0, 0.5)", slots: 3, headerHeight: 108, headerInset: 24,
  });
  expect(header.nativeID).toBe("svelte:header;t=A%3BB%3DC%2C%20100%25;st=sub;bt=Back;l=1;tl=1;bk=1;hs=1;tc=ffffffff;bg=00000080;sl=3");
  expect(header.style).toEqual([{ position: "absolute", top: 0, left: 0, right: 0, zIndex: 1, height: 108, paddingTop: 24, paddingStart: 48, flexDirection: "row", alignItems: "center" }, undefined]);
  expect(navigationProps("native-header", { title: "", subtitle: undefined, tint: "papayawhip", slots: 0, large: false }).nativeID).toBe("svelte:header");
  expect(navigationProps("native-header", { headerHeight: 80, headerInset: 24, style: { opacity: 0.5 } }).style).toEqual([{ height: 80, paddingTop: 24, paddingStart: 0, flexDirection: "row", alignItems: "center" }, { opacity: 0.5 }]);
  expect(navigationProps("native-header", { translucent: true, headerHeight: 80 }).style).toEqual([{ position: "absolute", top: 0, left: 0, right: 0, zIndex: 1, height: 80, paddingTop: 0, paddingStart: 0, flexDirection: "row", alignItems: "center" }, undefined]);
});

test("header slots are row containers; the center slot fills the gap, the search slot hosts the results below the header", () => {
  const row = { flexDirection: "row", alignItems: "center" };
  expect(navigationProps("native-header-left", {}).nativeID).toBe("svelte:header-left");
  expect(navigationProps("native-header-right", {}).nativeID).toBe("svelte:header-right");
  expect(navigationProps("native-header-left", {}).style).toEqual([row, undefined]);
  expect(navigationProps("native-header-right", {}).style).toEqual([row, undefined]);
  expect(navigationProps("native-header-center", {}).nativeID).toBe("svelte:header-center");
  expect(navigationProps("native-header-center", {}).style).toEqual([{ ...row, flex: 1, justifyContent: "center" }, undefined]);
  expect(navigationProps("native-header-center", { align: "start" }).style).toEqual([{ ...row, flex: 1, justifyContent: "flex-start" }, undefined]);
  expect(navigationProps("native-header-search", {}).nativeID).toBe("svelte:header-search");
  expect(navigationProps("native-header-search", {}).style).toEqual([{ position: "absolute", top: "100%", left: 0, right: 0, bottom: 0 }, undefined]);
  const search = navigationProps("native-header-search", { placeholder: "Search…", value: "a b", eventCount: 4, surfaceHeight: 800, headerHeight: 80, onChange: noop });
  expect(search.nativeID).toBe("svelte:header-search;ph=Search%E2%80%A6;v=a%20b;ec=4");
  expect(search.style).toEqual([{ position: "absolute", top: "100%", left: 0, right: 0, height: 720 }, undefined]);
  expect(search.onChange).toBe(noop);
  expect(navigationProps("native-header-search", { value: "", eventCount: 0 }).nativeID).toBe("svelte:header-search");
});

test("tabs, tab and tab icon encode the selection, the bar colors, the items and their badges", () => {
  expect(navigationProps("native-tabs", {}).nativeID).toBe("svelte:tabs;sel=0");
  const tabs = navigationProps("native-tabs", { selectedIndex: 2, selectCount: 5, tint: "#0a84ff", inactiveTint: "#8e8e93", background: "#fff", labels: "never", barHeight: 98, onSelect: noop });
  expect(tabs.nativeID).toBe("svelte:tabs;sel=2;sc=5;tc=0a84ffff;uc=8e8e93ff;bg=ffffffff;lb=1");
  expect(tabs.style).toEqual([{ flex: 1 }, undefined]);
  expect(tabs.onSelect).toBe(noop);
  expect("barHeight" in tabs).toBe(false);
  expect(navigationProps("native-tabs", { selectedIndex: 1, labels: "always" }).nativeID).toBe("svelte:tabs;sel=1");

  const tab = navigationProps("native-tab", { tabKey: "in/box", title: "Inbox", icon: "asset:/a b.png", selectedIcon: "https://x/y.png?a=1&b=2", iconView: false, badge: 120, disabled: true, barHeight: 98, testID: "t" });
  expect(tab.nativeID).toBe("svelte:tab;k=in%2Fbox;t=Inbox;ic=asset%3A%2Fa%20b.png;is=https%3A%2F%2Fx%2Fy.png%3Fa%3D1%26b%3D2;bd=99%2B;ds=1");
  expect(tab.style).toEqual([{ position: "absolute", top: 0, left: 0, right: 0, bottom: 98 }, undefined]);
  expect(tab.testID).toBe("t");
  expect(navigationProps("native-tab", { tabKey: "me", title: "Me", iconView: true, badge: true }).nativeID).toBe("svelte:tab;k=me;t=Me;iv=1;bd=");
  expect(navigationProps("native-tab", { tabKey: "me", title: "Me", badge: 0 }).nativeID).toBe("svelte:tab;k=me;t=Me");
  expect(navigationProps("native-tab", {}).style).toEqual([{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }, undefined]);
  const icon = navigationProps("native-tab-icon", {});
  expect(icon.nativeID).toBe("svelte:tab-icon");
  expect(icon.style).toEqual([{ position: "absolute", top: 0, left: 0, width: 24, height: 24, alignItems: "center", justifyContent: "center" }, undefined]);
});

test("the toolbar nativeID carries flags only when set, colors as rrggbbaa, the slot mask; it is a row in flow, or absolute at the bottom when translucent", () => {
  expect(navigationProps("native-toolbar", {}).nativeID).toBe("svelte:toolbar");
  const bar = navigationProps("native-toolbar", {
    hidden: true, translucent: true, tint: "#fff", background: "rgba(0, 0, 0, 0.5)", slots: 1, toolbarHeight: 90, toolbarInset: 34, onPress: noop, onMetrics: noop, testID: "bar",
  });
  expect(bar.nativeID).toBe("svelte:toolbar;hd=1;tl=1;tc=ffffffff;bg=00000080;sl=1");
  expect(bar.style).toEqual([{ position: "absolute", left: 0, right: 0, bottom: 0, height: 90, paddingBottom: 34, paddingHorizontal: 4, flexDirection: "row", alignItems: "center" }, undefined]);
  expect(bar.onPress).toBe(noop);
  expect(bar.onMetrics).toBe(noop);
  expect(bar.testID).toBe("bar");
  for (const key of ["hidden", "translucent", "tint", "background", "slots", "toolbarHeight", "toolbarInset", "toolbarPlatform"]) expect(key in bar).toBe(false);
  const flow = navigationProps("native-toolbar", { toolbarHeight: 56, toolbarInset: 0, style: { opacity: 0.5 } });
  expect(flow.nativeID).toBe("svelte:toolbar");
  expect(flow.style).toEqual([{ height: 56, paddingBottom: 0, paddingHorizontal: 4, flexDirection: "row", alignItems: "center" }, { opacity: 0.5 }]);
  // The band's horizontal padding is the platform's edge: 4 dp on Android, 16 pt on iOS.
  const ios = navigationProps("native-toolbar", { toolbarHeight: 78, toolbarInset: 34, toolbarPlatform: "ios" });
  expect(ios.style).toEqual([{ height: 78, paddingBottom: 34, paddingHorizontal: 16, flexDirection: "row", alignItems: "center" }, undefined]);
  expect("toolbarPlatform" in ios).toBe(false);
  expect(navigationProps("native-toolbar", { hidden: false, translucent: false, tint: "papayawhip", slots: 0 }).nativeID).toBe("svelte:toolbar");
  expect(navigationProps("native-toolbar", { slots: 1 }).nativeID).toBe("svelte:toolbar;sl=1");
});

test("toolbar items encode their key, title, icon, badge and flags; a spacer carries nothing else; the center is its own kind", () => {
  const row = { flexDirection: "row", alignItems: "center", justifyContent: "center" };
  expect(navigationProps("native-toolbar-item", {}).nativeID).toBe("svelte:toolbar-item");
  // An item has a fixed width, whatever its content: Yoga and the native side place it by the same number, so a flex: 1 center gets the span the items leave.
  expect(navigationProps("native-toolbar-item", {}).style).toEqual([{ width: 48, marginHorizontal: 0, ...row }, undefined]);
  expect(navigationProps("native-toolbar-item", { toolbarPlatform: "android" }).style).toEqual([{ width: 48, marginHorizontal: 0, ...row }, undefined]);
  // On iOS an item is UIKit's 44 pt button with 4 pt each side: it occupies 52.
  expect(navigationProps("native-toolbar-item", { toolbarPlatform: "ios" }).style).toEqual([{ width: 44, marginHorizontal: 4, ...row }, undefined]);
  // The item is the only press: its JavaScript node takes touches as a box and its children (a snippet icon) take none; a spacer, the band and the center are left alone.
  expect(navigationProps("native-toolbar-item", {}).pointerEvents).toBe("box-only");
  expect(navigationProps("native-toolbar-item", { toolbarPlatform: "ios", iconView: true, itemKey: "s" }).pointerEvents).toBe("box-only");
  expect(navigationProps("native-toolbar-item", { pointerEvents: "auto" }).pointerEvents).toBe("box-only");
  expect("pointerEvents" in navigationProps("native-toolbar-item", { spacer: true })).toBe(false);
  expect("pointerEvents" in navigationProps("native-toolbar-center", {})).toBe(false);
  expect("pointerEvents" in navigationProps("native-toolbar", {})).toBe(false);
  const full = navigationProps("native-toolbar-item", { itemKey: "in/box", title: "A;B=C, 100%", icon: "asset:/a b.png", iconView: false, badge: 120, disabled: true, accessibilityLabel: "Open", testID: "item" });
  expect(full.nativeID).toBe("svelte:toolbar-item;k=in%2Fbox;t=A%3BB%3DC%2C%20100%25;ic=asset%3A%2Fa%20b.png;bd=99%2B;ds=1");
  expect(full.accessibilityLabel).toBe("Open");
  expect(full.testID).toBe("item");
  for (const key of ["itemKey", "title", "icon", "iconView", "badge", "disabled", "toolbarPlatform", "centered"]) expect(key in full).toBe(false);
  expect(navigationProps("native-toolbar-item", { itemKey: "flag", title: "Flag", badge: true }).nativeID).toBe("svelte:toolbar-item;k=flag;t=Flag;bd=");
  expect(navigationProps("native-toolbar-item", { itemKey: "n", title: "N", badge: "new" }).nativeID).toBe("svelte:toolbar-item;k=n;t=N;bd=new");
  expect(navigationProps("native-toolbar-item", { itemKey: "n", title: "N", badge: 0 }).nativeID).toBe("svelte:toolbar-item;k=n;t=N");
  expect(navigationProps("native-toolbar-item", { itemKey: "s", title: "S", iconView: true }).nativeID).toBe("svelte:toolbar-item;k=s;t=S;iv=1");
  const spacer = navigationProps("native-toolbar-item", { itemKey: "gap", title: "x", icon: "asset:/x.png", badge: true, disabled: true, spacer: true });
  expect(spacer.nativeID).toBe("svelte:toolbar-item;sp=1");
  expect(spacer.style).toEqual([{ flexGrow: 1 }, undefined]);
  // Beside a center slot a spacer does not grow: the center takes all the free width, as the native sides place it. A spacer has no width, so the platform does not matter.
  const beside = navigationProps("native-toolbar-item", { spacer: true, centered: true, toolbarPlatform: "ios" });
  expect(beside.style).toEqual([{ flexGrow: 0 }, undefined]);
  expect(navigationProps("native-toolbar-item", { spacer: true, centered: false, toolbarPlatform: "ios" }).style).toEqual([{ flexGrow: 1 }, undefined]);
  for (const key of ["spacer", "centered", "toolbarPlatform"]) expect(key in beside).toBe(false);
  const center = navigationProps("native-toolbar-center", {});
  expect(center.nativeID).toBe("svelte:toolbar-center");
  expect(center.style).toEqual([{ flex: 1, ...row }, undefined]);
});

test("toolbar tags are navigation tags with their engine kinds; the bar is 56 dp on Android and 44 pt on iOS, plus the bottom inset", () => {
  for (const tag of ["native-toolbar", "native-toolbar-item", "native-toolbar-center"]) expect(navigationTags.has(tag)).toBe(true);
  expect([NAV_KINDS.toolbar, NAV_KINDS["toolbar-item"], NAV_KINDS["toolbar-center"]]).toEqual([17, 18, 13]);
  expect(TOOLBAR_BAR).toEqual({ android: 56, ios: 44 });
  expect(toolbarHeight("android", 34)).toBe(90);
  expect(toolbarHeight("ios", 34)).toBe(78);
  expect(toolbarHeight("ios", 0)).toBe(44);
});

test("the toolbar row has one geometry: Yoga's widths are the numbers the native sides place the items by", () => {
  expect(TOOLBAR_METRICS).toEqual({ android: { edge: 4, item: 48, gap: 0 }, ios: { edge: 16, item: 44, gap: 4 } });
  // What the center's `flex: 1` gets: the band's width less its two edges and every solid item with its margins. Android: 360 dp, three items; iOS: 390 pt, three items.
  const center = (platform: "android" | "ios", width: number, solid: number) => {
    const m = TOOLBAR_METRICS[platform];
    return width - 2 * m.edge - (m.item + 2 * m.gap) * solid;
  };
  expect(center("android", 360, 3)).toBe(208);
  expect(center("ios", 390, 3)).toBe(202);
  // The iOS numbers are the ones the UIKit side budgets: 32 for the edges, 52 for an item.
  expect(2 * TOOLBAR_METRICS.ios.edge).toBe(32);
  expect(TOOLBAR_METRICS.ios.item + 2 * TOOLBAR_METRICS.ios.gap).toBe(52);
});

test("colors reach the wire as rrggbbaa; forms the contract does not carry are dropped", () => {
  const wire: [unknown, string | undefined][] = [
    ["#fff", "ffffffff"], ["#0a8", "00aa88ff"], ["#0a8c", "00aa88cc"], ["#102030", "102030ff"], ["#10203040", "10203040"], [" #ABCDEF ", "abcdefff"],
    ["rgb(255, 0, 10)", "ff000aff"], ["rgba(0,0,0,0.5)", "00000080"], ["RGBA(1, 2, 3, 1)", "010203ff"], ["rgb(300, 0, 0)", "ff0000ff"], ["transparent", "00000000"],
    [0xff112233, "112233ff"], [-1, "ffffffff"], [0x00000000, "00000000"],
    ["red", undefined], ["#12", undefined], ["#12345", undefined], ["rgb(1, 2)", undefined], ["hsl(0, 0%, 0%)", undefined], [1.5, undefined], [undefined, undefined], [{ semantic: "label" }, undefined],
  ];
  for (const [input, expected] of wire) expect(colorToWire(input)).toBe(expected);
});

test("tab badges: dot, numbers capped at 99+, text", () => {
  expect([true, 3, 99, 100, 2.9, 0, -1, Number.NaN, "new", "", false, undefined].map(badgeText)).toEqual(["", "3", "99", "99+", "2", undefined, undefined, undefined, "new", undefined, undefined, undefined]);
});

test("sheet detents: valid entries only, given order, at most four, a default when none is valid", () => {
  expect(normalizeDetents(undefined)).toEqual([0.5, 1]);
  expect(normalizeDetents([])).toEqual([0.5, 1]);
  expect(normalizeDetents([0, -1, 1.5, "full", null])).toEqual([0.5, 1]);
  expect(normalizeDetents([0.3, "auto", 1, 0.9, 0.8, 0.7, 0.3])).toEqual([0.3, "auto", 1, 0.9]);
  expect(normalizeDetents(["auto", "auto"])).toEqual(["auto"]);
});

test("header height is the status bar inset plus the bar, plus the large title area", () => {
  expect(headerHeight("android", 24, false)).toBe(80);
  expect(headerHeight("android", 24, true)).toBe(136);
  expect(headerHeight("ios", 59, false)).toBe(103);
  expect(headerHeight("ios", 59, true)).toBe(155);
});

test("nativeID parsing keeps values encoded until read; lists split before decoding", () => {
  expect(parseNativeID("svelte:header;t=a%3Bb;bd=;l=1")).toEqual({ kind: "header", pairs: { t: "a%3Bb", bd: "", l: "1" } });
  expect(parseNativeID("svelte:stack")).toEqual({ kind: "stack", pairs: {} });
  expect(parseNativeID("other:thing")).toBeNull();
  expect(decodeValue("a%3Bb%3Dc")).toBe("a;b=c");
  expect(decodeList("a%2Cb,c")).toEqual(["a,b", "c"]);
  expect(decodeList("")).toEqual([]);
});

test("reference decoder: the prop records every nativeID stands for (golden vectors for the native decoders)", () => {
  expect(decodeRecords("svelte:stack")).toEqual({ kind: 10, records: [] });
  expect(decodeRecords("svelte:screen;a=2;p=push;g=1;s=default;b=1")).toEqual({ kind: 11, records: [{ id: 110, values: [2, 0, 1, 0, 1] }] });
  expect(decodeRecords("svelte:screen;a=1;p=transparentModal;g=0;s=slide_from_bottom;b=0")).toEqual({ kind: 11, records: [{ id: 110, values: [1, 2, 0, 4, 0] }] });
  expect(decodeRecords("svelte:screen;a=2;p=formSheet;g=1;s=none;b=1")?.records).toEqual([{ id: 110, values: [2, 4, 1, 1, 1] }, { id: 122, values: [1, 1, 0, 0, 1, 0] }]);
  expect(decodeRecords("svelte:screen;a=2;p=formSheet;g=1;s=default;b=1;gr=1;dm=0;bd=1")?.records[1]).toEqual({ id: 122, values: [1, 1, 0, 1, 0, 1] });
  expect(decodeRecords("svelte:screen;a=2;p=sheet;g=1;s=default;b=1")?.records).toEqual([{ id: 110, values: [2, 3, 1, 0, 1] }, { id: 122, values: [2, 0.5, 1, 0, 1, 1, 0] }]);
  expect(decodeRecords("svelte:screen;a=2;p=sheet;g=1;s=default;b=1;dt=auto,0.75,1,0.1;di=1;gr=0;dm=0;bd=1;ss=l;sx=1;nc=102030ff;ns=d")).toEqual({
    kind: 11,
    records: [
      { id: 110, values: [2, 3, 1, 0, 1] },
      { id: 122, values: [4, -1, 0.75, 1, 0.1, 1, 0, 0, 1] },
      { id: 125, values: [1, 1, 1, 0xff102030, 2] },
    ],
  });
  expect(decodeRecords("svelte:screen;a=2;p=push;g=1;s=default;b=1;ss=d")?.records[1]).toEqual({ id: 125, values: [2, 0, 0, 0, 0] });

  expect(decodeRecords("svelte:header")).toEqual({ kind: 12, records: [{ id: 120, values: [0, -1, -1, -1, 0, 0, 0, 0] }, { id: 121, values: [0] }] });
  expect(decodeRecords("svelte:header;t=A%3BB%3DC%2C%20100%25;st=sub;bt=Back;l=1;tl=1;bk=1;hs=1;tc=ffffffff;bg=00000080;sl=3")?.records).toEqual([
    { id: 120, values: [15, "A;B=C, 100%", "sub", "Back", 1, 0xffffffff, 1, 0x80000000] },
    { id: 121, values: [3] },
  ]);
  expect(decodeRecords("svelte:header;l=1;sl=15")?.records).toEqual([{ id: 120, values: [1, -1, -1, -1, 0, 0, 0, 0] }, { id: 121, values: [15] }]);
  expect(decodeRecords("svelte:header-left")).toEqual({ kind: 13, records: [{ id: 126, values: [0] }] });
  expect(decodeRecords("svelte:header-center")?.records).toEqual([{ id: 126, values: [1] }]);
  expect(decodeRecords("svelte:header-right")?.records).toEqual([{ id: 126, values: [2] }]);
  expect(decodeRecords("svelte:header-search")?.records).toEqual([{ id: 126, values: [3] }, { id: 127, values: [-1, -1, 0] }]);
  expect(decodeRecords("svelte:header-search;ph=Search%E2%80%A6;v=a%20b;ec=4")?.records).toEqual([{ id: 126, values: [3] }, { id: 127, values: ["Search…", "a b", 4] }]);

  expect(decodeRecords("svelte:tabs")).toEqual({ kind: 14, records: [{ id: 123, values: [0, 0, 0, 0, 0, 0, 0, 0, 0] }] });
  expect(decodeRecords("svelte:tabs;sel=2;sc=5;tc=0a84ffff;uc=8e8e93ff;bg=ffffffff;lb=1")?.records).toEqual([{ id: 123, values: [2, 5, 1, 0xff0a84ff, 1, 0xff8e8e93, 1, 0xffffffff, 1] }]);
  expect(decodeRecords("svelte:tab")).toEqual({ kind: 15, records: [{ id: 124, values: [-1, -1, -1, -1, 0, 0, -1, 0] }] });
  expect(decodeRecords("svelte:tab;k=in%2Fbox;t=Inbox;ic=asset%3A%2Fa%20b.png;is=https%3A%2F%2Fx%2Fy.png%3Fa%3D1%26b%3D2;bd=99%2B;ds=1")?.records)
    .toEqual([{ id: 124, values: ["in/box", "Inbox", "asset:/a b.png", "https://x/y.png?a=1&b=2", 0, 2, "99+", 1] }]);
  expect(decodeRecords("svelte:tab;k=me;t=Me;iv=1;bd=")?.records).toEqual([{ id: 124, values: ["me", "Me", -1, -1, 1, 1, "", 0] }]);
  expect(decodeRecords("svelte:tab-icon")).toEqual({ kind: 16, records: [] });

  // Toolbar: record 128 (flags 1 hidden 2 translucent, tint, background, slot mask), record 129 per item, the center is slot 4 of record 126.
  expect(decodeRecords("svelte:toolbar")).toEqual({ kind: 17, records: [{ id: 128, values: [0, 0, 0, 0, 0, 0] }] });
  expect(decodeRecords("svelte:toolbar;hd=1;tl=1;tc=ffffffff;bg=00000080;sl=1")?.records).toEqual([{ id: 128, values: [3, 1, 0xffffffff, 1, 0x80000000, 1] }]);
  expect(decodeRecords("svelte:toolbar;tl=1;tc=0a84ffff")?.records).toEqual([{ id: 128, values: [2, 1, 0xff0a84ff, 0, 0, 0] }]);
  expect(decodeRecords("svelte:toolbar-item")).toEqual({ kind: 18, records: [{ id: 129, values: [-1, -1, -1, 0, 0, -1, 0, 0] }] });
  expect(decodeRecords("svelte:toolbar-item;k=in%2Fbox;t=A%3BB%3DC%2C%20100%25;ic=asset%3A%2Fa%20b.png;bd=99%2B;ds=1")?.records)
    .toEqual([{ id: 129, values: ["in/box", "A;B=C, 100%", "asset:/a b.png", 0, 2, "99+", 1, 0] }]);
  expect(decodeRecords("svelte:toolbar-item;k=flag;t=Flag;bd=")?.records).toEqual([{ id: 129, values: ["flag", "Flag", -1, 0, 1, "", 0, 0] }]);
  expect(decodeRecords("svelte:toolbar-item;k=n;t=N;bd=new")?.records).toEqual([{ id: 129, values: ["n", "N", -1, 0, 2, "new", 0, 0] }]);
  expect(decodeRecords("svelte:toolbar-item;k=s;t=S;iv=1")?.records).toEqual([{ id: 129, values: ["s", "S", -1, 1, 0, -1, 0, 0] }]);
  expect(decodeRecords("svelte:toolbar-item;sp=1")?.records).toEqual([{ id: 129, values: [-1, -1, -1, 0, 0, -1, 0, 1] }]);
  expect(decodeRecords("svelte:toolbar-center")).toEqual({ kind: 13, records: [{ id: 126, values: [4] }] });

  expect(decodeRecords("svelte:bogus")).toBeNull();
  expect(decodeRecords("view-1")).toBeNull();
});

test("every encoder output decodes: the records of a nativeID built by navigationProps agree with its attributes", () => {
  const cases: [string, Record<string, unknown>][] = [
    ["native-screen", { stackPresentation: "sheet", sheetDetents: [0.4, "auto"], sheetInitialDetent: "auto", navigationBarColor: "rgb(1, 2, 3)" }],
    ["native-header", { title: "T", large: true, slots: 5 }],
    ["native-header-search", { placeholder: "p", eventCount: 2 }],
    ["native-tabs", { selectedIndex: 1, tint: "#123456" }],
    ["native-tab", { tabKey: "k", title: "t", badge: 7 }],
    ["native-toolbar", { translucent: true, tint: "#123456", slots: 1 }],
    ["native-toolbar-item", { itemKey: "k", title: "t", badge: true, disabled: true }],
    ["native-toolbar-item", { spacer: true }],
    ["native-toolbar-center", {}],
  ];
  for (const [name, attributes] of cases) {
    const decoded = decodeRecords(String(navigationProps(name, attributes).nativeID));
    expect(decoded?.records.length).toBeGreaterThan(0);
  }
  expect(decodeRecords(String(navigationProps("native-screen", cases[0][1]).nativeID))?.records[1]).toEqual({ id: 122, values: [2, 0.4, -1, 1, 1, 1, 0] });
  expect(decodeRecords(String(navigationProps("native-screen", cases[0][1]).nativeID))?.records[2]).toEqual({ id: 125, values: [0, 0, 1, 0xff010203, 0] });
});

test("merging screen options: the inner value wins, objects merge, handlers chain, undefined never overrides", () => {
  const order: string[] = [];
  const merged = mergeScreenOptions(
    { title: "A", subtitle: "base", header: { large: true, hideBack: true }, sheet: { grabber: false }, onDismiss: () => order.push("outer"), onAppear: () => order.push("appear"), canGoBack: true },
    { title: "B", subtitle: undefined, header: { large: undefined, tint: "#fff" }, onDismiss: () => order.push("inner"), onDisappear: () => order.push("disappear") },
  );
  expect(merged.title).toBe("B");
  expect(merged.subtitle).toBe("base");
  expect(merged.header).toEqual({ large: true, hideBack: true, tint: "#fff" });
  expect(merged.sheet).toEqual({ grabber: false });
  expect(merged.canGoBack).toBe(true);
  merged.onDismiss?.();
  merged.onAppear?.();
  merged.onDisappear?.();
  expect(order).toEqual(["outer", "inner", "appear", "disappear"]);
  expect(mergeScreenOptions({ title: "A" }, {})).toEqual({ title: "A" });
});

test("merging screen options: the toolbar merges like the header, key by key, and the inner items replace the outer ones", () => {
  const outer = () => {};
  const inner = () => {};
  const merged = mergeScreenOptions(
    { toolbar: { translucent: true, tint: "#fff", items: [{ key: "a" }], onPress: outer } },
    { toolbar: { tint: "#000", translucent: undefined, items: [{ key: "b" }, { key: "gap", spacer: true }], onPress: inner } },
  );
  expect(merged.toolbar).toEqual({ translucent: true, tint: "#000", items: [{ key: "b" }, { key: "gap", spacer: true }], onPress: inner });
  expect(mergeScreenOptions({ toolbar: { tint: "#fff" } }, {}).toolbar).toEqual({ tint: "#fff" });
  expect(mergeScreenOptions({}, { toolbar: { hidden: true } }).toolbar).toEqual({ hidden: true });
});
