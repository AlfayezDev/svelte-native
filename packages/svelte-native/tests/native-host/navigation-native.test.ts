import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { decodeRecords, navigationProps, type NavRecord } from "../../src/fabric/navigation.ts";
import { cppHost, hostTools, kotlinHost } from "../support/native-host.ts";

/**
 * The native decoders against the reference decoder. `decodeRecords` is the contract's executable form; the engine's C++
 * encoder (`PropsEncoderNavRecords.h`) and Kotlin decoder (`PropsNav.kt`) are compiled for the host here, fed the same
 * `nativeID`s, and must produce exactly the records it lists: the same ints, float bits and strings out of C++, the same
 * fields out of Kotlin. Skipped when `g++`, `kotlinc` or `java` is not on the path.
 */
const native = resolve(import.meta.dirname, "fixtures");
const engine = resolve(import.meta.dirname, "../../native/svelte-core/android/src/main");
const sources = {
  header: resolve(engine, "cpp/PropsEncoderNavRecords.h"),
  cpp: resolve(native, "nav-records-host.cpp"),
  props: resolve(engine, "java/expo/modules/svelteengine/PropsNav.kt"),
  host: resolve(native, "NavRecordsHost.kt"),
  stub: resolve(native, "DoNotStripStub.kt"),
};
const tools = hostTools("g++", "kotlinc", "java");
const encoder = cppHost({ name: "nav-records-host", sources: [sources.cpp], dependencies: [sources.header], flags: ["-std=c++20", "-Wall", "-Wextra", "-Werror", "-I", resolve(engine, "cpp")] });
const decoder = kotlinHost({ name: "nav-records-host", sources: [sources.host, sources.stub, sources.props] });

const ids: string[] = [];
const add = (name: string, attributes: Record<string, unknown>) => ids.push(String(navigationProps(name, attributes).nativeID));

// Screens: every presentation, animation, sheet option and system bar key the encoder can write.
for (const stackPresentation of ["push", "modal", "transparentModal", "sheet", "formSheet"]) add("native-screen", { stackPresentation });
add("native-screen", { activityState: 0, gestureEnabled: false, stackAnimation: "slide_from_bottom", nativeBackButtonDismissalEnabled: false });
add("native-screen", { activityState: 1, stackAnimation: "fade" });
add("native-screen", { stackAnimation: "none", statusBarStyle: "light", statusBarHidden: true });
add("native-screen", { stackPresentation: "sheet", sheetDetents: ["auto", 0.75, 1, 0.1], sheetInitialDetent: 0.75, sheetGrabber: false, sheetDismissible: false, sheetBackdrop: "none" });
add("native-screen", { stackPresentation: "sheet", sheetDetents: [0.3], navigationBarColor: "#102030", navigationBarStyle: "dark", statusBarStyle: "dark" });
add("native-screen", { stackPresentation: "sheet", sheetDetents: [0.25, 0.5, 0.75, 1], sheetInitialDetent: 1 });
add("native-screen", { stackPresentation: "formSheet", sheetGrabber: true, sheetDismissible: false, sheetBackdrop: "none", navigationBarColor: "rgba(1, 2, 3, 0.5)" });
add("native-screen", { stackPresentation: "modal", statusBarHidden: true, navigationBarStyle: "light" });
// Headers: text that needs percent-encoding, every flag, colors, slot masks.
add("native-header", {});
add("native-header", { title: "A;B=C, 100%", subtitle: "sub", backTitle: "Back", large: true, translucent: true, back: true, hideShadow: true, tint: "#fff", background: "rgba(0, 0, 0, 0.5)", slots: 3 });
add("native-header", { title: "عنوان 😀 日本語", subtitle: "é", slots: 15, tint: "#0a8c" });
add("native-header", { large: true, slots: 8, background: "#102030" });
add("native-header", { title: "T", back: true, slots: 1 });
for (const name of ["native-header-left", "native-header-center", "native-header-right"]) add(name, {});
add("native-header-search", {});
add("native-header-search", { placeholder: "Search…", value: "a b", eventCount: 4 });
add("native-header-search", { placeholder: "x", eventCount: 120 });
// Tabs and tab items.
add("native-tabs", {});
add("native-tabs", { selectedIndex: 2, selectCount: 5, tint: "#0a84ff", inactiveTint: "#8e8e93", background: "#fff", labels: "never" });
add("native-tabs", { selectedIndex: 1, tint: "rgba(1, 2, 3, 0.5)" });
add("native-tab", { tabKey: "home", title: "Home", icon: "asset:/home.png", selectedIcon: "asset:/home-fill.png" });
add("native-tab", { tabKey: "in/box", title: "Inbox", icon: "asset:/a b.png", selectedIcon: "https://x/y.png?a=1&b=2", badge: 120, disabled: true });
add("native-tab", { tabKey: "me", title: "Me", iconView: true, badge: true });
add("native-tab", { tabKey: "t", title: "T", badge: "new" });
add("native-tab", { tabKey: "t", title: "T", badge: 7 });
add("native-tab", {});
add("native-tab-icon", {});
add("native-stack", {});
// Toolbars and their items: every flag, colors, the center slot, a spacer, badges of each kind, a snippet icon, a disabled item.
add("native-toolbar", {});
add("native-toolbar", { hidden: true, translucent: true, tint: "#0a84ff", background: "rgba(0, 0, 0, 0.5)", slots: 1 });
add("native-toolbar", { translucent: true, slots: 1, tint: "#fff" });
add("native-toolbar-item", { itemKey: "reply", title: "Reply", icon: "asset:/reply.png" });
add("native-toolbar-item", { itemKey: "a;b", title: "A;B=C, 100%", icon: "https://x/y.png?a=1&b=2", badge: 120, disabled: true });
add("native-toolbar-item", { itemKey: "flag", title: "Flag", iconView: true, badge: true });
add("native-toolbar-item", { itemKey: "t", title: "T", badge: "new" });
add("native-toolbar-item", { spacer: true });
add("native-toolbar-item", {});
add("native-toolbar-center", {});
// Hand-written forms: keys in another order, unknown keys, a key repeated by mistake is not exercised (encoders never emit one).
ids.push(
  "svelte:screen;zz=1;ss=l;b=0;g=0;s=fade;p=sheet;a=1;dt=0.5,auto;di=9;xx=y",
  "svelte:header;sl=5;unknown=%E2%82%AC;t=%E2%82%AC",
  "svelte:tab;ds=1;k=a;bd=;t=",
  "svelte:tabs;lb=1;sel=3",
  "svelte:header-search;v=;ec=2",
  "svelte:bogus;a=1",
  "not-a-native-id",
  "svelte:",
);


/** The ints and strings the engine batch carries for the records: strings are table indices (-1 absent), the detents of record 122 floats. */
function expectedBatch(records: NavRecord[]) {
  const ops: number[] = [];
  const strings: string[] = [];
  const bits = new DataView(new ArrayBuffer(4));
  for (const record of records) {
    ops.push(record.id);
    record.values.forEach((value, index) => {
      const detent = record.id === 122 && index >= 1 && index <= Number(record.values[0]);
      if (typeof value === "string") { strings.push(value); ops.push(strings.length - 1); }
      else if (detent) { bits.setFloat32(0, value); ops.push(bits.getInt32(0)); }
      else ops.push(value | 0);
    });
  }
  return { ops, strings };
}

type Fields = Record<string, unknown>;
const text = (value: number | string | undefined) => typeof value === "string" ? value : null;
/** What `PropsNav.decode` leaves in `NavProps` for the records: the Kotlin class's defaults, then each record's values by the SPEC table. */
function expectedFields(records: NavRecord[]): Fields {
  const f: Fields = {
    seen: false, activityState: 2, presentation: 0, gestureEnabled: true, animation: 0, backDismissal: true,
    sheetSeen: false, detents: [], initialDetent: 0, grabber: true, dismissible: true, backdropNone: false,
    barsSeen: false, statusStyle: 0, statusHidden: false, hasNavColor: false, navColor: 0, navStyle: 0,
    headerSeen: false, headerFlags: 0, title: null, subtitle: null, backTitle: null, hasTint: false, tint: 0, hasBackground: false, background: 0, slotMask: 0,
    slotSeen: false, slot: 0, searchSeen: false, placeholder: null, searchValue: null, searchCount: 0,
    tabsSeen: false, selectedIndex: 0, selectCount: 0, hasTabTint: false, tabTint: 0, hasInactiveTint: false, inactiveTint: 0, hasTabBackground: false, tabBackground: 0, labelsHidden: false,
    tabSeen: false, tabKey: null, tabTitle: null, iconUri: null, selectedIconUri: null, iconIsView: false, badgeKind: 0, badgeText: null, tabDisabled: false,
    toolbarSeen: false, toolbarFlags: 0, hasToolbarTint: false, toolbarTint: 0, hasToolbarBackground: false, toolbarBackground: 0, toolbarSlots: 0,
    itemSeen: false, itemKey: null, itemTitle: null, itemIconUri: null, itemIconIsView: false, itemBadgeKind: 0, itemBadgeText: null, itemDisabled: false, itemSpacer: false,
  };
  for (const { id, values: v } of records) {
    switch (id) {
      case 110: Object.assign(f, { seen: true, activityState: v[0], presentation: v[1], gestureEnabled: v[2] === 1, animation: v[3], backDismissal: v[4] === 1 }); break;
      case 120: Object.assign(f, { headerSeen: true, headerFlags: v[0], title: text(v[1]), subtitle: text(v[2]), backTitle: text(v[3]), hasTint: v[4] === 1, tint: Number(v[5]) | 0, hasBackground: v[6] === 1, background: Number(v[7]) | 0 }); break;
      case 121: f.slotMask = v[0]; break;
      case 122: {
        const count = Number(v[0]);
        Object.assign(f, { sheetSeen: true, detents: v.slice(1, 1 + count).map((d) => Math.fround(Number(d))), initialDetent: v[1 + count], grabber: v[2 + count] === 1, dismissible: v[3 + count] === 1, backdropNone: v[4 + count] === 1 });
        break;
      }
      case 123: Object.assign(f, { tabsSeen: true, selectedIndex: v[0], selectCount: v[1], hasTabTint: v[2] === 1, tabTint: Number(v[3]) | 0, hasInactiveTint: v[4] === 1, inactiveTint: Number(v[5]) | 0, hasTabBackground: v[6] === 1, tabBackground: Number(v[7]) | 0, labelsHidden: v[8] === 1 }); break;
      case 124: Object.assign(f, { tabSeen: true, tabKey: text(v[0]), tabTitle: text(v[1]), iconUri: text(v[2]), selectedIconUri: text(v[3]), iconIsView: v[4] === 1, badgeKind: v[5], badgeText: text(v[6]), tabDisabled: v[7] === 1 }); break;
      case 125: Object.assign(f, { barsSeen: true, statusStyle: v[0], statusHidden: v[1] === 1, hasNavColor: v[2] === 1, navColor: Number(v[3]) | 0, navStyle: v[4] }); break;
      case 126: Object.assign(f, { slotSeen: true, slot: v[0] }); break;
      case 127: Object.assign(f, { searchSeen: true, placeholder: text(v[0]), searchValue: text(v[1]), searchCount: v[2] }); break;
      case 128: Object.assign(f, { toolbarSeen: true, toolbarFlags: v[0], hasToolbarTint: v[1] === 1, toolbarTint: Number(v[2]) | 0, hasToolbarBackground: v[3] === 1, toolbarBackground: Number(v[4]) | 0, toolbarSlots: v[5] }); break;
      case 129: Object.assign(f, { itemSeen: true, itemKey: text(v[0]), itemTitle: text(v[1]), itemIconUri: text(v[2]), itemIconIsView: v[3] === 1, itemBadgeKind: v[4], itemBadgeText: text(v[5]), itemDisabled: v[6] === 1, itemSpacer: v[7] === 1 }); break;
      default: throw new Error(`no oracle for record ${id}`);
    }
  }
  return f;
}

test.skipIf(!tools)("the engine's C++ encoder writes the records decodeRecords lists, and its Kotlin decoder reads them back", () => {
  const batch = encoder.run(`${ids.join("\n")}\n`).split("\n");
  const decoded = decoder.runRaw(batch.join("\n")).trim().split("\n");
  expect(decoded).toHaveLength(ids.length);

  ids.forEach((id, node) => {
    const reference = decodeRecords(id);
    const [kind, count, opsLine, stringsLine] = batch.slice(node * 4, node * 4 + 4);
    expect(Number(kind.slice("kind ".length)), id).toBe(reference?.kind ?? 0);
    expect(Number(count.slice("count ".length)), id).toBe(reference?.records.length ?? 0);
    const expected = expectedBatch(reference?.records ?? []);
    const ops = opsLine.slice("ops".length).trim().split(" ").filter(Boolean).map(Number);
    const strings = stringsLine.slice("strings".length).trim().split(" ").filter(Boolean).map((hex) => hex === "-" ? "" : Buffer.from(hex, "hex").toString("utf8"));
    expect(ops, id).toEqual(expected.ops);
    expect(strings, id).toEqual(expected.strings);

    const fields = JSON.parse(decoded[node]) as Fields;
    fields.detents = (fields.detents as number[]).map(Math.fround);
    expect(fields, id).toEqual(expectedFields(reference?.records ?? []));
  });
}, 180_000);

test("the corpus covers every record the engine consumes", () => {
  const seen = new Set(ids.flatMap((id) => decodeRecords(id)?.records.map((record) => record.id) ?? []));
  expect([...seen].sort((a, b) => a - b)).toEqual([110, 120, 121, 122, 123, 124, 125, 126, 127, 128, 129]);
  // Every value kind the wire has: absent and present strings, an empty string, colors with and without alpha, float detents, and "auto".
  const records = ids.flatMap((id) => decodeRecords(id)?.records ?? []);
  expect(records.some((record) => record.id === 122 && record.values.slice(1, 1 + Number(record.values[0])).includes(-1))).toBe(true);
  expect(records.some((record) => record.id === 124 && record.values[6] === "")).toBe(true);
  expect(records.some((record) => record.id === 120 && record.values[4] === 1 && record.values[6] === 1)).toBe(true);
  expect(records.some((record) => record.id === 125 && record.values[2] === 1)).toBe(true);
  expect(records.some((record) => record.id === 126 && record.values[0] === 4)).toBe(true);
  expect(records.some((record) => record.id === 129 && record.values[7] === 1)).toBe(true);
  expect(records.some((record) => record.id === 129 && record.values[5] === "")).toBe(true);
});
