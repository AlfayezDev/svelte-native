import { test, expect, jest, afterEach } from "bun:test";
import { build } from "esbuild";
import { readFile, mkdtemp, writeFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { compile } from "svelte/compiler";
import { componentOptions } from "../src/compile-options.ts";
import { lowerPrimitives } from "../src/lower.ts";
import { reanimatedStubs } from "./reanimated-stubs.ts";

type FakeNode = { tag: number; name: string; props: Record<string, unknown>; children: FakeNode[]; sealed: boolean; target?: unknown };
const calls: string[] = [];
let roots: Record<number, FakeNode[]> = {};
const fake = {
  createNode(tag: number, name: string, _root: number, props: Record<string, unknown>, target: unknown) { calls.push(`create ${name}`); return { tag, name, props: { ...props }, children: [], sealed: false, target }; },
  cloneNodeWithNewChildren(node: FakeNode) { calls.push(`cloneChildren ${node.name}`); return { ...node, children: [], sealed: false }; },
  cloneNodeWithNewProps(node: FakeNode, props: Record<string, unknown>) { calls.push(`cloneProps ${node.name}`); return { ...node, props: { ...node.props, ...props }, children: [...node.children], sealed: false }; },
  cloneNodeWithNewChildrenAndProps(node: FakeNode, props: Record<string, unknown>) { calls.push(`cloneBoth ${node.name}`); return { ...node, props: { ...node.props, ...props }, children: [], sealed: false }; },
  appendChild(parent: FakeNode, child: FakeNode) {
    if (parent.sealed) throw new Error(`appendChild on sealed ${parent.name}`);
    if (parent.name === "RCTScrollView" && parent.children.length >= 1) throw new Error("ScrollView can host only one direct child");
    parent.children.push(child);
  },
  createChildSet(root: number) { return { root, children: [] as FakeNode[] }; },
  appendChildToSet(set: { children: FakeNode[] }, child: FakeNode) { set.children.push(child); },
  completeRoot(root: number, set: { children: FakeNode[] }) {
    calls.push("completeRoot");
    const seal = (n: FakeNode) => { n.sealed = true; n.children.forEach(seal); };
    set.children.forEach(seal);
    roots[root] = set.children;
  },
  measure(node: FakeNode, callback: (...args: number[]) => void) { calls.push(`measure ${node.tag}`); callback(1, 2, 3, 4, 5, 6); },
  measureInWindow(node: FakeNode, callback: (...args: number[]) => void) { calls.push(`measureInWindow ${node.tag}`); callback(5, 6, 3, 4); },
  dispatchCommand(node: FakeNode, name: string, args: unknown[]) { calls.push(`dispatchCommand ${node.tag} ${name} ${JSON.stringify(args)}`); },
  registerEventHandler(handler: unknown) { (fake as { handler?: unknown }).handler = handler; },
};
(globalThis as { nativeFabricUIManager?: unknown }).nativeFabricUIManager = fake;

const stubs: Record<string, string> = {
  ...reanimatedStubs,
  "react-native/Libraries/ReactNative/ReactFabricPublicInstance/ReactNativeAttributePayload": "export const create = (props) => ({ ...props }); export const diff = (prev, next) => { const out = {}; let changed = false; for (const k of new Set([...Object.keys(prev), ...Object.keys(next)])) { if (prev[k] !== next[k]) { out[k] = k in next ? next[k] : null; changed = true; } } return changed ? out : null; };",
  "react-native/Libraries/Renderer/shims/ReactNativeViewConfigRegistry": "export const get = (name) => ({ uiViewClassName: name, validAttributes: {}, bubblingEventTypes: { topChange: { phasedRegistrationNames: { bubbled: 'onChange', captured: 'onChangeCapture' } } }, directEventTypes: { topLayout: { registrationName: 'onLayout' }, topScroll: { registrationName: 'onScroll' } } });",
  "react-native/Libraries/Utilities/Platform": "export default { OS: 'android', Version: 34 };",
  "react-native/Libraries/Image/resolveAssetSource": "export default (source) => source && typeof source === 'object' && 'uri' in source ? { scale: 1, ...source } : null;",
  "react-native/Libraries/Components/View/ViewNativeComponent": "export {};",
  "react-native/Libraries/Text/TextNativeComponent": "export {};",
  "react-native/Libraries/Components/ScrollView/ScrollViewNativeComponent": "export {};",
  "@rasheed/svelte-native": "export const View = null, Text = null, Pressable = null;", // the fixture imports the primitives to be lowered; nothing of them is left to run
  "expo-modules-core": "export const requireOptionalNativeModule = () => null;",
  "react-native": "export const AppRegistry = { registerRunnable() {} };",
};

async function load() {
  const bundle = await build({
    stdin: {
      contents: `import Fixture from './responder-fixture.svelte';
        import { startSurface } from '../src/fabric/host.ts';
        import { tick } from 'svelte';
        export { startSurface, tick, Fixture };`,
      resolveDir: import.meta.dirname,
    },
    bundle: true, format: "esm", platform: "neutral", conditions: ["browser"], write: false,
    plugins: [{
      name: "fabric-fixture",
      setup(builder) {
        builder.onResolve({ filter: /^(react-native|expo-modules-core)/ }, (args) => (args.path.startsWith("react-native-gesture-handler") ? undefined : { path: args.path, namespace: "stub" }));
        builder.onLoad({ filter: /.*/, namespace: "stub" }, (args) => ({ contents: stubs[args.path] ?? "export {};", loader: "js" }));
        builder.onResolve({ filter: /^@rasheed\/svelte-native$/ }, (args) => ({ path: args.path, namespace: "stub" }));
        builder.onResolve({ filter: /^@rasheed\/svelte-native\/renderer$/ }, () => ({ path: resolve(import.meta.dirname, "../src/renderer.ts") }));
        builder.onResolve({ filter: /^esm-env$/ }, () => ({ path: resolve(import.meta.dirname, "../src/environment.ts") }));
        builder.onLoad({ filter: /\.svelte$/ }, async ({ path }) => ({
          // As the app's build does: the primitives imported from the package are lowered to host tags before the compile.
          contents: compile(lowerPrimitives(await readFile(path, "utf8"), { filename: path, warn: () => {} }), componentOptions(path)).js.code,
          loader: "js",
        }));
      },
    }],
  });
  const directory = await mkdtemp(resolve(tmpdir(), "svelte-native-responder-"));
  const file = resolve(directory, "bundle.mjs");
  await writeFile(file, bundle.outputFiles[0].contents);
  const m = await import(pathToFileURL(file).href);
  await rm(directory, { recursive: true });
  return m;
}
const settle = async (m: { tick: () => Promise<void> }) => { await m.tick(); await Promise.resolve(); await Promise.resolve(); };


const emit = (target: unknown, type: string, event: object) => (fake as unknown as { handler: (t: unknown, type: string, e: object) => void }).handler(target, type, event);
let nextRoot = 100;
const rect = { x: 0, y: 0, w: 100, h: 40 };
// Fabric has no frame for a Text nested in a Text: its `measure` calls back with no numbers (the paragraph, which lays the words out, answers).
const measured: string[] = [];
fake.measure = (node: FakeNode, callback: (...args: number[]) => void) => {
  measured.push(node.name);
  if (node.name === "RCTVirtualText") callback();
  else callback(0, 0, rect.w, rect.h, rect.x, rect.y);
};

async function setup() {
  const m = await load();
  roots = {};
  const log: string[] = [];
  const events: unknown[] = [];
  const root = nextRoot++;
  const app = m.startSurface(root, m.Fixture, { log: (entry: string) => log.push(entry), events }) as { setSlop: (n: number) => void; isPressed: () => boolean; removePress: () => void; hideEphemeral: () => void; removeStrip: () => void; setGate: (open: boolean) => void };
  const all = (nodes: FakeNode[]): FakeNode[] => nodes.flatMap((n) => [n, ...all(n.children)]);
  const nodeOf = (id: string) => {
    const node = all(roots[root]).find((n) => n.props.testID === id);
    if (!node) throw new Error(`no node ${id}`);
    return node.target;
  };
  let clock = 1000;
  /** A touch event to a node the test holds (one that is not in the tree any more, say), as native sends it: to the node the gesture's finger went down on. */
  const sendTo = (target: unknown, type: string, x = 10, y = 10, identifier = 0) => {
    const touch = { pageX: x, pageY: y, locationX: x, locationY: y, identifier, target: 1, timestamp: clock++ };
    const lifting = type === "topTouchEnd" || type === "topTouchCancel";
    emit(target, type, { ...touch, touches: lifting ? [] : [touch], changedTouches: [touch] });
  };
  const send = (id: string, type: string, x = 10, y = 10, identifier = 0) => sendTo(nodeOf(id), type, x, y, identifier);
  return { m, log, events, app, send, sendTo, nodeOf, settle: () => settle(m) };
}

afterEach(() => { jest.useRealTimers(); });

test("a quick tap runs onPressIn, onPress, then onPressOut after the minimum press duration", async () => {
  jest.useFakeTimers();
  const t = await setup();
  t.send("a", "topTouchStart");
  expect(t.log).toEqual(["a.change true", "a.in"]);
  t.send("a", "topTouchEnd");
  expect(t.log).toEqual(["a.change true", "a.in", "a.press"]);
  expect(t.app.isPressed()).toBe(true);
  jest.advanceTimersByTime(130);
  expect(t.log).toEqual(["a.change true", "a.in", "a.press", "a.out", "a.change false"]);
  expect(t.app.isPressed()).toBe(false);
});

test("with minPressDuration 0 the order is onPressIn, onPressOut, onPress", async () => {
  jest.useFakeTimers();
  const t = await setup();
  t.send("instant", "topTouchStart");
  t.send("instant", "topTouchEnd");
  expect(t.log).toEqual(["i.in", "i.out", "i.press"]);
});

test("the press handler receives a press event with the touch's nativeEvent", async () => {
  jest.useFakeTimers();
  const t = await setup();
  t.send("evt", "topTouchStart", 12, 34);
  t.send("evt", "topTouchEnd", 12, 34);
  expect(t.events).toHaveLength(1);
  const event = t.events[0] as { nativeEvent: Record<string, unknown>; currentTarget: unknown; persist: () => void };
  expect(event.nativeEvent).toMatchObject({ pageX: 12, pageY: 34, locationX: 12, locationY: 34, identifier: 0 });
  expect(event.nativeEvent.timestamp).toBeNumber();
  expect(event.currentTarget).toBe(t.nodeOf("evt"));
  event.persist();
});

test("moving outside the press rect, hitSlop and the default offset cancels the press", async () => {
  jest.useFakeTimers();
  const t = await setup();
  t.send("a", "topTouchStart", 50, 20);
  t.send("a", "topTouchMove", 50, 200); // below the 40pt tall box and its 30pt offset
  t.send("a", "topTouchEnd", 50, 200);
  expect(t.log).not.toContain("a.press");
  jest.advanceTimersByTime(500);
  expect(t.log).toContain("a.out");
});

test("a move that stays inside the offset keeps the press, and hitSlop widens the region", async () => {
  jest.useFakeTimers();
  const t = await setup();
  t.send("a", "topTouchStart", 50, 20);
  t.send("a", "topTouchMove", 50, 65); // 40 + 30 offset = 70
  t.send("a", "topTouchEnd", 50, 65);
  expect(t.log).toContain("a.press");

  const u = await setup();
  u.send("a", "topTouchStart", 50, 20);
  u.send("a", "topTouchMove", 50, 90);
  u.send("a", "topTouchEnd", 50, 90);
  expect(u.log).not.toContain("a.press");

  const v = await setup();
  v.app.setSlop(40);
  await v.settle();
  v.send("a", "topTouchStart", 50, 20);
  v.send("a", "topTouchMove", 50, 90); // 40 + 40 slop + 30 offset = 110
  v.send("a", "topTouchEnd", 50, 90);
  expect(v.log).toContain("a.press");
});

test("pressRetentionOffset (React Native's Pressable name) and pressRectOffset (Pressability's) both widen the region a press may move in", async () => {
  jest.useFakeTimers();
  for (const id of ["retained", "rect"]) {
    const t = await setup();
    t.send(id, "topTouchStart", 50, 20);
    t.send(id, "topTouchMove", 50, 120); // 40 + 100 offset = 140; the default offset (30) would have cancelled at 70
    t.send(id, "topTouchEnd", 50, 120);
    expect(t.log).toContain(`${id}.press`);
  }
});

test("leaving and re-entering the press rect before release still presses", async () => {
  jest.useFakeTimers();
  const t = await setup();
  t.send("a", "topTouchStart", 50, 20);
  t.send("a", "topTouchMove", 50, 300);
  t.send("a", "topTouchMove", 50, 20);
  t.send("a", "topTouchEnd", 50, 20);
  expect(t.log).toContain("a.press");
});

test("topTouchCancel terminates the press without onPress", async () => {
  jest.useFakeTimers();
  const t = await setup();
  t.send("a", "topTouchStart");
  t.send("a", "topTouchCancel");
  jest.advanceTimersByTime(1000);
  expect(t.log).toEqual(["a.change true", "a.in", "a.out", "a.change false"]);
});

test("a long press fires onLongPress after delayLongPress and, with onLongPress present, replaces onPress", async () => {
  jest.useFakeTimers();
  const t = await setup();
  t.send("lp", "topTouchStart");
  jest.advanceTimersByTime(299);
  expect(t.log).toEqual([]);
  jest.advanceTimersByTime(1);
  expect(t.log).toEqual(["lp.long"]);
  t.send("lp", "topTouchEnd");
  jest.advanceTimersByTime(1000);
  expect(t.log).toEqual(["lp.long", "lp.out"]);
});

test("a short press on a node with onLongPress still presses; moving away cancels the long press", async () => {
  jest.useFakeTimers();
  const t = await setup();
  t.send("lp", "topTouchStart");
  jest.advanceTimersByTime(100);
  t.send("lp", "topTouchEnd");
  jest.advanceTimersByTime(1000);
  expect(t.log).toEqual(["lp.press", "lp.out"]);

  const u = await setup();
  u.send("lp", "topTouchStart", 50, 20);
  u.send("lp", "topTouchMove", 50, 20 + 25); // beyond the 10pt long-press deactivation distance, still in the rect
  jest.advanceTimersByTime(1000);
  expect(u.log).not.toContain("lp.long");
  u.send("lp", "topTouchEnd", 50, 45);
  expect(u.log).toContain("lp.press");
});

test("a pressable with onLongPress but a long hold drops onPress; without onLongPress the hold still presses", async () => {
  jest.useFakeTimers();
  const t = await setup();
  t.send("lponly", "topTouchStart");
  jest.advanceTimersByTime(600);
  t.send("lponly", "topTouchEnd");
  expect(t.log).toEqual(["lo.long"]);

  const u = await setup();
  u.app.removePress();
  await u.settle();
  u.send("instant", "topTouchStart");
  jest.advanceTimersByTime(600);
  u.send("instant", "topTouchEnd");
  expect(u.log).toContain("i.press"); // no onLongPress there: the hold is just a slow press
});

test("nested pressables: the innermost handles the press, the outer does not", async () => {
  jest.useFakeTimers();
  const t = await setup();
  t.send("inner", "topTouchStart");
  t.send("inner", "topTouchEnd");
  expect(t.log).toEqual(["inner.press"]);
});

test("a disabled pressable ignores touches and lets the enclosing pressable take them", async () => {
  jest.useFakeTimers();
  const t = await setup();
  t.send("innerDisabled", "topTouchStart");
  t.send("innerDisabled", "topTouchEnd");
  expect(t.log).toEqual(["outer.press"]);
});

test("a native-text and a plain native-view with onPress both press", async () => {
  jest.useFakeTimers();
  const t = await setup();
  t.send("text", "topTouchStart");
  t.send("text", "topTouchEnd");
  expect(t.log).toEqual(["text.press"]);
  t.log.length = 0;
  t.send("outer", "topTouchStart");
  t.send("outer", "topTouchEnd");
  expect(t.log).toEqual(["outer.press"]);
});

test("a node without press or responder handlers is never a responder, and bubbling touches still reach onTouch handlers", async () => {
  jest.useFakeTimers();
  const t = await setup();
  t.send("plain", "topTouchStart");
  t.send("plain", "topTouchEnd");
  expect(t.log).toEqual([]);
  t.send("custom", "topTouchStart");
  expect(t.log).toEqual(["custom.grant", "custom.touchStart"]);
});

test("custom responder handlers get grant, move, release and terminate", async () => {
  const t = await setup();
  t.send("custom", "topTouchStart");
  t.send("custom", "topTouchMove", 20, 20);
  t.send("custom", "topTouchEnd", 20, 20);
  expect(t.log.filter((e) => e !== "custom.touchStart")).toEqual(["custom.grant", "custom.move", "custom.release"]);
  t.log.length = 0;
  t.send("custom", "topTouchStart");
  t.send("custom", "topTouchCancel");
  expect(t.log.filter((e) => e !== "custom.touchStart")).toEqual(["custom.grant", "custom.terminate"]);
});

test("an ancestor claims the gesture on move when the responder allows termination", async () => {
  const t = await setup();
  t.send("victimA", "topTouchStart");
  t.send("victimA", "topTouchMove", 30, 30);
  expect(t.log).toEqual(["victimA.terminate", "thiefA.grant"]);
});

test("a responder that refuses termination keeps the gesture", async () => {
  const t = await setup();
  t.send("victimB", "topTouchStart");
  t.send("victimB", "topTouchMove", 30, 30);
  expect(t.log).toEqual(["victimB.move"]);
});

test("a capture-phase onStartShouldSetResponderCapture takes the gesture before the target", async () => {
  const t = await setup();
  t.send("captured", "topTouchStart");
  t.send("captured", "topTouchEnd");
  expect(t.log).toEqual(["captor.grant"]);
});

test("a second finger does not take the gesture, and the press ends when the last finger lifts", async () => {
  jest.useFakeTimers();
  const t = await setup();
  t.send("instant", "topTouchStart", 10, 10, 0);
  t.send("instant", "topTouchStart", 20, 10, 1);
  t.send("instant", "topTouchEnd", 20, 10, 1);
  expect(t.log).toEqual(["i.in"]);
  t.send("instant", "topTouchEnd", 10, 10, 0);
  expect(t.log).toEqual(["i.in", "i.out", "i.press"]);
});

test("topClick (accessibility activation) calls the nearest enabled onPress", async () => {
  const t = await setup();
  emit(t.nodeOf("inner"), "topClick", {});
  expect(t.log).toEqual(["inner.press"]);
  t.log.length = 0;
  emit(t.nodeOf("innerDisabled"), "topClick", {});
  expect(t.log).toEqual(["outer.press"]);
});

test("a stale gesture whose end was lost does not wedge the next touch", async () => {
  jest.useFakeTimers();
  const t = await setup();
  t.send("custom", "topTouchStart");
  t.send("custom", "topTouchCancel");
  t.log.length = 0;
  t.send("instant", "topTouchStart");
  t.send("instant", "topTouchEnd");
  expect(t.log).toEqual(["i.in", "i.out", "i.press"]);
});


// A Text nested in a Text has no view. The Android engine finds the one under the finger (React Native's `reactTagForTouch`) and dispatches the touch to that node, so the
// target of a touch can be a nested Text (the iOS paragraph view has always done it); the responder system starts from it and walks up, as it does from any node.

test("a press on a nested Text runs its own onPress and not the paragraph's", async () => {
  jest.useFakeTimers();
  const t = await setup();
  t.send("span", "topTouchStart");
  expect(t.log).toEqual(["span.change true", "span.in", "span.touchStart"]);
  t.send("span", "topTouchEnd");
  expect(t.log).toEqual(["span.change true", "span.in", "span.touchStart", "span.press"]);
  jest.advanceTimersByTime(130);
  expect(t.log).toEqual(["span.change true", "span.in", "span.touchStart", "span.press", "span.out", "span.change false"]);
  expect(t.log).not.toContain("paragraph.press");
});

test("a nested Text that listens for nothing hands the press to the paragraph around it", async () => {
  jest.useFakeTimers();
  const t = await setup();
  t.send("plainSpan", "topTouchStart");
  t.send("plainSpan", "topTouchEnd");
  expect(t.log).toEqual(["paragraph.press"]);
});

test("a press on one nested Text is not a press on its sibling or on the paragraph", async () => {
  jest.useFakeTimers();
  const t = await setup();
  t.send("sibling", "topTouchStart");
  t.send("sibling", "topTouchEnd");
  expect(t.log).toEqual(["sibling.press"]);
  t.log.length = 0;
  t.send("paragraph", "topTouchStart");
  t.send("paragraph", "topTouchEnd");
  expect(t.log).toEqual(["paragraph.press"]);
});

test("the nearest nested Text with a handler takes the press, and one inside a pressable span presses that span", async () => {
  jest.useFakeTimers();
  const t = await setup();
  t.send("innerBold", "topTouchStart");
  t.send("innerBold", "topTouchEnd");
  expect(t.log).toEqual(["outerLink.press"]);
  t.log.length = 0;
  t.send("innerDeep", "topTouchStart");
  t.send("innerDeep", "topTouchEnd");
  expect(t.log).toEqual(["outerLink.press"]);
  t.log.length = 0;
  t.send("innerLinkBold", "topTouchStart");
  t.send("innerLinkBold", "topTouchEnd");
  expect(t.log).toEqual(["innerLink.press"]);
});

test("a nested Text's press event names the nested Text as its target, with the touch's position", async () => {
  jest.useFakeTimers();
  const t = await setup();
  t.send("evtSpan", "topTouchStart", 12, 34);
  t.send("evtSpan", "topTouchEnd", 12, 34);
  expect(t.events).toHaveLength(1);
  expect(t.log).toEqual([]); // the paragraph's onPress is not run
  const event = t.events[0] as { nativeEvent: Record<string, unknown>; target: unknown; currentTarget: unknown };
  expect(event.nativeEvent).toMatchObject({ pageX: 12, pageY: 34, locationX: 12, locationY: 34, identifier: 0 });
  expect(event.target).toBe(t.nodeOf("evtSpan"));
  expect(event.currentTarget).toBe(t.nodeOf("evtSpan"));
});

test("a nested Text's press follows the same rules as a pressable's: a long press replaces onPress, cancelled on a move away", async () => {
  jest.useFakeTimers();
  const t = await setup();
  t.send("longSpan", "topTouchStart");
  jest.advanceTimersByTime(300);
  expect(t.log).toEqual(["longSpan.long"]);
  t.send("longSpan", "topTouchEnd");
  expect(t.log).toEqual(["longSpan.long"]); // onLongPress is there to take the press
  t.log.length = 0;

  const u = await setup();
  u.send("longSpan", "topTouchStart", 50, 20);
  u.send("longSpan", "topTouchMove", 50, 20 + 25); // beyond the long-press deactivation distance, still in the paragraph's region
  jest.advanceTimersByTime(1000);
  expect(u.log).not.toContain("longSpan.long");
  u.send("longSpan", "topTouchEnd", 50, 45);
  expect(u.log).toContain("longSpan.press");
});

test("moving off the paragraph cancels a nested Text's press: its region is the paragraph's, which Fabric can measure and the nested Text it cannot", async () => {
  jest.useFakeTimers();
  const t = await setup();
  measured.length = 0;
  t.send("span", "topTouchStart", 50, 20);
  expect(measured).toContain("RCTText"); // not the nested Text's own (empty) answer
  t.send("span", "topTouchMove", 50, 200); // below the 40pt tall paragraph and its 30pt offset
  t.send("span", "topTouchEnd", 50, 200);
  expect(t.log).not.toContain("span.press");
  jest.advanceTimersByTime(500);
  expect(t.log).toContain("span.out");
  expect(t.log.at(-1)).toBe("span.change false");

  const u = await setup();
  u.send("span", "topTouchStart", 50, 20);
  u.send("span", "topTouchMove", 50, 65); // 40 + the 30pt offset = 70
  u.send("span", "topTouchEnd", 50, 65);
  expect(u.log).toContain("span.press");

  // Leaving and coming back before the release still presses, as for any pressable.
  const v = await setup();
  v.send("span", "topTouchStart", 50, 20);
  v.send("span", "topTouchMove", 50, 300);
  v.send("span", "topTouchMove", 50, 20);
  v.send("span", "topTouchEnd", 50, 20);
  expect(v.log).toContain("span.press");
});

test("a touch that is cancelled ends a nested Text's press without onPress", async () => {
  jest.useFakeTimers();
  const t = await setup();
  t.send("span", "topTouchStart");
  t.send("span", "topTouchCancel");
  jest.advanceTimersByTime(1000);
  expect(t.log).toEqual(["span.change true", "span.in", "span.touchStart", "span.out", "span.change false"]);
});

test("topClick on a nested Text (an accessibility service activating a link) presses it, and a nested Text with no handler gives the click to the paragraph", async () => {
  const t = await setup();
  emit(t.nodeOf("span"), "topClick", {});
  expect(t.log).toEqual(["span.press"]);
  t.log.length = 0;
  emit(t.nodeOf("plainSpan"), "topClick", {});
  expect(t.log).toEqual(["paragraph.press"]);
});

// What a gesture does when the node it went down on goes away, and which node a move names.

test("a nested Text unmounted while it is pressed is not pressed: its press ends with none of its handlers run, and the next touch works", async () => {
  jest.useFakeTimers();
  const t = await setup();
  const gone = t.nodeOf("ephemeral");
  t.send("ephemeral", "topTouchStart");
  expect(t.log).toEqual(["eph.change true", "eph.in"]);
  t.app.hideEphemeral();
  await t.settle();
  t.sendTo(gone, "topTouchEnd");
  jest.advanceTimersByTime(1000);
  expect(t.log).toEqual(["eph.change true", "eph.in"]); // no press, no press out of a component that is gone
  t.log.length = 0;
  t.send("sibling", "topTouchStart");
  t.send("sibling", "topTouchEnd");
  expect(t.log).toEqual(["sibling.press"]);
});

test("a nested Text unmounted while it is pressed, whose end never arrives (native drops the touches of a deleted node), does not wedge the next gesture", async () => {
  jest.useFakeTimers();
  const t = await setup();
  t.send("ephemeral", "topTouchStart");
  t.app.hideEphemeral();
  await t.settle();
  t.log.length = 0;
  // The finger lifts and goes down again (native gives the same pointer id): the end was lost, and the new gesture is a gesture.
  t.send("sibling", "topTouchStart");
  t.send("sibling", "topTouchEnd");
  expect(t.log).toEqual(["sibling.press"]);
  t.send("sibling", "topTouchStart");
  t.send("sibling", "topTouchEnd");
  expect(t.log).toEqual(["sibling.press", "sibling.press"]);
});

test("a finger that goes down again without having come up ends the gesture whose end was lost, for a node that is still there too", async () => {
  jest.useFakeTimers();
  const t = await setup();
  t.send("instant", "topTouchStart");
  expect(t.log).toEqual(["i.in"]);
  t.send("a", "topTouchStart"); // the same finger (identifier 0): the end of the first gesture never came
  expect(t.log).toEqual(["i.in", "i.out", "a.change true", "a.in"]);
  t.send("a", "topTouchEnd");
  expect(t.log).toContain("a.press");
  expect(t.log).not.toContain("i.press");
});

test("a second finger (another identifier) is not a lost end", async () => {
  jest.useFakeTimers();
  const t = await setup();
  t.send("instant", "topTouchStart", 10, 10, 0);
  t.send("a", "topTouchStart", 20, 10, 1);
  expect(t.log).toEqual(["i.in"]);
});

test("a nested Text whose handlers are removed while it is pressed ends the press with nothing run, and the next touch works", async () => {
  jest.useFakeTimers();
  const t = await setup();
  t.send("strip", "topTouchStart");
  expect(t.log).toEqual(["strip.in"]);
  t.app.removeStrip();
  await t.settle();
  t.send("strip", "topTouchEnd");
  jest.advanceTimersByTime(1000);
  expect(t.log).toEqual(["strip.in"]); // the press the handlers were removed from is not run
  t.log.length = 0;
  t.send("sibling", "topTouchStart");
  t.send("sibling", "topTouchEnd");
  expect(t.log).toEqual(["sibling.press"]);
});

test("a move that names another nested Text than the press began on does not move the press: the first one is still the responder and presses", async () => {
  jest.useFakeTimers();
  const t = await setup();
  t.send("span", "topTouchStart", 50, 20);
  t.send("sibling", "topTouchMove", 60, 20); // the target of a move is the node the gesture began on; a host that is told another one must not be thrown by it
  t.send("span", "topTouchEnd", 60, 20);
  jest.advanceTimersByTime(200);
  expect(t.log).toContain("span.press");
  expect(t.log).not.toContain("sibling.press");
  expect(t.log).not.toContain("paragraph.press");
});

test("a move on another nested Text asks the Text around both whether it takes the gesture, as for any two nodes: with a handler that says yes it does, and the press is cancelled", async () => {
  jest.useFakeTimers();
  const t = await setup();
  t.send("moveA", "topTouchStart", 50, 20);
  expect(t.log).toEqual([]);
  t.send("moveB", "topTouchMove", 60, 20);
  expect(t.log).toEqual(["movePara.grant"]);
  jest.advanceTimersByTime(500);
  expect(t.log).toEqual(["movePara.grant", "moveA.out"]);
  t.send("moveA", "topTouchEnd", 60, 20);
  expect(t.log).not.toContain("moveA.press");
  expect(t.log).not.toContain("moveB.press");
});

test("a nested Text with a long press and no press: a tap is nothing, and does not press the paragraph around it; a hold runs the long press", async () => {
  jest.useFakeTimers();
  const t = await setup();
  t.send("longOnly", "topTouchStart");
  t.send("longOnly", "topTouchEnd");
  jest.advanceTimersByTime(1000);
  expect(t.log).toEqual([]);
  t.send("longOnly", "topTouchStart");
  jest.advanceTimersByTime(300);
  expect(t.log).toEqual(["longOnly.long"]);
  t.send("longOnly", "topTouchEnd");
  jest.advanceTimersByTime(1000);
  expect(t.log).toEqual(["longOnly.long"]);
  t.send("longParagraph", "topTouchStart");
  t.send("longParagraph", "topTouchEnd");
  expect(t.log).toEqual(["longOnly.long", "longPara.press"]); // the paragraph itself still presses
});

// A press handler written as an expression that may be `undefined` (`onPress={enabled ? go : undefined}`). Svelte compiles that to an event listener that is on the node for good,
// so the node looked like a pressable that does nothing and kept the press from the nearest ancestor that has a handler; the lowering passes it as a prop that is there only while
// it is a function.

test("a nested Text whose onPress is undefined is no responder: the press goes to the Text around it; with a function again it is its own", async () => {
  jest.useFakeTimers();
  const t = await setup();
  t.send("gatedSpan", "topTouchStart");
  t.send("gatedSpan", "topTouchEnd");
  jest.advanceTimersByTime(200);
  expect(t.log).toEqual(["gatedSpan.in", "gatedSpan.press"]);
  t.log.length = 0;
  t.app.setGate(false);
  await t.settle();
  t.send("gatedSpan", "topTouchStart");
  t.send("gatedSpan", "topTouchEnd");
  jest.advanceTimersByTime(200);
  expect(t.log).toEqual(["gateParagraph.press"]);
  t.log.length = 0;
  t.app.setGate(true);
  await t.settle();
  t.send("gatedSpan", "topTouchStart");
  t.send("gatedSpan", "topTouchEnd");
  jest.advanceTimersByTime(200);
  expect(t.log).toEqual(["gatedSpan.in", "gatedSpan.press"]);
});

test("a Text, a View and a Pressable whose onPress is undefined are no responder: the press goes to the View around them", async () => {
  jest.useFakeTimers();
  const t = await setup();
  for (const id of ["gatedText", "gatedView", "gatedPressable"]) {
    t.send(id, "topTouchStart");
    t.send(id, "topTouchEnd");
    expect(t.log).toEqual([`${id}.press`]);
    t.log.length = 0;
  }
  t.app.setGate(false);
  await t.settle();
  for (const id of ["gatedText", "gatedView", "gatedPressable"]) {
    t.send(id, "topTouchStart");
    t.send(id, "topTouchEnd");
    expect(t.log).toEqual(["gateRoot.press"]);
    t.log.length = 0;
  }
  // Nor does a long press with no function: a hold is no long press, and the press is the View's.
  t.send("gatedText", "topTouchStart");
  jest.advanceTimersByTime(1000);
  t.send("gatedText", "topTouchEnd");
  expect(t.log).toEqual(["gateRoot.press"]);
});

test("an accessibility click on a node whose onPress is undefined goes to the nearest ancestor that has one", async () => {
  const t = await setup();
  emit(t.nodeOf("gatedSpan"), "topClick", {});
  expect(t.log).toEqual(["gatedSpan.press"]);
  t.log.length = 0;
  t.app.setGate(false);
  await t.settle();
  emit(t.nodeOf("gatedSpan"), "topClick", {});
  expect(t.log).toEqual(["gateParagraph.press"]);
});
