import { expect, test } from "bun:test";
import { resolve } from "node:path";
import type { NativeNode } from "../../src/renderer.ts";
import { load, src } from "../support/bundle.ts";

/**
 * The insets store, `SafeAreaView` and `KeyboardAvoidingView` against a stand-in for the engine module the insets come from (`SvelteEngine` on Android, `SvelteInsets` on iOS). The
 * stand-in is part of the bundle and its state is exported with the rest, so each test has an engine of its own.
 */
type Event = { top: number; right: number; bottom: number; left: number; keyboardHeight: number; keyboardVisible: boolean; frame: { x: number; y: number; width: number; height: number } };
const event = (patch: Partial<Event> = {}): Event => ({ top: 24, right: 0, bottom: 34, left: 0, keyboardHeight: 0, keyboardVisible: false, frame: { x: 0, y: 0, width: 400, height: 800 }, ...patch });

type Engine = { listener: null | ((e: Event) => void); current: Event | null; removed: number; available: string[] };
const engineModule = `export const state = { listener: null, current: null, removed: 0, available: ["SvelteEngine"] };
  export const EventEmitter = class {};
  export const requireOptionalNativeModule = (name) => !state.available.includes(name) ? null : ({ getInsets: () => state.current, addListener: (name, listener) => { if (name === "insets") state.listener = listener; return { remove() { state.removed++; } }; } });`;

type Props = Record<string, unknown>;
type Loaded = Pick<typeof import("../../src/fabric/insets.ts"), "avoidingStyle" | "flattenStyle" | "keyboardOverlap" | "safeAreaStyle" | "subscribeInsets"> & {
  engine: Engine; Fixture: unknown; renderer: unknown; NativeNode: typeof NativeNode; mergeHostProps: (props: unknown) => Props;
  insets: { top: number; bottom: number; keyboardHeight: number; keyboardVisible: boolean; frame: { height: number } }; resetInsets(): void;
  mount: (component: unknown, options: object) => unknown; tick: () => Promise<void>; unmount: (app: unknown) => void;
};

const loadModule = () => load<Loaded>({
  entry: `import Fixture from ${JSON.stringify(resolve(import.meta.dirname, "fixtures/insets-fixture.svelte"))};
    import renderer, { NativeNode } from ${JSON.stringify(src("renderer.ts"))};
    import { mergeHostProps } from ${JSON.stringify(src("native-props.ts"))};
    import { insets, resetInsets } from ${JSON.stringify(src("insets.svelte.ts"))};
    import { mount, tick, unmount } from 'svelte';
    export { state as engine } from 'expo-modules-core';
    export { avoidingStyle, flattenStyle, keyboardOverlap, safeAreaStyle, subscribeInsets } from ${JSON.stringify(src("fabric/insets.ts"))};
    export { Fixture, renderer, NativeNode, mergeHostProps, insets, resetInsets, mount, tick, unmount };`,
  stubs: { "expo-modules-core": engineModule },
  converters: false,
});

function nodes(node: NativeNode): NativeNode[] { return [node, ...node.getSnapshot().children.flatMap(nodes)]; }
async function mountFixture(m: Loaded, props: Props = {}) {
  const root = new m.NativeNode("fragment");
  const app = m.mount(m.Fixture, { target: root, renderer: m.renderer, props });
  await m.tick();
  const props_of = (name: string, index = 0): Props => m.mergeHostProps(nodes(root).filter((n) => n.name === name)[index].getSnapshot().props);
  return { root, app, props_of };
}

test("the insets store follows the module event and the first read", async () => {
  const m = await loadModule();
  const stub = m.engine;
  stub.current = event({ top: 10 });
  m.resetInsets();
  const { props_of } = await mountFixture(m);
  expect(m.insets.top).toBe(10);
  stub.listener?.(event({ top: 30, keyboardHeight: 250, keyboardVisible: true }));
  await m.tick();
  expect(m.insets.top).toBe(30);
  expect(m.insets.bottom).toBe(34);
  expect(m.insets.keyboardHeight).toBe(250);
  expect(m.insets.keyboardVisible).toBe(true);
  expect(m.insets.frame.height).toBe(800);
  expect(props_of("native-safe-area").style).toEqual([{ flex: 1, paddingTop: 4 }, { paddingTop: 34, paddingRight: 0, paddingBottom: 34, paddingLeft: 0 }]);
});

test("SafeAreaView pads only the selected edges and adds the inset to the style's own padding", async () => {
  const m = await loadModule();
  const stub = m.engine;
  stub.current = event({ top: 24, bottom: 34 });
  m.resetInsets();
  const { props_of } = await mountFixture(m, { edges: ["bottom"] });
  expect(props_of("native-safe-area").style).toEqual([{ flex: 1, paddingTop: 4 }, { paddingBottom: 34 }]);
  expect(props_of("native-safe-area").edges).toBeUndefined();
});

test("KeyboardAvoidingView pads, shrinks or lifts by the keyboard's overlap with the measured view", async () => {
  const m = await loadModule();
  const stub = m.engine;
  for (const [behavior, offset, bottom] of [["padding", 0, 300], ["padding", 50, 350], ["height", 0, 300], ["position", 0, 300]] as const) {
    stub.current = event({ keyboardHeight: 300, keyboardVisible: true });
    m.resetInsets();
    const { props_of } = await mountFixture(m, { behavior, offset });
    // The view sits at y 400..800 of an 800 high surface; the keyboard covers 500..800.
    const measured = { measureInWindow: (callback: (...a: number[]) => void) => callback(0, 400, 400, 400) };
    const outer = () => props_of("native-view", 0);
    (outer().ref as (h: unknown) => void)(measured);
    (outer().onLayout as (e: unknown) => void)({ nativeEvent: {} });
    await m.tick();
    await m.tick();
    if (behavior === "padding") expect(outer().style).toEqual([{ flex: 1 }, { paddingBottom: bottom }]);
    if (behavior === "height") expect(outer().style).toEqual([{ flex: 1 }, { height: 400 - bottom, flex: 0 }]);
    if (behavior === "position") expect(props_of("native-view", 1).style).toEqual([{ flex: 1 }, { bottom }]);
    stub.listener?.(event());
    await m.tick();
    await m.tick();
    if (behavior === "padding") expect(outer().style).toEqual([{ flex: 1 }, { paddingBottom: 0 }]);
    if (behavior === "height") expect(outer().style).toEqual({ flex: 1 });
    if (behavior === "position") expect(props_of("native-view", 1).style).toEqual([{ flex: 1 }, { bottom: 0 }]);
  }
});

test("a KeyboardAvoidingView of height shrinks from the height it has now, not from the first one it had, when it was resized while the keyboard was closed (#117)", async () => {
  const m = await loadModule();
  const stub = m.engine;
  stub.current = event({ frame: { x: 0, y: 0, width: 400, height: 600 } });
  m.resetInsets();
  const { props_of } = await mountFixture(m, { behavior: "height" });
  // The view fills the window: its measured height is the window's, 600 and then 350 dp.
  let window = 600;
  const measured = { measureInWindow: (callback: (...a: number[]) => void) => callback(0, 0, 400, window) };
  const outer = () => props_of("native-view", 0);
  (outer().ref as (h: unknown) => void)(measured);
  const layout = async () => { (outer().onLayout as (e: unknown) => void)({ nativeEvent: {} }); await m.tick(); await m.tick(); };
  const keyboard = async (open: boolean) => {
    stub.listener?.(event({ frame: { x: 0, y: 0, width: 400, height: window }, ...(open ? { keyboardHeight: 140, keyboardVisible: true } : {}) }));
    await m.tick();
    await m.tick();
  };
  await layout();
  await keyboard(true);
  expect(outer().style).toEqual([{ flex: 1 }, { height: 460, flex: 0 }]);
  await keyboard(false);
  expect(outer().style).toEqual({ flex: 1 });
  // Resized to 350 with the keyboard closed, the layout of the resized view measured, the keyboard opened again: 350 less 140.
  window = 350;
  await keyboard(false);
  await layout();
  await keyboard(true);
  expect(outer().style).toEqual([{ flex: 1 }, { height: 210, flex: 0 }]);
});

test("a KeyboardAvoidingView re-enabled with the keyboard still open avoids it by its overlap at once, whatever its behaviour (#125)", async () => {
  // A 600 high window, a 140 high keyboard, the view filling the window: the overlap is 140 (a `height` view asks for 460, `padding` for 140, `position` lifts by 140).
  for (const behavior of ["height", "padding", "position"] as const) {
    const m = await loadModule();
    const stub = m.engine;
    stub.current = event({ frame: { x: 0, y: 0, width: 400, height: 600 } });
    m.resetInsets();
    const { app, props_of } = await mountFixture(m, { behavior });
    const outer = () => props_of("native-view", 0);
    const style = () => (behavior === "position" ? props_of("native-view", 1) : outer()).style;
    // The view as the host would measure it: the height its style asks for, or the whole window.
    const flat = () => { const s = outer().style; return (Array.isArray(s) ? Object.assign({}, ...s) : s) as { height?: number }; };
    const measured = { measureInWindow: (callback: (...a: number[]) => void) => callback(0, 0, 400, flat().height ?? 600) };
    (outer().ref as (h: unknown) => void)(measured);
    const layout = async () => { (outer().onLayout as (e: unknown) => void)({ nativeEvent: {} }); await m.tick(); await m.tick(); };
    const keyboard = async (open: boolean) => {
      stub.listener?.(event({ frame: { x: 0, y: 0, width: 400, height: 600 }, ...(open ? { keyboardHeight: 140, keyboardVisible: true } : {}) }));
      await m.tick();
      await m.tick();
    };
    const enable = async (enabled: boolean) => { (app as { set(patch: object): void }).set({ enabled }); await m.tick(); await m.tick(); };
    const avoiding = (bottom: number) => behavior === "height" ? [{ flex: 1 }, { height: 600 - bottom, flex: 0 }] : [{ flex: 1 }, behavior === "padding" ? { paddingBottom: bottom } : { bottom }];
    const free = behavior === "height" ? { flex: 1 } : avoiding(0);

    await layout();
    await keyboard(true);
    await layout();
    expect(style()).toEqual(avoiding(140));
    // Disabled: the view is as it is without the keyboard, and its natural layout is measured.
    await enable(false);
    expect(style()).toEqual(free);
    await layout();
    expect(style()).toEqual(free);
    // Enabled again with the keyboard still open: the request is 140 less at once (it was 280 less, and corrected after the layout of that).
    await enable(true);
    expect(style()).toEqual(avoiding(140));
    await layout();
    expect(style()).toEqual(avoiding(140));

    // Control: enabled again before the natural layout was measured.
    await enable(false);
    await enable(true);
    expect(style()).toEqual(avoiding(140));
    await layout();
    expect(style()).toEqual(avoiding(140));

    // Control: the keyboard is hidden while the view is disabled, and opens again after it is enabled.
    await enable(false);
    await layout();
    await keyboard(false);
    await layout();
    await enable(true);
    expect(style()).toEqual(free);
    await keyboard(true);
    expect(style()).toEqual(avoiding(140));
    await layout();
    expect(style()).toEqual(avoiding(140));
  }
});

/**
 * A `height` KeyboardAvoidingView in a window that changes size (#134): every request the component commits, from the first layout to the last one the host acknowledges. The view stands at
 * the top of the window and is as tall as it, less `footer` (a bar under it), unless it has been given a height; the host reports the new insets before it lays the view out again, and
 * answers each request with the layout the view then has.
 */
async function windowRun(from: number, to: number, options: { keyboard?: boolean; footer?: number } = {}): Promise<string[]> {
  const { keyboard = true, footer = 0 } = options;
  const m = await loadModule();
  const stub = m.engine;
  let window = from;
  const report = (open: boolean) => event({ frame: { x: 0, y: 0, width: 400, height: window }, ...(open ? { keyboardHeight: 140, keyboardVisible: true } : {}) });
  stub.current = report(false);
  m.resetInsets();
  const { props_of } = await mountFixture(m, { behavior: "height" });
  const outer = () => props_of("native-view", 0);
  const flat = () => { const style = outer().style; return (Array.isArray(style) ? Object.assign({}, ...style) : style) as { height?: number }; };
  const laidOut = () => flat().height ?? window - footer;
  (outer().ref as (h: unknown) => void)({ measureInWindow: (callback: (...a: number[]) => void) => callback(0, 0, 400, laidOut()) });
  const requests: string[] = [];
  const sample = () => { const request = JSON.stringify(outer().style); if (requests.at(-1) !== request) requests.push(request); };
  const settle = async () => { await m.tick(); await m.tick(); sample(); };
  const layout = async () => { (outer().onLayout as (e: unknown) => void)({ nativeEvent: {} }); await settle(); };
  const insets = async (open: boolean) => { stub.listener?.(report(open)); await settle(); };
  sample();
  await layout();
  if (keyboard) { await insets(true); await layout(); }
  window = to;
  await insets(keyboard);
  for (let acknowledged = 0; acknowledged < 6; acknowledged++) await layout();
  return requests;
}
const plain = JSON.stringify({ flex: 1 });
const asked = (height: number) => JSON.stringify([{ flex: 1 }, { height, flex: 0 }]);

test("a KeyboardAvoidingView of height in a window that grows with the keyboard open asks for the avoided height at once, never for the whole of it (#134)", async () => {
  // 350 to 600 with a 140 keyboard: 210, then 460 (the request that left it with no height let the view extend under the keyboard until the next layout, and it asked for 210 again).
  expect(await windowRun(350, 600)).toEqual([plain, asked(210), asked(460)]);
  // 350 to 450: 310.
  expect(await windowRun(350, 450)).toEqual([plain, asked(210), asked(310)]);
  // A window that shrinks: 600 to 350.
  expect(await windowRun(600, 350)).toEqual([plain, asked(460), asked(210)]);
  // The keyboard is closed: ordinary flex, nothing asked.
  expect(await windowRun(350, 600, { keyboard: false })).toEqual([plain]);
});

test("a KeyboardAvoidingView of height with a bar under it, in a window that grows with the keyboard open, is as tall as the keyboard leaves it (#134)", async () => {
  // The view is 100 shorter than the window (a bar under it, more than the inset at the bottom): it is measured as it is, and settles where the keyboard leaves it, 460 of its natural 500.
  const requests = await windowRun(350, 600, { footer: 100 });
  expect(requests.at(-1)).toBe(asked(460));
  // And a bar of the size of the bottom inset is at the bottom of the window as far as the view is concerned: the view ends where the keyboard begins, at once.
  expect(await windowRun(350, 600, { footer: 34 })).toEqual([plain, asked(210), asked(460)]);
});

test("padding math", async () => {
  const { avoidingStyle, flattenStyle, keyboardOverlap, safeAreaStyle } = await loadModule();
  const insets = { top: 20, right: 1, bottom: 30, left: 2 };
  expect(flattenStyle([{ a: 1 }, false, [{ b: 2 }]])).toEqual({ a: 1, b: 2 });
  expect(safeAreaStyle({ padding: 8 }, insets)).toEqual([{ padding: 8 }, { paddingTop: 28, paddingRight: 9, paddingBottom: 38, paddingLeft: 10 }]);
  expect(safeAreaStyle({ paddingVertical: 5, paddingBottom: 1 }, insets, ["top", "bottom"])).toEqual([{ paddingVertical: 5, paddingBottom: 1 }, { paddingTop: 25, paddingBottom: 31 }]);
  expect(keyboardOverlap({ viewY: 0, viewHeight: 400, rootHeight: 800, keyboardHeight: 300 })).toBe(0);
  expect(keyboardOverlap({ viewY: 0, viewHeight: 700, rootHeight: 800, keyboardHeight: 300 })).toBe(200);
  expect(keyboardOverlap({ viewY: 0, viewHeight: 700, rootHeight: 800, keyboardHeight: 300, offset: 100 })).toBe(300);
  expect(keyboardOverlap({ viewY: 0, viewHeight: 500, rootHeight: 800, keyboardHeight: 300, behavior: "height", previous: 200 })).toBe(200);
  expect(avoidingStyle("height", { flex: 1 }, 0, 700)).toEqual({ flex: 1 });
  expect(avoidingStyle("height", { flex: 1 }, 200, 700)).toEqual([{ flex: 1 }, { height: 500, flex: 0 }]);
  // An overlap larger than the view's height leaves it no height, never a negative one.
  expect(avoidingStyle("height", { flex: 1 }, 800, 700)).toEqual([{ flex: 1 }, { height: 0, flex: 0 }]);
  expect(avoidingStyle(undefined, { flex: 1 }, 200, 700)).toEqual({ flex: 1 });
});

test("the insets come from the engine module on Android and from SvelteInsets on iOS; without either there are none", async () => {
  const m = await loadModule();
  const stub = m.engine;
  const seen: Event[] = [];
  stub.available = ["SvelteInsets"];
  stub.current = event({ top: 47, bottom: 34 });
  const unsubscribe = m.subscribeInsets((value) => seen.push(value));
  expect(unsubscribe).not.toBeNull();
  expect(seen).toEqual([event({ top: 47, bottom: 34 })]);
  stub.listener?.(event({ keyboardHeight: 300, keyboardVisible: true }));
  expect(seen.at(-1)?.keyboardHeight).toBe(300);
  unsubscribe?.();
  stub.available = [];
  expect(m.subscribeInsets(() => {})).toBeNull();
});
