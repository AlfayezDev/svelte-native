import { expect, test } from "bun:test";
import { resolve } from "node:path";
import type { NativeNode } from "../../src/renderer.ts";
import type { AnimLog } from "../support/reanimated-stubs.ts";
import { baseStubs, load, src } from "../support/bundle.ts";

/**
 * The components that follow the keyboard against a stand-in for the engine module: what each registers, with the view's tag and the right numbers, when the props change, what it
 * does without the engine (the insets store's step, a plain scroll view), and how the end of a list reaches `onEndVisible`. The frames themselves are Kotlin's (`KeyboardRulesCheck`
 * and the emulator); here the engine is a log of the commands it was sent.
 */
type Insets = { top: number; right: number; bottom: number; left: number; keyboardHeight: number; keyboardVisible: boolean; keyboardAnimating?: boolean; frame: { x: number; y: number; width: number; height: number } };
const insets = (patch: Partial<Insets> = {}): Insets => ({ top: 24, right: 0, bottom: 34, left: 0, keyboardHeight: 0, keyboardVisible: false, frame: { x: 0, y: 0, width: 400, height: 800 }, ...patch });

type Engine = { calls: [number, string, unknown[]][]; installed: boolean; listeners: Record<string, (event: unknown) => void>; current: Insets | null };
const engineModule = `export const state = { calls: [], installed: true, listeners: {}, current: null };
  export const EventEmitter = class {};
  export const requireOptionalNativeModule = (name) => name !== "SvelteEngine" ? null : ({
    getInsets: () => state.current,
    addListener: (event, listener) => { state.listeners[event] = listener; return { remove() { delete state.listeners[event]; } }; },
    keyboardDrive: (tag, name, args) => { state.calls.push([tag, name, args]); return state.installed; },
  });`;

type Props = Record<string, unknown>;
type Loaded = {
  engine: Engine; Fixture: unknown; renderer: unknown; NativeNode: typeof NativeNode; mergeHostProps: (props: unknown) => Props;
  store: { keyboardState: string; keyboardHeight: number }; applyInsets(event: Insets): void; resetInsets(): void; keyboardDriven(): boolean;
  mount: (component: unknown, options: object) => unknown; tick: () => Promise<void>;
};

const loadModule = () => load<Loaded>({
  entry: `import Fixture from ${JSON.stringify(resolve(import.meta.dirname, "fixtures/keyboard-follow-fixture.svelte"))};
    import renderer, { NativeNode } from ${JSON.stringify(src("renderer.ts"))};
    import { mergeHostProps } from ${JSON.stringify(src("native-props.ts"))};
    import { insets as store, applyInsets, resetInsets } from ${JSON.stringify(src("insets.svelte.ts"))};
    import { keyboardDriven } from ${JSON.stringify(src("keyboard-drive.ts"))};
    import { mount, tick } from 'svelte';
    export { state as engine } from 'expo-modules-core';
    export { Fixture, renderer, NativeNode, mergeHostProps, store, applyInsets, resetInsets, keyboardDriven, mount, tick };`,
  stubs: { "expo-modules-core": engineModule },
  converters: false,
});

function nodes(node: NativeNode): NativeNode[] { return [node, ...node.getSnapshot().children.flatMap(nodes)]; }
async function mountFixture(m: Loaded, kind: string, props: Props = {}, extra: Props = {}) {
  const root = new m.NativeNode("fragment");
  m.mount(m.Fixture, { target: root, renderer: m.renderer, props: { kind, props, ...extra } });
  await m.tick();
  const propsOf = (name: string, index = 0): Props => m.mergeHostProps(nodes(root).filter((n) => n.name === name)[index].getSnapshot().props);
  return { root, propsOf, ref: (name: string, handle: unknown, index = 0) => { (propsOf(name, index).ref as (h: unknown) => void)(handle); } };
}
const drives = (m: Loaded) => m.engine.calls.filter(([tag]) => tag !== -1);

test("a sticky view tells the engine its tag and offsets once it is mounted, and again when they change", async () => {
  const m = await loadModule();
  m.engine.current = insets();
  m.resetInsets();
  const { ref } = await mountFixture(m, "sticky", { offset: { closed: 4, opened: 34 } });
  // The first command is the engine's own probe (`keyboardDriven`), made for the tag -1.
  expect(m.engine.calls[0]).toEqual([-1, "release", []]);
  expect(drives(m)).toEqual([]);
  ref("native-view", { tag: 7 });
  await m.tick();
  expect(drives(m)).toEqual([[7, "follow", [4, 34, true]]]);
});

test("a sticky view is left to the engine: its style carries no translation of its own, whatever the insets say", async () => {
  const m = await loadModule();
  m.engine.current = insets({ keyboardHeight: 300, keyboardVisible: true });
  m.resetInsets();
  const { propsOf } = await mountFixture(m, "sticky", { offset: { opened: 34 } });
  expect(propsOf("native-view").style).toEqual({ flex: 1 });
  // Fabric flattens the children of a view that forms no stacking context out of it, and they would not move with it.
  expect(propsOf("native-view").collapsable).toBe(false);
});

test("without the engine a sticky view stands where the keyboard will be, in one step", async () => {
  const m = await loadModule();
  m.engine.installed = false;
  m.engine.current = insets({ keyboardHeight: 300, keyboardVisible: true });
  m.resetInsets();
  const { propsOf, ref } = await mountFixture(m, "sticky", { offset: { closed: 0, opened: 34 } });
  expect(m.keyboardDriven()).toBe(false);
  expect(propsOf("native-view").style).toEqual([{ flex: 1 }, { transform: [{ translateY: -266 }] }]);
  ref("native-view", { tag: 7 });
  await m.tick();
  expect(drives(m)).toEqual([]);
  m.engine.listeners.insets?.(insets());
  await m.tick();
  expect(propsOf("native-view").style).toEqual([{ flex: 1 }, { transform: [{ translateY: 0 }] }]);
});

test("a disabled sticky view says so to the engine", async () => {
  const m = await loadModule();
  const { ref } = await mountFixture(m, "sticky", { enabled: false, offset: { closed: 10 } });
  ref("native-view", { tag: 3 });
  await m.tick();
  expect(drives(m)).toEqual([[3, "follow", [10, 0, false]]]);
});

test("a chat scroll view registers its lift, and a listener of its tag hears when the end of the thread comes into view", async () => {
  const m = await loadModule();
  const ends: boolean[] = [];
  const { ref } = await mountFixture(m, "chat", { keyboardLiftBehavior: "whenAtEnd", offset: 50, watch: true }, { ends });
  ref("native-scroll", { tag: 9 });
  await m.tick();
  expect(drives(m)).toEqual([[9, "lift", ["whenAtEnd", 50, true]]]);
  m.engine.listeners.endVisible?.({ tag: 9, visible: false });
  m.engine.listeners.endVisible?.({ tag: 4, visible: true });
  m.engine.listeners.endVisible?.({ tag: 9, visible: true });
  expect(ends).toEqual([false, true]);
});

test("a chat scroll view that nobody asks the end of does not listen, and lifts always by default", async () => {
  const m = await loadModule();
  const { ref } = await mountFixture(m, "chat");
  ref("native-scroll", { tag: 9 });
  await m.tick();
  expect(drives(m)).toEqual([[9, "lift", ["always", 0, false]]]);
  expect(m.engine.listeners.endVisible).toBeUndefined();
});

test("without the engine a chat scroll view tells the end of the thread from its scroll events", async () => {
  const m = await loadModule();
  m.engine.installed = false;
  const ends: boolean[] = [];
  const { propsOf } = await mountFixture(m, "chat", { watch: true }, { ends });
  expect(propsOf("native-scroll").scrollEventThrottle).toBe(16);
  const scroll = (y: number) => (propsOf("native-scroll").onScroll as (e: unknown) => void)({ nativeEvent: { contentOffset: { y }, layoutMeasurement: { height: 800 }, contentSize: { height: 2000 } } });
  scroll(1200);
  scroll(1100);
  scroll(1000);
  scroll(1180);
  expect(ends).toEqual([true, false, true]);
});

test("an aware scroll view registers its offsets, and is released when it is disabled", async () => {
  const m = await loadModule();
  const { ref } = await mountFixture(m, "aware", { bottomOffset: 24, extraKeyboardSpace: 8, disableScrollOnKeyboardHide: true });
  ref("native-scroll", { tag: 5 });
  await m.tick();
  expect(drives(m)).toEqual([[5, "aware", [24, 8, false]]]);
  const off = await loadModule();
  const disabled = await mountFixture(off, "aware", { enabled: false });
  disabled.ref("native-scroll", { tag: 5 });
  await off.tick();
  expect(drives(off)).toEqual([[5, "release", [0, 0, true]]]);
});

test("a KeyboardAvoidingView of position is moved by the engine from the outer view's place, and has no bottom of its own", async () => {
  const m = await loadModule();
  m.engine.current = insets({ keyboardHeight: 300, keyboardVisible: true });
  m.resetInsets();
  const { propsOf, ref } = await mountFixture(m, "avoid", { behavior: "position", keyboardVerticalOffset: 12 });
  ref("native-view", { tag: 20, measureInWindow: () => {} }, 0);
  ref("native-view", { tag: 21 }, 1);
  await m.tick();
  expect(drives(m)).toEqual([[21, "avoid", [20, 12, true]]]);
  expect(propsOf("native-view", 1).style).toEqual({ flex: 1 });
  expect(propsOf("native-view", 1).collapsable).toBe(false);
});

test("a KeyboardAvoidingView of padding stays JavaScript's: no command, one step", async () => {
  const m = await loadModule();
  m.engine.current = insets({ keyboardHeight: 300, keyboardVisible: true });
  m.resetInsets();
  const { ref } = await mountFixture(m, "avoid", { behavior: "padding" });
  ref("native-view", { tag: 20, measureInWindow: () => {} });
  await m.tick();
  expect(drives(m)).toEqual([]);
});

test("the insets store says where the keyboard is on its way", async () => {
  const m = await loadModule();
  m.resetInsets();
  m.applyInsets(insets({ keyboardHeight: 300, keyboardVisible: true, keyboardAnimating: true }));
  expect(m.store.keyboardState).toBe("opening");
  m.applyInsets(insets({ keyboardHeight: 300, keyboardVisible: true, keyboardAnimating: false }));
  expect(m.store.keyboardState).toBe("open");
  m.applyInsets(insets({ keyboardHeight: 0, keyboardVisible: false, keyboardAnimating: true }));
  expect(m.store.keyboardState).toBe("closing");
  m.applyInsets(insets());
  expect(m.store.keyboardState).toBe("closed");
});

type Motion = { height: { value: number }; progress: { value: number }; state: { value: string } };
const animLog = () => (globalThis as unknown as { __anim: AnimLog }).__anim;

test("createKeyboardMotion turns the engine's frames into dp, progress and state on the UI runtime, and goes with its component", async () => {
  delete (globalThis as { __anim?: AnimLog }).__anim;
  const m = await load<{ Fixture: unknown; renderer: unknown; NativeNode: typeof NativeNode; mount: (component: unknown, options: object) => unknown; unmount: (app: unknown) => void; tick: () => Promise<void> }>({
    entry: `import Fixture from ${JSON.stringify(resolve(import.meta.dirname, "fixtures/keyboard-motion-fixture.svelte"))};
      import renderer, { NativeNode } from ${JSON.stringify(src("renderer.ts"))};
      import { mount, unmount, tick } from 'svelte';
      export { Fixture, renderer, NativeNode, mount, unmount, tick };`,
    stubs: { ...baseStubs(), "expo-modules-core": engineModule, "react-native/Libraries/Utilities/PixelRatio": "export default { get: () => 2.625 };" },
    converters: false,
  });
  const out: { motion?: Motion } = {};
  const app = m.mount(m.Fixture, { target: new m.NativeNode("fragment"), renderer: m.renderer, props: { out } });
  await m.tick();
  const motion = out.motion as Motion;
  expect(animLog().keyboard).toHaveLength(1);
  expect(animLog().keyboard?.[0]?.options).toEqual({ isStatusBarTranslucentAndroid: true, isNavigationBarTranslucentAndroid: true });
  const frame = animLog().keyboard?.[0]?.handler as (kind: number, px: number) => void;
  // The engine counts in px: a keyboard of 1050 px is 400 dp at 2.625 px a dp.
  expect([motion.height.value, motion.progress.value, motion.state.value]).toEqual([0, 0, "closed"]);
  frame(1, 1050);
  expect(motion.state.value).toBe("opening");
  frame(2, 525);
  expect([motion.height.value, motion.progress.value]).toEqual([200, 0.5]);
  frame(3, 1050);
  expect([motion.height.value, motion.progress.value, motion.state.value]).toEqual([400, 1, "open"]);
  frame(1, 0);
  expect(motion.state.value).toBe("closing");
  frame(2, 525);
  expect([motion.height.value, motion.progress.value]).toEqual([200, 0.5]);
  frame(3, 0);
  expect([motion.height.value, motion.progress.value, motion.state.value]).toEqual([0, 0, "closed"]);
  m.unmount(app);
  expect(animLog().keyboard?.[0]?.off).toBe(true);
  // The fakes' log is the process's: the next file starts from none.
  delete (globalThis as { __anim?: AnimLog }).__anim;
});
