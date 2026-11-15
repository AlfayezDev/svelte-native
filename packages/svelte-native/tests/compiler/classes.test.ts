import { afterEach, beforeEach, describe, expect, jest, spyOn, test } from "bun:test";
import { resolve } from "node:path";
import { classList } from "../../src/classes.ts";
import type { ClassTable } from "../../src/css/table.ts";
import type { NativeNode } from "../../src/renderer.ts";
import { load, src } from "../support/bundle.ts";

// `class` on components through the class table: a small table stands in for `@alfayez/svelte-native/classes-table` (what `css/build.ts` writes and
// Metro serves), and the three modules of React Native the resolver reads (`Appearance`, `Dimensions`, `Platform`) and the engine module the insets come
// from are stand-ins that the test drives. They are one module of the bundle, whose state is exported with the rest, so each test has a device of its own.
//
// What the cascade, the conditions, the device values, the removals and the warnings do is the resolver's, whichever way a `class` reaches it, so those tests run once, on
// components. The tests where the way matters (the style under the element's own, what a change of state redraws, a spread, a size that comes from the element's own style)
// run for components and for the host tags the lowering writes.
type Insets = { top: number; right: number; bottom: number; left: number };
type Stub = {
  scheme: "light" | "dark" | null;
  appearance: Set<() => void>;
  window: { width: number; height: number };
  windowListeners: Set<() => void>;
  os: "ios" | "android";
  engine: { current: (Insets & Record<string, unknown>) | null; listeners: Set<(event: Insets & Record<string, unknown>) => void> };
};

const stateModule = `export const state = { scheme: "light", appearance: new Set(), window: { width: 400, height: 800 }, windowListeners: new Set(), os: "android", engine: { current: null, listeners: new Set() } };`;
const appearanceModule = `import { state } from "classes-test-state";
  export const getColorScheme = () => state.scheme;
  export const addChangeListener = (listener) => { state.appearance.add(listener); return { remove() { state.appearance.delete(listener); } }; };`;
const dimensionsModule = `import { state } from "classes-test-state";
  export default {
    get: () => state.window,
    addEventListener: (type, listener) => { state.windowListeners.add(listener); return { remove() { state.windowListeners.delete(listener); } }; },
  };`;
const platformModule = `import { state } from "classes-test-state";
  export default { get OS() { return state.os; } };`;
// The engine module the insets come from (expo-modules-core's requireOptionalNativeModule), with the current value it reports first.
const expoModulesCore = `import { state } from "classes-test-state";
  export const EventEmitter = class {};
  export const requireOptionalNativeModule = (name) => name !== "SvelteEngine" ? null : ({
    getInsets: () => state.engine.current,
    addListener: (event, listener) => { if (event === "insets") state.engine.listeners.add(listener); return { remove() { state.engine.listeners.delete(listener); } }; },
  });`;

const emitInsets = (stub: Stub, event: Insets & Record<string, unknown>) => { for (const listener of [...stub.engine.listeners]) listener(event); };
const engineInsets = (top: number, bottom = 0, left = 0) => ({ top, right: 0, bottom, left, keyboardHeight: 0, keyboardVisible: false, frame: { x: 0, y: 0, width: 400, height: 800 } });
const emitAppearance = (stub: Stub) => { for (const listener of [...stub.appearance]) listener(); };
const emitWindow = (stub: Stub) => { for (const listener of [...stub.windowListeners]) listener(); };

// A table the way the converter writes one: rules with their cascade `order`, and conditions, device values and font-relative values where a class has them.
const table: ClassTable = {
  version: 1,
  classes: {
    card: [{ order: 1, style: { padding: 16 } }],
    loud: [{ order: 2, style: { borderWidth: 2 } }],
    label: [{ order: 3, style: { fontSize: 18 } }],
    muted: [{ order: 4, style: { opacity: 0.5 } }],
    "p-4": [{ order: 5, style: { padding: 16 } }],
    themed: [
      { order: 6, when: { scheme: "light" }, style: { backgroundColor: "white" } },
      { order: 7, when: { scheme: "dark" }, style: { backgroundColor: "black" } },
    ],
    wide: [
      { order: 10, style: { padding: 4 } },
      { order: 11, when: { minWidth: 768 }, style: { padding: 24 } },
      { order: 12, when: { maxWidth: 360 }, style: { margin: 2 } },
    ],
    tx: [{ order: 20, style: { "transform:translateX": 8 } }],
    rot: [{ order: 21, style: { "transform:rotate": "45deg" } }],
    big: [{ order: 22, style: { "transform:scaleX": 1.1, "transform:scaleY": 1.1 } }],
    skew: [{ order: 23, style: { transform: [{ skewX: "10deg" }] } }],
    "lh-8": [{ order: 29, style: { lineHeight: 8 } }],
    small: [{ order: 30, style: { fontSize: 12 }, fontRelative: { lineHeight: 1.5 } }],
    snug: [{ order: 31, fontRelative: { lineHeight: 1.25 } }],
    tracking: [{ order: 32, fontRelative: { letterSpacing: 0.1 } }],
    "lh-24": [{ order: 33, style: { lineHeight: 24 } }],
    "leading-none": [{ order: 35, fontRelative: { lineHeight: 1 } }],
    "pt-4": [{ order: 39, style: { paddingTop: 4 } }],
    "pad-top": [{ order: 40, dynamic: { paddingTop: { inset: "top", add: 8 } } }],
    "pt-9": [{ order: 41, style: { paddingTop: 9 } }],
    half: [{ order: 42, dynamic: { width: { window: "width", scale: 0.5 }, height: { window: "height", scale: 1, add: -10 } } }],
    first: [{ order: 50, style: { margin: 1, opacity: 1 } }],
    second: [{ order: 51, style: { margin: 2 } }],
    "tx-none": [{ order: 24, style: { "transform:translateX": null } }],
    "lh-none": [{ order: 34, style: { lineHeight: null } }],
    "pt-none": [{ order: 43, style: { paddingTop: null } }],
    "shadow-md": [{ order: 70, style: { boxShadow: "0 4px 6px rgba(0,0,0,0.1)" } }],
    "shadow-none": [{ order: 71, style: { boxShadow: null } }],
    "shadow-sm": [{ order: 72, style: { boxShadow: "0 1px 2px rgba(0,0,0,0.05)" } }],
    "dark:shadow-none": [{ order: 73, when: { scheme: "dark" }, style: { boxShadow: null } }],
    truncate: [{ order: 80, style: { overflow: "hidden" } }],
    "font-mono": [{ order: 81, style: { fontFamily: "monospace" } }],
    "font-serif": [{ order: 82, style: { fontFamily: "serif" } }],
    "ios-only": [{ order: 60, when: { platform: "ios" }, style: { opacity: 0.1 } }],
    "android-only": [{ order: 61, when: { platform: "android" }, style: { opacity: 0.2 } }],
  },
};
// What the build left out of `classes` and why, as it writes it into the table.
const unsupported = { truncate: "text-overflow: no React Native style for text-overflow", "hover:opacity-50": ":hover: pseudo-classes need state", transition: "transition-property: no React Native style for transition-property; transition-duration: no React Native style for transition-duration" };
const withReasons: ClassTable = { ...table, unsupported };
const empty: ClassTable = { version: 1, classes: {} };


type Loaded = {
  state: Stub; Fixture: unknown; renderer: unknown; NativeNode: typeof NativeNode; mergeHostProps: (props: unknown) => Record<string, unknown>;
  setClassResolver: (resolve: (className: string) => unknown) => void; resolveClasses: (className: string) => unknown;
  setClassTable: (table: ClassTable) => void; UNKNOWN_CLASS_DELAY: number;
  mount: (component: unknown, options: object) => unknown; tick: () => Promise<void>; unmount: (app: unknown) => void;
};
type App = { setTone(next: string): void; setSize(next: number): void };

/** The fixture with `table` as the class table; bundled once for each table and tag form, and evaluated afresh (so with a state of its own) for each test. */
const loadModule = (classTable: ClassTable = table, lowered = false) => load<Loaded>({
  entry: `import Fixture from ${JSON.stringify(resolve(import.meta.dirname, `fixtures/${lowered ? "classes-lowered-fixture" : "classes-fixture"}.svelte`))};
    import renderer, { NativeNode } from ${JSON.stringify(src("renderer.ts"))};
    import { mergeHostProps } from ${JSON.stringify(src("native-props.ts"))};
    import ${JSON.stringify(src("css/load-table.ts"))};
    import { setClassResolver } from ${JSON.stringify(src("classes.ts"))};
    import { resolveClasses, setClassTable, UNKNOWN_CLASS_DELAY } from ${JSON.stringify(src("css/runtime.ts"))};
    import { mount, tick, unmount } from 'svelte';
    export { state } from "classes-test-state";
    export { Fixture, renderer, NativeNode, mergeHostProps, setClassResolver, resolveClasses, setClassTable, UNKNOWN_CLASS_DELAY, mount, tick, unmount };`,
  stubs: {
    "classes-test-state": stateModule,
    "react-native/Libraries/Utilities/Appearance": appearanceModule,
    "react-native/Libraries/Utilities/Dimensions": dimensionsModule,
    "react-native/Libraries/Utilities/Platform": platformModule,
    "expo-modules-core": expoModulesCore,
    "@alfayez/svelte-native/classes-table": `export default ${JSON.stringify(classTable)};`,
    // What the lowered fixture still imports from the package once its View and Text are host tags.
    "@alfayez/svelte-native": ["View", "Text", "SafeAreaView"].map((name) => `export { default as ${name} } from ${JSON.stringify(src(`components/${name}.svelte`))};`).join("\n"),
  },
  converters: false,
  define: { __DEV__: "true" },
  ...(lowered ? { lower: {} } : {}),
});

function nodes(node: NativeNode): NativeNode[] { return [node, ...node.getSnapshot().children.flatMap(nodes)]; }

async function mountFixture(m: Loaded, props: { inline?: boolean; unknown?: boolean } = {}) {
  const root = new m.NativeNode("fragment");
  const app = m.mount(m.Fixture, { target: root, renderer: m.renderer, props });
  await m.tick();
  const styleOf = (testID: string) => {
    const node = nodes(root).find((candidate) => candidate.name.startsWith("native-") && m.mergeHostProps(candidate.getSnapshot().props).testID === testID);
    const props = node ? m.mergeHostProps(node.getSnapshot().props) : undefined;
    expect(props).toBeDefined();
    expect(props).not.toHaveProperty("class");
    return props?.style;
  };
  return { app, styleOf };
}

/** Records each class list the resolver works out (an element does that again whenever what its classes depend on changes), until `calls.length = 0`. */
function spied(m: Loaded) {
  const calls: string[] = [];
  m.setClassResolver((className: string) => { calls.push(className); return m.resolveClasses(className); });
  return calls;
}

const flat = (style: unknown): Record<string, unknown> => Array.isArray(style) ? Object.assign({}, ...style.map(flat)) : (style as Record<string, unknown>) ?? {};

test("class takes a string, an array or an object of names, as on a DOM element", () => {
  expect(classList("  a b ")).toBe("a b");
  expect(classList(["a", false, null, undefined, ["b", { c: true, d: false }], 0, 1])).toBe("a b c 1");
  expect(classList({ a: 1, b: "", c: "yes" })).toBe("a c");
  expect(classList(undefined)).toBe("");
  expect(classList(true)).toBe("");
});

for (const lowered of [false, true]) {
const how = lowered ? "lowered to host tags" : "as components";

test(`the classes become the style, under the inline style (${how})`, async () => {
  const m = await loadModule(table, lowered);
  const { app, styleOf } = await mountFixture(m, { inline: true });
  expect(styleOf("card")).toEqual([{ padding: 16 }, { padding: 1 }]);
  expect(styleOf("label")).toEqual({ fontSize: 18, opacity: 0.5 });
  expect(styleOf("bare")).toBeUndefined();
  m.unmount(app);
});

test(`classes follow the component's state (${how})`, async () => {
  const m = await loadModule(table, lowered);
  const { app, styleOf } = await mountFixture(m);
  expect(styleOf("card")).toEqual({ padding: 16 });
  expect(styleOf("label")).toEqual({ fontSize: 18, opacity: 0.5 });
  (app as App).setTone("loud");
  await m.tick();
  expect(styleOf("card")).toEqual({ padding: 16, borderWidth: 2 });
  expect(styleOf("label")).toEqual({ fontSize: 18 });
  m.unmount(app);
});

test(`a class that depends on the color scheme draws again when the scheme changes, only the elements that depend on it work it out again, and the listener goes with the last view (${how})`, async () => {
  const m = await loadModule(table, lowered);
  const calls = spied(m);
  const { app, styleOf } = await mountFixture(m);
  expect(styleOf("themed")).toEqual({ backgroundColor: "white" });
  // One listener on the appearance for every view that reads it.
  expect(m.state.appearance.size).toBe(1);
  const unrelated = styleOf("card");
  calls.length = 0;
  m.state.scheme = "dark";
  emitAppearance(m.state);
  await m.tick();
  expect(styleOf("themed")).toEqual({ backgroundColor: "black" });
  expect(calls.sort()).toEqual(["shadow-md dark:shadow-none", "themed"]);
  expect(styleOf("card")).toBe(unrelated);
  // A system that reports no scheme counts as light.
  m.state.scheme = null;
  emitAppearance(m.state);
  await m.tick();
  expect(styleOf("themed")).toEqual({ backgroundColor: "white" });
  m.unmount(app);
  await m.tick();
  expect(m.state.appearance.size).toBe(0);
});

test(`a font-relative value is made from the font size of the element's own style, else the classes', else 14; one object per list and size (${how})`, async () => {
  const m = await loadModule(table, lowered);
  const { app, styleOf } = await mountFixture(m);
  const own = (testID: string) => (styleOf(testID) as unknown[])[0];
  expect(styleOf("leading-own")).toEqual([{ lineHeight: 30 }, { fontSize: 30 }]);
  // Arrays and falsy values of styles: the last size.
  expect(own("leading-own-array")).toEqual({ lineHeight: 22 });
  // The style is what is drawn: its size wins over the class's own, which wins over the default.
  expect(own("leading-own-over-class")).toEqual({ fontSize: 12, lineHeight: 30 });
  expect(styleOf("leading-class-size")).toEqual({ fontSize: 12, lineHeight: 12 });
  // A spread's style counts too.
  // (On a lowered tag Svelte stringifies a spread's `style` and the host drops it, as before: the class still had its size.)
  expect(styleOf("spread-font")).toEqual(lowered ? { lineHeight: 26 } : [{ lineHeight: 26 }, { fontSize: 26 }]);
  // The same list and size is the same object, whoever asks (a component copies it into its own props: `createNativeProps` keeps that copy's identity).
  if (lowered) expect(own("leading-own")).toBe(own("leading-own-twin"));
  else expect(own("leading-own")).toEqual(own("leading-own-twin"));
  // The element's size changing draws it again.
  (app as App).setSize(20);
  await m.tick();
  expect(styleOf("leading-own")).toEqual([{ lineHeight: 20 }, { fontSize: 20 }]);
  expect(own("leading-own-twin")).toEqual({ lineHeight: 30 });
  m.unmount(app);
});

test(`a spread's class is resolved, and on a lowered tag the class: toggles next to it apply to it (${how})`, async () => {
  const m = await loadModule(table, lowered);
  const { app, styleOf } = await mountFixture(m);
  expect(styleOf("spread")).toEqual({ padding: 16 });
  (app as App).setTone("loud");
  await m.tick();
  expect(styleOf("spread")).toEqual(lowered ? { padding: 16, borderWidth: 2 } : { padding: 16 });
  m.unmount(app);
});
}

test("the same list gives the same style object: a change that crosses no breakpoint makes no new one", async () => {
  const m = await loadModule();
  const { app, styleOf } = await mountFixture(m);
  const before = styleOf("wide");
  m.state.window = { width: 500, height: 800 };
  emitWindow(m.state);
  await m.tick();
  expect(styleOf("wide")).toBe(before);
  m.unmount(app);
});

test("width conditions: min-width includes its bound, max-width excludes it, and a view that waits for a breakpoint draws when the window crosses it", async () => {
  const m = await loadModule();
  const calls = spied(m);
  const resize = async (width: number) => {
    m.state.window = { width, height: 800 };
    emitWindow(m.state);
    await m.tick();
  };
  const { app, styleOf } = await mountFixture(m);
  expect(styleOf("wide")).toEqual({ padding: 4 });
  expect(m.state.windowListeners.size).toBe(1);
  calls.length = 0;
  await resize(767);
  expect(styleOf("wide")).toEqual({ padding: 4 });
  await resize(768);
  expect(styleOf("wide")).toEqual({ padding: 24 });
  await resize(360);
  expect(styleOf("wide")).toEqual({ padding: 4 });
  await resize(359);
  expect(styleOf("wide")).toEqual({ padding: 4, margin: 2 });
  // Only the elements that depend on the window ran again: the width-conditional one and the one sized by the window.
  expect([...new Set(calls)].sort()).toEqual(["half", "wide"]);
  // A change that is not the size (a scale, a font scale: the event fires for them) does not draw anything again.
  calls.length = 0;
  emitWindow(m.state);
  await m.tick();
  expect(calls).toEqual([]);
  m.unmount(app);
  await m.tick();
  expect(m.state.windowListeners.size).toBe(0);
});

test("translate, rotate and scale are composed into one transform in CSS's order, before a transform of its own", async () => {
  const m = await loadModule();
  const { app, styleOf } = await mountFixture(m);
  // Written as `big tx rot`, composed as translate, rotate, scale.
  expect(styleOf("moved")).toEqual({ transform: [{ translateX: 8 }, { rotate: "45deg" }, { scaleX: 1.1 }, { scaleY: 1.1 }] });
  expect(styleOf("moved-list")).toEqual({ transform: [{ translateX: 8 }, { skewX: "10deg" }] });
  expect(flat(styleOf("moved"))).not.toHaveProperty("transform:translateX");
  m.unmount(app);
});

test("a line height and a letter spacing relative to the font size are multiplied by it: the merged font size, 14 when no class sets one", async () => {
  const m = await loadModule();
  const { app, styleOf } = await mountFixture(m);
  expect(styleOf("leading")).toEqual({ fontSize: 12, lineHeight: 18, letterSpacing: 1.2 });
  expect(styleOf("leading-default")).toEqual({ lineHeight: 17.5 });
  // An absolute line height after a relative one wins, as the later rule does; the other way round the relative one wins.
  expect(styleOf("leading-absolute")).toEqual({ lineHeight: 24 });
  expect(styleOf("leading-relative")).toEqual({ fontSize: 12, lineHeight: 18 });
  m.unmount(app);
});

test("font-mono and font-serif are the families iOS has: Menlo and Georgia; Android has the generic names", async () => {
  const android = await mountFixture(await loadModule());
  expect(android.styleOf("mono")).toEqual({ fontFamily: "monospace" });
  expect(android.styleOf("serif")).toEqual({ fontFamily: "serif" });
  // The system does not change while the app runs, so the resolver keeps what it worked out for one: iOS is another run.
  const m = await loadModule();
  m.state.os = "ios";
  const ios = await mountFixture(m);
  expect(ios.styleOf("mono")).toEqual({ fontFamily: "Menlo" });
  expect(ios.styleOf("serif")).toEqual({ fontFamily: "Georgia" });
});

test("a value of the safe area follows the insets: the current ones at once, then each change", async () => {
  const m = await loadModule();
  m.state.engine.current = engineInsets(24, 34);
  const calls = spied(m);
  const { app, styleOf } = await mountFixture(m);
  expect(styleOf("inset")).toEqual({ paddingTop: 32 });
  const unrelated = styleOf("card");
  calls.length = 0;
  emitInsets(m.state, engineInsets(40, 0));
  await m.tick();
  expect(styleOf("inset")).toEqual({ paddingTop: 48 });
  // The keyboard moving is an insets event too: it changes none of the values a class reads.
  calls.length = 0;
  emitInsets(m.state, { ...engineInsets(40, 0), keyboardHeight: 300, keyboardVisible: true });
  await m.tick();
  expect(calls).toEqual([]);
  expect(styleOf("card")).toBe(unrelated);
  m.unmount(app);
});

test("a value of the window follows its size", async () => {
  const m = await loadModule();
  const { app, styleOf } = await mountFixture(m);
  expect(styleOf("half")).toEqual({ width: 200, height: 790 });
  m.state.window = { width: 300, height: 600 };
  emitWindow(m.state);
  await m.tick();
  expect(styleOf("half")).toEqual({ width: 150, height: 590 });
  m.unmount(app);
});

test("the cascade is the rules' order, not the order the classes are written in; a device value and a plain one fight by it too", async () => {
  const m = await loadModule();
  m.state.engine.current = engineInsets(24);
  const { app, styleOf } = await mountFixture(m);
  expect(styleOf("cascade")).toEqual({ margin: 2, opacity: 1 });
  expect(styleOf("inset-over-static")).toEqual({ paddingTop: 32 });
  expect(styleOf("static-over-inset")).toEqual({ paddingTop: 9 });
  m.unmount(app);
});

test("a null removes the key the rules before it set, and a later rule sets it again; it takes a transform part, a device value and a font-relative value away too", async () => {
  const m = await loadModule();
  m.state.engine.current = engineInsets(24);
  const { app, styleOf } = await mountFixture(m);
  expect(styleOf("removed")).toBeUndefined();
  expect(styleOf("removed-then-set")).toEqual({ boxShadow: "0 1px 2px rgba(0,0,0,0.05)" });
  expect(styleOf("moved-removed")).toEqual({ transform: [{ rotate: "45deg" }] });
  expect(styleOf("inset-removed")).toBeUndefined();
  expect(styleOf("leading-removed")).toEqual({ fontSize: 12 });
  // A condition decides whether the removal is there: `shadow-md dark:shadow-none`.
  expect(styleOf("removed-in-dark")).toEqual({ boxShadow: "0 4px 6px rgba(0,0,0,0.1)" });
  m.state.scheme = "dark";
  emitAppearance(m.state);
  await m.tick();
  expect(styleOf("removed-in-dark")).toBeUndefined();
  m.state.scheme = "light";
  emitAppearance(m.state);
  await m.tick();
  expect(styleOf("removed-in-dark")).toEqual({ boxShadow: "0 4px 6px rgba(0,0,0,0.1)" });
  m.unmount(app);
});

test("a rule for the other system does not apply", async () => {
  const android = await mountFixture(await loadModule());
  expect(android.styleOf("system")).toEqual({ opacity: 0.2 });
  const m = await loadModule();
  m.state.os = "ios";
  const ios = await mountFixture(m);
  expect(ios.styleOf("system")).toEqual({ opacity: 0.1 });
});

test("a safe area adds the insets to the padding of its classes", async () => {
  const m = await loadModule();
  m.state.engine.current = engineInsets(24, 34);
  const { app, styleOf } = await mountFixture(m);
  expect(flat(styleOf("safe"))).toMatchObject({ paddingTop: 40, paddingRight: 16, paddingBottom: 50, paddingLeft: 16 });
  m.unmount(app);
});

test("a new class table redraws the views that read it (the build wrote it again while the app runs)", async () => {
  const m = await loadModule();
  const { app, styleOf } = await mountFixture(m);
  expect(styleOf("card")).toEqual({ padding: 16 });
  m.setClassTable({ version: 1, classes: { ...table.classes, card: [{ order: 1, style: { padding: 20 } }] } });
  await m.tick();
  expect(styleOf("card")).toEqual({ padding: 20 });
  m.setClassTable(empty);
  await m.tick();
  expect(styleOf("card")).toBeUndefined();
  m.setClassTable(table);
  await m.tick();
  expect(styleOf("card")).toEqual({ padding: 16 });
  m.unmount(app);
});

// The report of a class that has no rules waits for the build to write the table (`UNKNOWN_CLASS_DELAY`): the timers are the test's, so it does not wait for them.
describe("the warnings of a class that is missing from the table", () => {
let warn: ReturnType<typeof spyOn>;
const warnings: string[] = [];
beforeEach(() => { warnings.length = 0; jest.useFakeTimers(); warn = spyOn(console, "warn").mockImplementation((message: unknown) => { warnings.push(String(message)); }); });
afterEach(() => { warn.mockRestore(); jest.useRealTimers(); });

const unknownClass = (name: string) => `svelte-native: class "${name}" is not in the class table: is the file under src/, and is the css option set?`;

test("a used class that has no rules is reported once, after the build has had time to write it: with the table's reason when it has one, else as unknown; a known class and the names of Object are not", async () => {
  const m = await loadModule();
  m.setClassTable(withReasons);
  const { app, styleOf } = await mountFixture(m, { unknown: true });
  expect(styleOf("unknown")).toEqual({ padding: 16 });
  expect(styleOf("prototype")).toBeUndefined();
  // The class the converter could not express gives the rest of its list.
  expect(styleOf("unsupported")).toEqual({ padding: 16 });
  // Partly: the rules apply, and the reason is said.
  expect(styleOf("partly")).toEqual({ overflow: "hidden" });
  // The markers have no CSS and are not missing.
  expect(styleOf("markers")).toEqual({ padding: 16 });
  expect(warnings).toEqual([]);
  jest.advanceTimersByTime(m.UNKNOWN_CLASS_DELAY);
  expect(warnings.sort()).toEqual([
    unknownClass("__proto__"),
    unknownClass("constructor"),
    'svelte-native: class "hover:opacity-50" is not supported on native: :hover: pseudo-classes need state',
    unknownClass("nothing-here"),
    'svelte-native: class "transition" is not supported on native: transition-property: no React Native style for transition-property; transition-duration: no React Native style for transition-duration',
    'svelte-native: class "truncate" is partly supported on native: text-overflow: no React Native style for text-overflow',
  ]);
  // Mounted again: already reported.
  m.unmount(app);
  const second = await mountFixture(m, { unknown: true });
  jest.advanceTimersByTime(m.UNKNOWN_CLASS_DELAY);
  expect(warnings).toHaveLength(6);
  m.unmount(second.app);
});

test("a table without reasons reports every class that has no rules as unknown, and one with a reason it does not know the class by does too; a class with rules and no reason is silent", async () => {
  const m = await loadModule();
  m.setClassTable({ ...table, unsupported: { somewhere: "else" } });
  const { app } = await mountFixture(m, { unknown: true });
  jest.advanceTimersByTime(m.UNKNOWN_CLASS_DELAY);
  expect(warnings.filter((warning) => warning.includes("supported on native"))).toEqual([]);
  expect(warnings.filter((warning) => warning.includes("truncate") || warning.includes('"group') || warning.includes('"peer'))).toEqual([]);
  expect(warnings.filter((warning) => warning.includes("is not in the class table")).sort()).toEqual([
    unknownClass("__proto__"),
    unknownClass("constructor"),
    unknownClass("hover:opacity-50"),
    unknownClass("nothing-here"),
    unknownClass("transition"),
  ]);
  m.unmount(app);
});

test("the reason is the one the table has when the report is due, and a class the new table expresses is not reported", async () => {
  const m = await loadModule();
  const { app } = await mountFixture(m, { unknown: true });
  // `transition` is expressed in the new table and its reason is gone; `hover:opacity-50` is still left out.
  const stillUnsupported: Record<string, string> = { ...unsupported };
  delete stillUnsupported.transition;
  m.setClassTable({ ...table, classes: { ...table.classes, transition: [{ order: 98, style: { opacity: 1 } }] }, unsupported: stillUnsupported });
  jest.advanceTimersByTime(m.UNKNOWN_CLASS_DELAY);
  expect(warnings.filter((warning) => warning.includes("hover:opacity-50"))).toEqual(['svelte-native: class "hover:opacity-50" is not supported on native: :hover: pseudo-classes need state']);
  expect(warnings.filter((warning) => warning.includes('"transition"'))).toEqual([]);
  m.unmount(app);
});

test("a class that is in the table by the time the report is due is not reported", async () => {
  const m = await loadModule();
  const { app } = await mountFixture(m, { unknown: true });
  m.setClassTable({ version: 1, classes: { ...table.classes, "nothing-here": [{ order: 99, style: { opacity: 0.3 } }] } });
  jest.advanceTimersByTime(m.UNKNOWN_CLASS_DELAY);
  expect(warnings.filter((warning) => warning.includes("nothing-here"))).toEqual([]);
  m.unmount(app);
});

test("with an empty table (no css option), class is dropped with one warning in development", async () => {
  const m = await loadModule();
  m.setClassTable(empty);
  const { app, styleOf } = await mountFixture(m);
  expect(styleOf("card")).toBeUndefined();
  expect(warnings).toHaveLength(1);
  expect(warnings[0]).toMatch(/^svelte-native: class="[a-z -]+" has no effect/);
  expect(warnings[0]).toContain("css option of withSvelteNative");
  m.unmount(app);
});
});
