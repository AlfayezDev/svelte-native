import { afterEach, beforeAll, expect, jest, test } from "bun:test";
import { find, type FakeNode } from "./foreign-harness.ts";
import { settle, svgHarness, type SvgLoaded } from "./svg-harness.ts";
import type { AnimLog } from "./reanimated-stubs.ts";

/**
 * What an `Svg` does with the native side of the library (SPEC.md, "react-native-svg"): the methods of its refs are the library's TurboModule calls with the view's
 * tag, touch props reach the host's responder (and what the engine does with them is in the SPEC), and animated props are written by Reanimated on the UI thread.
 */
type Handle = Record<string, (...args: unknown[]) => unknown> & { tag: number; host: { tag: number } };
type App = { handle(name: string): Handle | undefined; hide(): void };
const rootTag = 150;
const turboCalls: string[] = [];
const turbo = {
  RNSVGRenderableModule: {
    isPointInFill: (tag: number, options: object) => { turboCalls.push(`isPointInFill ${tag} ${JSON.stringify(options)}`); return true; },
    isPointInStroke: (tag: number, options: object) => { turboCalls.push(`isPointInStroke ${tag} ${JSON.stringify(options)}`); return false; },
    getTotalLength: (tag: number) => { turboCalls.push(`getTotalLength ${tag}`); return 10; },
    getPointAtLength: (tag: number, options: object) => { turboCalls.push(`getPointAtLength ${tag} ${JSON.stringify(options)}`); return { x: 5, y: 0 }; },
    getBBox: (tag: number, options: object) => { turboCalls.push(`getBBox ${tag} ${JSON.stringify(options)}`); return { x: 0, y: -1, width: 10, height: 2 }; },
    getCTM: (tag: number) => { turboCalls.push(`getCTM ${tag}`); return { a: 1, b: 0, c: 0, d: 1, e: 2, f: 3 }; },
    getScreenCTM: (tag: number) => { turboCalls.push(`getScreenCTM ${tag}`); return { a: 2, b: 0, c: 0, d: 2, e: 0, f: 0 }; },
  },
  RNSVGSvgViewModule: {
    toDataURL: (tag: number, options: object | undefined, callback: (base64: string) => void) => { turboCalls.push(`toDataURL ${tag} ${JSON.stringify(options)}`); callback("iVBORw0KGgo="); },
  },
};
const events: string[] = [];
const radius = { value: 4, _isReanimatedSharedValue: true };
const cx = { value: 10, _isReanimatedSharedValue: true };
const dash = { value: "M0 0L5 5", _isReanimatedSharedValue: true };

let loaded: SvgLoaded;
let app: App;
let roots: () => Record<number, FakeNode[]>;
let calls: string[];
let emit: (target: unknown, type: string, event?: object) => void;
const anim = () => (globalThis as { __anim: AnimLog }).__anim;
const named = (name: string) => find(roots()[rootTag] ?? [], name);
const path = () => named("RNSVGPath")[0] as FakeNode;

/** Where this file's entries start in the animation stub's log, which test files run earlier in the same process share. */
let ownFrom = { descriptors: 0, mappers: 0 };

beforeAll(async () => {
  const harness = await svgHarness("android", { natives: { turbo } });
  ownFrom = { descriptors: anim()?.descriptors.length ?? 0, mappers: anim()?.mappers.length ?? 0 };
  loaded = await harness.load("svg-native-fixture.svelte") as SvgLoaded;
  app = loaded.startSurface(rootTag, loaded.Fixture, { log: (entry: string) => events.push(entry), radius, cx, dash }) as App;
  roots = harness.roots;
  calls = harness.calls;
  emit = harness.emit;
}, 60_000);

afterEach(() => { jest.useRealTimers(); });

test("the geometry methods of a ref call the library's module with the view's tag", () => {
  const handle = app.handle("path") as Handle;
  expect(handle.tag).toBe(path().tag);
  expect(handle.host.tag).toBe(path().tag);
  expect(handle.getTotalLength()).toBe(10);
  expect(handle.getPointAtLength(5)).toEqual({ x: 5, y: 0 });
  expect(handle.getBBox()).toEqual({ x: 0, y: -1, width: 10, height: 2 });
  expect(handle.getBBox({ stroke: false, markers: false })).toEqual({ x: 0, y: -1, width: 10, height: 2 });
  expect(handle.isPointInFill({ x: 1, y: 2 })).toBe(true);
  expect(handle.isPointInStroke({ x: 1, y: 2 })).toBe(false);
  expect(handle.getCTM()).toEqual({ a: 1, b: 0, c: 0, d: 1, e: 2, f: 3 });
  expect(handle.getScreenCTM()).toEqual({ a: 2, b: 0, c: 0, d: 2, e: 0, f: 0 });
  const tag = path().tag;
  expect(turboCalls).toEqual([
    `getTotalLength ${tag}`, `getPointAtLength ${tag} {"length":5}`,
    `getBBox ${tag} {"fill":true,"stroke":true,"markers":true,"clipped":true}`, `getBBox ${tag} {"fill":true,"stroke":false,"markers":false,"clipped":true}`,
    `isPointInFill ${tag} {"x":1,"y":2}`, `isPointInStroke ${tag} {"x":1,"y":2}`, `getCTM ${tag}`, `getScreenCTM ${tag}`,
  ]);
  // Only the root draws itself.
  expect("toDataURL" in handle).toBe(false);
});

test("the ref of the Svg draws it: toDataURL calls the view module with the options and the callback", () => {
  turboCalls.length = 0;
  const svg = app.handle("svg") as Handle;
  const root = named("RNSVGSvgViewAndroid")[0] as FakeNode;
  expect(svg.tag).toBe(root.tag);
  const results: string[] = [];
  svg.toDataURL((base64: string) => results.push(base64), { width: 8, height: 8 });
  expect(results).toEqual(["iVBORw0KGgo="]);
  expect(turboCalls).toEqual([`toDataURL ${root.tag} {"width":8,"height":8}`]);
  // The Svg's handle is a shape's too.
  expect(svg.getTotalLength()).toBe(10);
});

test("commands and setNativeProps go through Fabric (the nodes are React Native's); setNativeProps converts brushes and a group's transform", () => {
  calls.length = 0;
  const handle = app.handle("path") as Handle;
  handle.dispatchCommand("anything", [1]);
  handle.setNativeProps({ fill: "red", stroke: "none", strokeWidth: 2 });
  (app.handle("group") as Handle).setNativeProps({ translateX: 4, translateY: 5 });
  (app.handle("circle") as Handle).setNativeProps({ translateX: 4 });
  expect(calls).toEqual([
    "fabric.dispatchCommand RNSVGPath anything [1]",
    'fabric.setNativeProps RNSVGPath {"fill":{"type":0,"payload":-65536},"stroke":null,"strokeWidth":2}',
    'fabric.setNativeProps RNSVGGroup {"translateX":4,"translateY":5,"matrix":[1,0,0,1,4,5]}',
    'fabric.setNativeProps RNSVGCircle {"translateX":4}',
  ]);
});

const touch = (target: unknown, type: string, x = 5, y = 5) => emit(target, type, { pageX: x, pageY: y, locationX: x, locationY: y, identifier: 0, target: 1, timestamp: 1, touches: type === "topTouchEnd" ? [] : [{ pageX: x, pageY: y, identifier: 0 }], changedTouches: [{ pageX: x, pageY: y, identifier: 0 }] });

test("a shape that has press handlers is `responsible`, and a touch that reaches JavaScript runs them as it does for a view", () => {
  jest.useFakeTimers();
  events.length = 0;
  const shape = path();
  expect(shape.props.responsible).toBe(true);
  expect(named("RNSVGText")[0]?.props.responsible).toBeUndefined();
  touch(shape.target, "topTouchStart");
  touch(shape.target, "topTouchEnd");
  expect(events).toEqual(["path in", "path press"]);
  jest.advanceTimersByTime(200);
});

test("a long press, and the responder handlers a caller passes, are the host's responder system's", () => {
  jest.useFakeTimers();
  events.length = 0;
  const shape = path();
  touch(shape.target, "topTouchStart");
  jest.advanceTimersByTime(300);
  touch(shape.target, "topTouchEnd");
  expect(events).toContain("path long");
  events.length = 0;
  jest.advanceTimersByTime(200);
  const rect = named("RNSVGRect")[0] as FakeNode;
  expect(rect.props.responsible).toBe(true);
  expect(rect.props.onResponderGrant).toBe(true);
  touch(rect.target, "topTouchStart");
  touch(rect.target, "topTouchEnd");
  expect(events).toEqual(["rect grant", "rect release"]);
});

test("the Svg's own press handler hears touches on the frame (pointerEvents box-only), and the property reaches the native view", () => {
  jest.useFakeTimers();
  events.length = 0;
  const root = named("RNSVGSvgViewAndroid")[0] as FakeNode;
  expect(root.props.pointerEvents).toBe("box-only");
  touch(root.target, "topTouchStart");
  touch(root.target, "topTouchEnd");
  expect(events).toEqual(["svg press"]);
  jest.advanceTimersByTime(200);
});

test("animatedProps: the first values are in the nodes' props, a mapper of its own per node writes the animated props, the node's own props are untouched", () => {
  const circle = named("RNSVGCircle")[0] as FakeNode;
  const outline = named("RNSVGPath")[1] as FakeNode;
  expect(circle.props).toMatchObject({ r: 4, cx: 10, cy: 0 });
  expect(outline.props.d).toBe("M0 0L5 5");
  expect("animatedProps" in circle.props).toBe(false);

  const A = anim();
  const own = (node: FakeNode) => A.descriptors.slice(ownFrom.descriptors).filter((entry) => entry.adds.some((add) => add.tag === node.tag));
  expect(own(circle)).toHaveLength(1);
  expect(own(outline)).toHaveLength(1);
  // Every animated node of the drawing has a mapper; the shape's `r`/`cx` and the path's `d` are separate ones.
  const mapperOf = (node: FakeNode) => A.mappers.slice(ownFrom.mappers).filter((entry) => !entry.stopped)[A.descriptors.slice(ownFrom.descriptors).indexOf(own(node)[0] as never)];
  A.updates.length = 0;
  radius.value = 12;
  cx.value = 30;
  dash.value = "M0 0L20 20";
  mapperOf(circle)?.worklet();
  mapperOf(outline)?.worklet();
  expect(A.updates.map((update) => ({ values: update.values, animatedProps: update.animatedProps }))).toEqual([
    { values: { r: 12, cx: 30 }, animatedProps: true },
    { values: { d: "M0 0L20 20" }, animatedProps: true },
  ]);
  expect((A.updates[0]?.descriptors as { id: number } | undefined)?.id).toBe(own(circle)[0]?.id);
  expect((A.updates[1]?.descriptors as { id: number } | undefined)?.id).toBe(own(outline)[0]?.id);
});

test("an animated node's mapper and descriptors go with the node", async () => {
  const A = anim();
  app.hide();
  await settle(loaded);
  expect(A.mappers.slice(ownFrom.mappers).filter((entry) => !entry.stopped)).toHaveLength(0);
});
