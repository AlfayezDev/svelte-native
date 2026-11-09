import { test, expect, jest, afterEach } from "bun:test";
import { build } from "esbuild";
import { readFile, mkdtemp, writeFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { compile } from "svelte/compiler";
import { componentOptions } from "../src/compile-options.ts";
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
        builder.onResolve({ filter: /^@rasheed\/svelte-native\/renderer$/ }, () => ({ path: resolve(import.meta.dirname, "../src/renderer.ts") }));
        builder.onResolve({ filter: /^esm-env$/ }, () => ({ path: resolve(import.meta.dirname, "../src/environment.ts") }));
        builder.onLoad({ filter: /\.svelte$/ }, async ({ path }) => ({
          contents: compile(await readFile(path, "utf8"), componentOptions(path)).js.code,
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
fake.measure = (node: FakeNode, callback: (...args: number[]) => void) => { callback(0, 0, rect.w, rect.h, rect.x, rect.y); void node; };

async function setup() {
  const m = await load();
  roots = {};
  const log: string[] = [];
  const events: unknown[] = [];
  const root = nextRoot++;
  const app = m.startSurface(root, m.Fixture, { log: (entry: string) => log.push(entry), events }) as { setSlop: (n: number) => void; isPressed: () => boolean; removePress: () => void };
  const all = (nodes: FakeNode[]): FakeNode[] => nodes.flatMap((n) => [n, ...all(n.children)]);
  const nodeOf = (id: string) => {
    const node = all(roots[root]).find((n) => n.props.testID === id);
    if (!node) throw new Error(`no node ${id}`);
    return node.target;
  };
  let clock = 1000;
  const send = (id: string, type: string, x = 10, y = 10, identifier = 0) => {
    const touch = { pageX: x, pageY: y, locationX: x, locationY: y, identifier, target: 1, timestamp: clock++ };
    const lifting = type === "topTouchEnd" || type === "topTouchCancel";
    emit(nodeOf(id), type, { ...touch, touches: lifting ? [] : [touch], changedTouches: [touch] });
  };
  return { m, log, events, app, send, nodeOf, settle: () => settle(m) };
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

