import { test, expect } from "bun:test";
import { build } from "esbuild";
import { readFile, mkdtemp, writeFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { compile } from "svelte/compiler";
import { componentOptions } from "../src/compile-options.ts";
import { reanimatedStubs } from "./reanimated-stubs.ts";
import type { AnimLog } from "./reanimated-stubs.ts";
import { reactNativeConverters } from "./rn-reference.ts";

// Svelte's `in:`, `out:`, `transition:` and `animate:flip` on a host tag, through the real Fabric host with Reanimated's stand-ins: what reaches `element.animate`, how it is played
// (a shared value animated `withTiming`, a mapper that samples the keyframes), what the node looks like in each commit, and when Svelte is told the animation is over.
/** `family` is what the clones of one node share (React Native's shadow node family); `shown` is what the commit carries once Reanimated's registry was put over `props` (its commit hook). */
type FakeNode = { tag: number; name: string; props: Record<string, unknown>; children: FakeNode[]; sealed: boolean; target?: unknown; family: object; shown?: Record<string, unknown> };
let roots: Record<number, FakeNode[]> = {};
const calls: string[] = [];
const ROW = 50;
/** The scroll offset of a scroll view by tag: React Native moves what is inside a scroll view by it, and not the scroll view itself. */
const scrolled: Record<number, { x: number; y: number }> = {};
/** The layout of the committed tree: a node is as wide as 100 and as high as 50 and sits at its index among its siblings times 50; a node with `position: absolute` is out of the flow, at the top. */
function locate(target: FakeNode): { rect: number[]; path: FakeNode[] } | undefined {
  const search = (nodes: FakeNode[], path: FakeNode[]): { rect: number[]; path: FakeNode[] } | undefined => {
    let index = 0;
    for (const node of nodes) {
      const absolute = node.props.position === "absolute";
      if (node === target) return { rect: [0, absolute ? 0 : index * ROW, 100, ROW], path: [...path, node] };
      if (!absolute) index++;
      const found = search(node.children, [...path, node]);
      if (found) return found;
    }
    return undefined;
  };
  for (const root of Object.values(roots)) { const found = search(root, []); if (found) return found; }
  return undefined;
}
/**
 * The box of the last node of `path` with the committed transforms of the chain applied, from the node up: each one scales and moves everything in it about the centre of its own layout box (a
 * scroll view moves what is inside it by its scroll offset, and not itself).
 */
function transformed(path: FakeNode[], rect: number[]): number[] {
  let [x, y, width, height] = rect as [number, number, number, number];
  for (let at = path.length - 1; at >= 0; at--) {
    const node = path[at] as FakeNode;
    const own = locate(node)?.rect as [number, number, number, number];
    const centre = { x: own[0] + own[2] / 2, y: own[1] + own[3] / 2 };
    let sx = 1;
    let sy = 1;
    let tx = 0;
    let ty = 0;
    for (const entry of (node.props.transform as Record<string, number>[] | null | undefined) ?? []) {
      sx *= entry.scale ?? entry.scaleX ?? 1;
      sy *= entry.scale ?? entry.scaleY ?? 1;
      tx += entry.translateX ?? 0;
      ty += entry.translateY ?? 0;
    }
    x = centre.x + sx * (x - centre.x) + tx;
    y = centre.y + sy * (y - centre.y) + ty;
    width *= sx;
    height *= sy;
    if (at < path.length - 1 && scrolled[node.tag]) { x -= scrolled[node.tag]?.x ?? 0; y -= scrolled[node.tag]?.y ?? 0; }
  }
  return [x, y, width, height];
}
/** Whether the animation layer was loaded at each layout read the host made. */
const reads: boolean[] = [];
const fake = {
  createNode(tag: number, name: string, _root: number, props: Record<string, unknown>, target: unknown) { calls.push(`create ${name}`); return { tag, name, props: { ...props }, children: [], sealed: false, target, family: {} }; },
  cloneNodeWithNewChildren(node: FakeNode) { calls.push(`cloneChildren ${node.name}`); return { ...node, children: [], sealed: false }; },
  cloneNodeWithNewProps(node: FakeNode, props: Record<string, unknown>) { calls.push(`cloneProps ${node.name}`); return { ...node, props: { ...node.props, ...props }, children: [...node.children], sealed: false }; },
  cloneNodeWithNewChildrenAndProps(node: FakeNode, props: Record<string, unknown>) { calls.push(`cloneBoth ${node.name}`); return { ...node, props: { ...node.props, ...props }, children: [], sealed: false }; },
  appendChild(parent: FakeNode, child: FakeNode) { if (parent.sealed) throw new Error(`appendChild on sealed ${parent.name}`); parent.children.push(child); },
  createChildSet(root: number) { return { root, children: [] as FakeNode[] }; },
  appendChildToSet(set: { children: FakeNode[] }, child: FakeNode) { set.children.push(child); },
  completeRoot(root: number, set: { children: FakeNode[] }) {
    calls.push("completeRoot");
    const anim = (globalThis as { __anim?: AnimLog }).__anim;
    const registry = anim?.registry;
    // The commit hook: what Reanimated's registry holds for a tag is put over the props of every commit of it. Then the mount: a shadow node that was marked removable and is in no tree
    // lets the registry of its tag go.
    const seal = (n: FakeNode) => { n.sealed = true; n.shown = { ...n.props, ...registry?.get(n.tag) }; n.children.forEach(seal); };
    set.children.forEach(seal);
    roots[root] = set.children;
    const marked = anim?.marked ?? [];
    if (anim) anim.marked = [];
    for (const wrapper of marked as FakeNode[]) {
      const mounted = Object.values(roots).some((children) => find(children, wrapper.name, (n) => n.family === wrapper.family).length > 0);
      if (!mounted) registry?.delete(wrapper.tag);
    }
  },
  getBoundingClientRect(node: FakeNode, includeTransform: boolean) {
    calls.push(`rect ${node.tag} ${includeTransform}`);
    reads.push((globalThis as { __loaded?: () => boolean }).__loaded?.() ?? false);
    const found = locate(node);
    if (!found) return undefined;
    return includeTransform ? transformed(found.path, found.rect) : found.rect;
  },
  measure() {},
  measureInWindow() {},
  dispatchCommand() {},
  registerEventHandler() {},
};
(globalThis as { nativeFabricUIManager?: unknown }).nativeFabricUIManager = fake;
(globalThis as { __DEV__?: boolean }).__DEV__ = true;
const log = () => (globalThis as unknown as { __anim: AnimLog }).__anim;

const stubs: Record<string, string> = {
  ...reanimatedStubs,
  "react-native/Libraries/Utilities/Platform": "export default { OS: 'android', Version: 34 };",
  "react-native/Libraries/Image/resolveAssetSource": "export default () => null;",
  "react-native/Libraries/Components/View/ViewNativeComponent": "export {};",
  "react-native/Libraries/Text/TextNativeComponent": "export {};",
  "react-native/Libraries/Components/ScrollView/ScrollViewNativeComponent": "export {};",
  "expo-modules-core": "export const requireOptionalNativeModule = () => null;",
  "react-native": "export const AppRegistry = { registerRunnable() {} };",
};

type Animate = { node: unknown; keyframes: Record<string, unknown>[]; options: { duration?: number; delay?: number; fill?: string }; animation: Animation };
type Animation = { onfinish: (() => void) | null; effect: unknown; playState: string; currentTime: number | null; cancel(): void };
type NodeClass = { prototype: { animate(this: unknown, keyframes: unknown, options: unknown): Animation; getProp(key: string): unknown } };
type App = { setIntro(value: boolean): void; setOutro(value: boolean): void; setReversible(value: boolean): void; setBlurred(value: boolean): void; setItems(value: number[]): void; setRows(value: number[]): void; setSlid(value: boolean): void; setSliding(value: boolean): void; setDrawing(value: boolean): void; setDelayed(value: boolean): void; setLists(left: number[], right: number[]): void; setAnimated(value: boolean): void; setCss(value: boolean): void; setScrolling(value: number[]): void; seen(): string[] };
type Loaded = { startSurface(root: number, component: unknown, props: object): App; tick(): Promise<void>; fabricStats(): { animationLoaded: boolean }; Fixture: unknown; NativeNode: NodeClass };

async function load(): Promise<Loaded> {
  const bundle = await build({
    stdin: {
      contents: `import Fixture from './transitions-fixture.svelte';
        import { startSurface, fabricStats } from '../src/fabric/host.ts';
        import { NativeNode } from '../src/renderer.ts';
        import { tick } from 'svelte';
        export { startSurface, fabricStats, tick, Fixture, NativeNode };`,
      resolveDir: import.meta.dirname,
    },
    bundle: true, format: "esm", platform: "neutral", conditions: ["browser"], mainFields: ["main"], write: false,
    plugins: [...reactNativeConverters("android"), {
      name: "transitions-fixture",
      setup(builder) {
        builder.onResolve({ filter: /^(react-native|expo-modules-core)/ }, (args) => (args.path.startsWith("react-native-gesture-handler") ? undefined : { path: args.path, namespace: "stub" }));
        builder.onLoad({ filter: /.*/, namespace: "stub" }, (args) => ({ contents: stubs[args.path] ?? "export {};", loader: "js" }));
        builder.onResolve({ filter: /^@rasheed\/svelte-native\/renderer$/ }, () => ({ path: resolve(import.meta.dirname, "../src/renderer.ts") }));
        builder.onResolve({ filter: /^esm-env$/ }, () => ({ path: resolve(import.meta.dirname, "../src/environment.ts") }));
        builder.onLoad({ filter: /\.svelte$/ }, async ({ path }) => ({ contents: compile(await readFile(path, "utf8"), componentOptions(path)).js.code, loader: "js" }));
      },
    }],
  });
  const directory = await mkdtemp(resolve(tmpdir(), "svelte-native-transitions-"));
  const file = resolve(directory, "bundle.mjs");
  await writeFile(file, bundle.outputFiles[0]?.contents ?? "");
  const m = await import(pathToFileURL(file).href);
  await rm(directory, { recursive: true });
  return m;
}

const animates: Animate[] = [];
/** A fresh bundle, with a spy on `element.animate` that records what Svelte asked for and the animation it got. */
async function fresh(): Promise<Loaded> {
  delete (globalThis as { __anim?: unknown }).__anim;
  roots = {};
  calls.length = 0;
  reads.length = 0;
  animates.length = 0;
  const m = await load();
  (globalThis as { __loaded?: () => boolean }).__loaded = () => m.fabricStats().animationLoaded;
  const original = m.NativeNode.prototype.animate;
  m.NativeNode.prototype.animate = function (this: unknown, keyframes: unknown, options: unknown) {
    const animation = original.call(this, keyframes, options);
    animates.push({ node: this, keyframes: keyframes as Animate["keyframes"], options: options as Animate["options"], animation });
    return animation;
  };
  return m;
}
const find = (nodes: FakeNode[], name: string, accept: (node: FakeNode) => boolean = () => true): FakeNode[] => nodes.flatMap((n) => [...(n.name === name && accept(n) ? [n] : []), ...find(n.children, name, accept)]);
const byId = (root: number, id: string) => find(roots[root] ?? [], "RCTView").find((n) => n.props.testID === id) as FakeNode;
/** Lets every microtask that is queued, and the ones those queue, run. */
const realSetTimeout = globalThis.setTimeout;
const settle = async (m: Loaded) => { await m.tick(); await new Promise((done) => realSetTimeout(done, 0)); };
/** The animations of the shared values, except the 16 ms one the host plays on a node of no screen when it loads the animation layer (`warmUp`). */
const timings = () => (log().timings ?? []).filter((timing) => timing.config.duration !== 16);
const A = () => log();
/** The values the node's mapper writes at a progress (the test plays the UI thread: it moves the shared value, then runs the mapper's worklet). */
function drawn(mapper: AnimLog["mappers"][number], mutable?: { _value: unknown }, progress?: number): Record<string, unknown> {
  if (mutable && progress !== undefined) mutable._value = progress;
  const before = A().updates.length;
  mapper.worklet(true);
  return A().updates.slice(before).at(-1)?.values ?? {};
}
/** The mapper a node's restoring values wait for: it runs once on the UI thread and tells JavaScript (`scheduleOnRN`) that the values were written. */
const isAcknowledgement = (mapper: AnimLog["mappers"][number]) => String(mapper.worklet).includes("scheduleOnRN");
/** The mappers of nodes (their `animatedStyle` worklets) that are running. */
const live = () => A().mappers.filter((mapper) => !mapper.stopped && !isAcknowledgement(mapper));
/** One frame of the UI thread: every mapper runs, in the order it was started, and writes only when what its worklet returns differs from the last frame; those that wait for the restoring values to be written tell JavaScript. */
const frame = () => { for (const mapper of A().mappers.filter((entry) => !entry.stopped)) mapper.worklet(); };
/** The mapper that writes to the view of a node: the one that writes to the descriptor set the node's tag was added to. */
function mapperFor(tag: number): AnimLog["mappers"][number] {
  const id = A().descriptors.findLast((entry) => entry.adds.some((add) => add.tag === tag))?.id; // the latest: a node that stopped its worklet and got another has more than one
  for (const mapper of live()) {
    const before = A().updates.length;
    mapper.worklet(true);
    if ((A().updates.slice(before).at(-1)?.descriptors as { id: number } | undefined)?.id === id) return mapper;
  }
  throw new Error(`no live mapper writes to the node with tag ${tag}`);
}
/** What a node's commit carries once Reanimated's commit hook has put its registry over the props. */
const shown = (node: FakeNode) => node.shown ?? node.props;
/**
 * Timers and the clock under the test's control, for what a transition waits for with a timer: `advance(ms)` runs what is due, in order. Installed after the surface is up, because
 * everything else (`settle`) waits with the real ones.
 */
function fakeClock() {
  const original = { setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout, now: Date.now };
  let now = original.now();
  let next = 1;
  let timers: { id: number; at: number; run: () => void }[] = [];
  globalThis.setTimeout = ((run: () => void, ms = 0) => { const id = next++; timers.push({ id, at: now + Number(ms), run }); return id; }) as unknown as typeof setTimeout;
  globalThis.clearTimeout = ((id: number) => { timers = timers.filter((timer) => timer.id !== id); }) as typeof clearTimeout;
  Date.now = () => now;
  return {
    advance(ms: number) {
      const end = now + ms;
      for (;;) {
        const due = timers.filter((timer) => timer.at <= end).sort((a, b) => a.at - b.at)[0];
        if (!due) break;
        timers = timers.filter((timer) => timer !== due);
        now = Math.max(now, due.at);
        due.run();
      }
      now = end;
    },
    restore() { globalThis.setTimeout = original.setTimeout; globalThis.clearTimeout = original.clearTimeout; Date.now = original.now; },
  };
}
const idOf = (node: unknown) => (node as { getProp(key: string): unknown }).getProp("testID");
const animatesOf = (id: string) => animates.filter((entry) => idOf(entry.node) === id);
/** Reanimated forgets the registry of the tags it was handed a node of in no tree for: the ghosts that were marked, whose tag is the node's. */
const forgotten = (tag: number) => A().removable.filter((wrapper) => (wrapper as { tag?: number }).tag === tag);

test("in:fly plays when its element appears: first commit at the first keyframe, then a linear withTiming over its duration, sampled by a mapper", async () => {
  const m = await fresh();
  const app = m.startSurface(51, m.Fixture, {});
  expect(byId(51, "intro")).toBeUndefined();
  app.setIntro(true);
  await settle(m);

  // Svelte asked for a hold of the first keyframe (the delay, 0 ms here), then the 200 ms transition sampled every 1/60 s.
  const mine = animates.filter((entry) => (entry.node as { getProp(key: string): unknown }).getProp("testID") === "intro");
  expect(mine).toHaveLength(2);
  const [hold, main] = mine;
  expect(hold?.options).toEqual({ duration: 0, fill: "forwards" });
  expect(hold?.keyframes).toHaveLength(2);
  expect(hold?.keyframes[0]?.opacity).toBe("0");
  expect(main?.options).toEqual({ duration: 200, fill: "forwards" });
  expect(main?.keyframes).toHaveLength(Math.ceil(200 / (1000 / 60)) + 1);
  expect(main?.keyframes[0]?.transform).toBe("translate(0px, 20px)");
  expect(String(main?.keyframes.at(-1)?.transform)).toMatch(/^translate\(-?[\d.e-]+px, -?[\d.e-]+px\)$/);

  // The element never shows whole: its first commit already has the first keyframe, and its view cannot be flattened away.
  const node = byId(51, "intro");
  expect(node.props).toMatchObject({ testID: "intro", opacity: 0, collapsable: false });
  expect(node.props.transform).toEqual([{ translateX: 0 }, { translateY: 20 }]);
  expect("animatedStyle" in node.props).toBe(false);

  // One shared value, animated over 200 ms with a linear easing (the keyframes have the easing), and a callback that tells JavaScript it ended.
  expect(timings()).toHaveLength(1);
  const timing = timings()[0] as NonNullable<AnimLog["timings"]>[number];
  expect(timing.to).toBe(1);
  expect(timing.config.duration).toBe(200);
  expect((timing.config.easing as (t: number) => number)(0.3)).toBe(0.3);

  // The mapper (one per node, the worklet of `animatedStyle`) draws the keyframes at the progress: halfway, a transform of the middle of the list and an opacity of one half.
  const mapper = live().at(-1) as AnimLog["mappers"][number];
  expect(live()).toHaveLength(1);
  const half = drawn(mapper, timing.mutable as { _value: unknown }, 0.5); // fly's easing is cubic: halfway through the time, well past halfway through the way
  expect(half.opacity as number).toBeGreaterThan(0);
  expect(half.opacity as number).toBeLessThan(1);
  const translate = (half.transform as { translateY: number }[])[1]?.translateY as number;
  expect(translate).toBeGreaterThan(0);
  expect(translate).toBeLessThan(20);
  const end = drawn(mapper, timing.mutable as { _value: unknown }, 1);
  expect(end.opacity).toBeCloseTo(1, 5);
  expect((end.transform as { translateY: number }[])[1]?.translateY).toBeCloseTo(0, 5);
  expect(app.seen()).toEqual(["introstart"]);
});

test("onfinish is called when the shared value's animation ends, playState follows, and cancel() puts the node's own values back and never calls onfinish", async () => {
  const m = await fresh();
  const app = m.startSurface(52, m.Fixture, {});
  app.setIntro(true);
  await settle(m);
  const node = animates.find((entry) => (entry.node as { getProp(key: string): unknown }).getProp("testID") === "intro")?.node as { animate: (keyframes: unknown, options: unknown) => Animation };
  const before = timings().length;

  // A delay is part of the one run: the shared value goes from 0 to 1 over delay + duration, and the first keyframe is not drawn before the delay is over (no backwards fill).
  const anim = node.animate([{ opacity: "0.2" }, { opacity: "0.6" }, { opacity: "1" }], { delay: 100, duration: 300, fill: "forwards" });
  expect(anim.playState).toBe("running");
  expect(anim.currentTime).toBe(0);
  const timing = timings()[before] as NonNullable<AnimLog["timings"]>[number];
  expect(timing.config.duration).toBe(400);
  await settle(m);
  const mapper = live().at(-1) as AnimLog["mappers"][number];
  const mutable = timing.mutable as { _value: unknown };
  expect(drawn(mapper, mutable, 0.1).opacity).toBe(0); // the 100 ms of delay are 0.25 of 400: nothing of this animation yet, the earlier hold's keyframe is what draws
  expect(drawn(mapper, mutable, 0.625).opacity).toBeCloseTo(0.6, 5); // 0.625 of 400 ms is 250 ms: 150 ms into 300, halfway
  mutable._value = 0.5;
  expect(anim.currentTime).toBeCloseTo(200, 5); // read from the shared value, in ms of the animation (delay included)

  let finished = 0;
  anim.onfinish = () => { finished++; };
  mutable._value = 1;
  timing.callback?.(true);
  expect(finished).toBe(1);
  expect(anim.playState).toBe("finished");
  expect(anim.currentTime).toBe(400);
  expect(drawn(mapper).opacity).toBe(1); // the fill: the last keyframe stays

  // A second animation, cancelled before it ends: its callback (called with `false` by Reanimated) does nothing, and the node's own opacity is written back.
  const second = node.animate([{ opacity: "0" }, { opacity: "1" }], { duration: 500, fill: "forwards" });
  const secondTiming = timings().at(-1) as NonNullable<AnimLog["timings"]>[number];
  let called = 0;
  second.onfinish = () => { called++; };
  second.cancel();
  second.effect = null;
  expect(second.playState).toBe("idle");
  expect(second.currentTime).toBeNull();
  expect(secondTiming.cancelled).toBe(true);
  secondTiming.callback?.(false);
  secondTiming.callback?.(true); // even a late finish is ignored
  expect(called).toBe(0);
  await settle(m);
  const restore = live().at(-1) as AnimLog["mappers"][number];
  expect(drawn(restore).opacity).toBe(1); // the node has no opacity of its own: the default
  // The values stay in the node's worklet until the UI thread has written them, however long that takes (no timer): a mapper of its own tells JavaScript when it first runs.
  const clock = fakeClock();
  try { clock.advance(60_000); } finally { clock.restore(); }
  await settle(m);
  expect(live().includes(restore)).toBe(true);
  frame();
  await settle(m);
  expect(live().includes(restore)).toBe(false);
});

test("out:fade keeps its node until the animation finishes, then removes it", async () => {
  const m = await fresh();
  const app = m.startSurface(53, m.Fixture, {});
  expect(byId(53, "outro")).toBeDefined();
  app.setOutro(false);
  await settle(m);
  // The hold (no delay, no keyframes) finished by itself; the 100 ms fade is under way and the node is still there, at its own opacity of 0.8.
  const mine = animates.filter((entry) => (entry.node as { getProp(key: string): unknown }).getProp("testID") === "outro");
  expect(mine).toHaveLength(2);
  expect(mine[0]?.keyframes).toEqual([]);
  expect(mine[1]?.options).toEqual({ duration: 100, fill: "forwards" });
  expect(mine[1]?.keyframes[0]?.opacity).toBe("0.8");
  expect(mine[1]?.keyframes.at(-1)?.opacity).toBe("0");
  expect(byId(53, "outro")).toBeDefined();
  expect(byId(53, "outro").props.collapsable).toBe(false); // an outro's view must exist for the mapper to write to
  expect(timings()).toHaveLength(1);
  const timing = timings()[0] as NonNullable<AnimLog["timings"]>[number];
  const mapper = live().at(-1) as AnimLog["mappers"][number];
  expect(drawn(mapper, timing.mutable as { _value: unknown }, 0.5).opacity).toBeCloseTo(0.4, 1);

  await settle(m);
  expect(byId(53, "outro")).toBeDefined(); // the shared value has not reached 1
  (timing.mutable as { _value: unknown })._value = 1;
  timing.callback?.(true);
  await settle(m);
  expect(byId(53, "outro")).toBeUndefined();
  expect(mine[1]?.animation.playState).toBe("idle"); // Svelte cancels the animation of a node it removes
  expect(live()).toHaveLength(0); // the mapper went with the node
});

test("an intro turned around by an outro starts from the progress it had reached", async () => {
  const m = await fresh();
  const app = m.startSurface(54, m.Fixture, {});
  app.setReversible(true);
  await settle(m);
  const mine = () => animates.filter((entry) => (entry.node as { getProp(key: string): unknown }).getProp("testID") === "reversible");
  expect(mine()).toHaveLength(2);
  const intro = timings()[0] as NonNullable<AnimLog["timings"]>[number];
  expect(intro.config.duration).toBe(1000);
  // The intro is 40 % in (400 of 1000 ms) when the element is hidden again.
  (intro.mutable as { _value: unknown })._value = 0.4;
  app.setReversible(false);
  await settle(m);
  expect(byId(54, "reversible")).toBeDefined(); // still there: the outro is playing
  expect(intro.cancelled).toBe(true); // the intro was stopped where it was
  const outro = mine().at(-1) as Animate;
  expect(outro.options.duration).toBeCloseTo(400, 5); // 40 % of the transition is left to play, backwards
  expect(Number(outro.keyframes[0]?.opacity)).toBeCloseTo(0.4, 5); // fade is linear: it starts at 0.4 and goes to 0
  expect(Number(outro.keyframes.at(-1)?.opacity)).toBeCloseTo(0, 5);
  const second = timings().at(-1) as NonNullable<AnimLog["timings"]>[number];
  expect(second).not.toBe(intro);
  expect(second.config.duration).toBeCloseTo(400, 5);
  // The node did not jump: the mapper that draws the outro starts at the intro's value.
  const mapper = mapperFor(byId(54, "reversible").tag);
  expect(drawn(mapper, second.mutable as { _value: unknown }, 0).opacity).toBeCloseTo(0.4, 5);
});

test("animate:flip on a reordered keyed list animates each moved item from where it was, with transform keyframes made from getBoundingClientRect", async () => {
  const m = await fresh();
  const app = m.startSurface(55, m.Fixture, {});
  const tagOf = (id: string) => byId(55, id).tag;
  expect(byId(55, "item-1").tag).toBeLessThan(tagOf("item-3"));
  animates.length = 0;
  calls.length = 0;
  app.setItems([3, 1, 2]);
  await settle(m);
  // Item 3 was third (y = 100) and is first (y = 0); items 1 and 2 moved down one row.
  const moved = (id: string) => animates.filter((entry) => (entry.node as { getProp(key: string): unknown }).getProp("testID") === id);
  expect(moved("item-3")).toHaveLength(2); // a hold, then the move
  const flip3 = moved("item-3")[1] as Animate;
  expect(flip3.options.duration).toBe(300); // the fixture's {duration: 300}
  expect(flip3.keyframes[0]?.transform).toBe("translate(0px, 100px) scale(1, 1)");
  expect(String(flip3.keyframes.at(-1)?.transform)).toMatch(/^translate\(-?[\d.e-]+px, -?[\d.e-]+px\) scale\(1, 1\)$/);
  const flip1 = moved("item-1")[1] as Animate;
  expect(flip1.keyframes[0]?.transform).toBe("translate(0px, -50px) scale(1, 1)");
  expect(moved("item-2")[1]?.keyframes[0]?.transform).toBe("translate(0px, -50px) scale(1, 1)");
  expect(calls.filter((call) => call.startsWith("rect "))).not.toHaveLength(0);
  // The first layout read commits the new order; the next commit starts every moved item's animation at once. A layout read does not commit what only
  // paints, or the list would mount an item at a time: a frame of the new order with some items still in their old places.
  const commits = calls.flatMap((call, at) => (call === "completeRoot" ? [at] : []));
  const started = calls.slice((commits[0] as number) + 1, commits[1]);
  expect(started.filter((call) => call.startsWith("cloneProps"))).toHaveLength(3);

  // On the UI thread the node moves by the transform list: translate, then scale.
  const node = byId(55, "item-3");
  expect(node.props.collapsable).toBe(false);
  const progress = (flip3.animation as unknown as { progress: { _value: number } }).progress;
  const mapper = mapperFor(node.tag);
  expect(drawn(mapper, progress, 0).transform).toEqual([{ translateX: 0 }, { translateY: 100 }, { scaleX: 1 }, { scaleY: 1 }]);
  const mid = (drawn(mapper, progress, 0.5).transform as { translateY: number }[])[1]?.translateY as number;
  expect(mid).toBeGreaterThan(0);
  expect(mid).toBeLessThan(100);
  expect((drawn(mapper, progress, 1).transform as { translateY: number }[])[1]?.translateY).toBeCloseTo(0, 5);
});

test("transition:blur plays its opacity and leaves the filter out with one warning", async () => {
  const warnings: string[] = [];
  const original = console.warn;
  console.warn = (...args: unknown[]) => { warnings.push(args.join(" ")); };
  try {
    const m = await fresh();
    const app = m.startSurface(56, m.Fixture, {});
    app.setBlurred(true);
    await settle(m);
    expect(byId(56, "blurred").props.opacity).toBe(0);
    expect("filter" in byId(56, "blurred").props).toBe(false);
    expect(warnings.filter((warning) => warning.includes("filter"))).toHaveLength(1);
    app.setBlurred(false);
    app.setBlurred(true);
    await settle(m);
    expect(warnings.filter((warning) => warning.includes("filter"))).toHaveLength(1); // once
  } finally {
    console.warn = original;
  }
});

test("an interrupted flip starts from where the item is drawn: the layout box plus what the running animation moves it by", async () => {
  const m = await fresh();
  const app = m.startSurface(57, m.Fixture, {});
  app.setItems([3, 1, 2]);
  await settle(m);
  const first = animates.filter((entry) => (entry.node as { getProp(key: string): unknown }).getProp("testID") === "item-3").at(-1) as Animate;
  expect(first.keyframes[0]?.transform).toBe("translate(0px, 100px) scale(1, 1)");
  // Halfway through the time of its animation (frame 9 of 18), flip's ease has taken 87.5 % of the way: 12.5 px of the 100 are left.
  (first.animation as unknown as { progress: { _value: number } }).progress._value = 0.5;
  animates.length = 0;
  calls.length = 0;
  app.setItems([1, 2, 3]);
  await settle(m);
  const second = animates.filter((entry) => (entry.node as { getProp(key: string): unknown }).getProp("testID") === "item-3").at(-1) as Animate;
  // It was measured at y = 0 (its place in the committed tree, where the transform is not) plus the 12.5 the animation draws it at, and goes to y = 100.
  expect(second.keyframes[0]?.transform).toBe("translate(0px, -87.5px) scale(1, 1)");
  expect(first.animation.playState).toBe("idle"); // aborted by the new one
  expect(calls).toContain(`rect ${byId(57, "item-3").tag} false`); // with a transform animating it, the box is asked for without the committed transform
});

test("a leaving item is taken out of the flow and held where it was (node.style), the others move up, and it is removed when its outro ends", async () => {
  const m = await fresh();
  const app = m.startSurface(58, m.Fixture, {});
  const tag = byId(58, "row-2").tag;
  app.setRows([1, 3]);
  await settle(m);
  const leaving = byId(58, "row-2");
  expect(leaving.tag).toBe(tag);
  // Svelte's `fix()`: absolute, the size it had, and translated back to y = 50 (it sits at the top once it is out of the flow).
  expect(leaving.props).toMatchObject({ position: "absolute", width: 100, height: 50, collapsable: false });
  expect(leaving.props.transform).toEqual([{ translateX: 0 }, { translateY: 50 }]);
  // The item below it moves up with flip: from y = 100 to y = 50.
  const moved = animates.filter((entry) => (entry.node as { getProp(key: string): unknown }).getProp("testID") === "row-3").at(-1) as Animate;
  expect(moved.keyframes[0]?.transform).toBe("translate(0px, 50px) scale(1, 1)");
  // Its outro plays; when the shared value arrives the node goes.
  const outro = timings().find((timing) => timing.config.duration === 100) as NonNullable<AnimLog["timings"]>[number];
  (outro.mutable as { _value: unknown })._value = 1;
  outro.callback?.(true);
  await settle(m);
  expect(byId(58, "row-2")).toBeUndefined();
});

test("transition:slide reads the node's layout (the host commits what is pending first), animates its height, and clips it for the length of the transition", async () => {
  const m = await fresh();
  const app = m.startSurface(59, m.Fixture, {});
  app.setSlid(true);
  await settle(m);
  const mine = animates.filter((entry) => (entry.node as { getProp(key: string): unknown }).getProp("testID") === "slid");
  const main = mine.at(-1) as Animate;
  // The height came from the layout read (50), the padding from the node's own style (4).
  expect(main.keyframes[0]).toMatchObject({ height: "0px", paddingTop: "0px", paddingBottom: "0px", overflow: "hidden" });
  expect(main.keyframes.at(-1)).toMatchObject({ height: "50px", paddingTop: "4px", paddingBottom: "4px" });
  expect(calls.some((call) => call.startsWith("rect "))).toBe(true);
  // `overflow: hidden` is what Svelte wrote to element.style, and the node applies it while the transition runs; it is not one of the animated values.
  const node = byId(59, "slid");
  expect(node.props.overflow).toBe("hidden");
  const timing = timings().at(-1) as NonNullable<AnimLog["timings"]>[number];
  const mapper = mapperFor(node.tag);
  const half = drawn(mapper, timing.mutable as { _value: unknown }, 0.5);
  expect("overflow" in half).toBe(false);
  expect(half.height as number).toBeGreaterThan(0);
  expect(half.height as number).toBeLessThan(50);
  expect(half.minHeight).toBe(0);
  // At the end the intro is cancelled: the clip is taken off, and the node's own values are written back (a height it did not have is released).
  (timing.mutable as { _value: unknown })._value = 1;
  timing.callback?.(true);
  await settle(m);
  expect(byId(59, "slid").props.overflow).toBeNull(); // the prop is reset
  // Every key the animation wrote goes back to the node's own, not the lengths alone, or is reset (`null`: Reanimated drops an `undefined`, and the registry would keep the animation's last value).
  const restoring = drawn(mapperFor(node.tag));
  expect(restoring).toEqual({
    opacity: 1, height: null, minHeight: null,
    paddingTop: null, paddingBottom: null, marginTop: null, marginBottom: null, borderTopWidth: null, borderBottomWidth: null,
  });
  expect(Object.values(restoring).includes(undefined)).toBe(false);
});

type Measured = { getBoundingClientRect(): { left: number; top: number; width: number; height: number }; clientWidth: number; clientHeight: number; animate(keyframes: unknown, options: unknown): Animation; getAnimations(): Animation[] };
const measured = (root: number, id: string) => byId(root, id).target as Measured;
const box = (target: Measured) => { const rect = target.getBoundingClientRect(); return [rect.left, rect.top, rect.width, rect.height]; };

test("when the UI thread has written a node's own values back, its committed props are its own and Reanimated forgets what it wrote, and not before", async () => {
  const m = await fresh();
  const app = m.startSurface(60, m.Fixture, {});
  app.setIntro(true);
  await settle(m);
  const node = byId(60, "intro");
  expect(node.props.opacity).toBe(0); // the first frame, while it plays
  const timing = timings()[0] as NonNullable<AnimLog["timings"]>[number];
  (timing.mutable as { _value: unknown })._value = 1;
  timing.callback?.(true); // the intro ends; Svelte takes its effect off
  await settle(m);
  // The node's worklet writes the node's own values until the UI thread has: Reanimated's registry still has the animation's last frame, which the next commit would be overruled by.
  expect(live()).toHaveLength(1);
  expect(forgotten(node.tag)).toHaveLength(0);
  frame();
  await settle(m);
  const own = byId(60, "intro");
  // The commit that takes the worklet away does not carry the animation's first frame again (opacity 0, a transform): it is gone from the node's props.
  expect(own.props.opacity ?? null).toBeNull();
  expect(own.props.transform ?? null).toBeNull();
  expect(own.props.collapsable ?? null).toBeNull();
  expect(live()).toHaveLength(0);
  // Reanimated is handed a shadow node with the node's tag that is in no tree, marked removable: it forgets the tag's registry when the next mount shows it is not there.
  expect(forgotten(own.tag)).toHaveLength(1);
  expect(forgotten(own.tag)[0]).not.toBe(own);
  // The ghost carries no props: a prop that makes it a node of another kind makes React Native delete the live view of the tag when the ghost is collected.
  expect((forgotten(own.tag)[0] as FakeNode).props).toEqual({});
  expect(A().registry?.get(own.tag)).toBeUndefined(); // and the mount that followed has let the registry of the tag go
  expect(calls.filter((call) => call === "create RCTView").length).toBeGreaterThan(0);
});

test("the registry is not forgotten while another animation of the node plays", async () => {
  const m = await fresh();
  const app = m.startSurface(61, m.Fixture, {});
  await settle(m);
  const inner = measured(61, "inner");
  const tag = byId(61, "inner").tag;
  const first = inner.animate([{ opacity: "0.5" }, { opacity: "0.5" }], { duration: 1000, fill: "forwards" });
  const second = inner.animate([{ opacity: "0.25" }, { opacity: "0.25" }], { duration: 1000, fill: "forwards" });
  await settle(m);
  first.cancel();
  await settle(m);
  frame();
  await settle(m);
  expect(forgotten(tag)).toHaveLength(0); // the second still draws the node
  second.cancel();
  await settle(m);
  frame();
  await settle(m);
  expect(forgotten(tag)).toHaveLength(1);
  void app;
});

test("an out:slide shown again mid-way releases every length it wrote, and the node is its own after", async () => {
  const m = await fresh();
  const app = m.startSurface(62, m.Fixture, {});
  app.setSliding(true);
  await settle(m);
  const tag = byId(62, "sliding").tag;
  app.setSliding(false);
  await settle(m);
  const outro = timings().at(-1) as NonNullable<AnimLog["timings"]>[number];
  expect(outro.config.duration).toBe(100);
  const half = drawn(mapperFor(tag), outro.mutable as { _value: unknown }, 0.5);
  // Padding, margin and border widths are mid-way, as the height is.
  for (const key of ["paddingTop", "marginTop", "borderTopWidth"]) { expect(half[key] as number, key).toBeGreaterThan(0); }
  expect(half.paddingTop as number).toBeLessThan(4);
  expect(half.height as number).toBeGreaterThan(0);
  app.setSliding(true); // shown again before the outro ended: Svelte takes the outro's effect off
  await settle(m);
  expect(outro.cancelled).toBe(true);
  expect(byId(62, "sliding")).toBeDefined();
  expect(drawn(mapperFor(tag))).toEqual({
    opacity: 1, height: null, minHeight: null, paddingTop: null, paddingBottom: null, marginTop: null, marginBottom: null, borderTopWidth: null, borderBottomWidth: null,
  });
  frame();
  await settle(m);
  const own = byId(62, "sliding");
  // What Reanimated's registry puts over the commit that takes the worklet away is the node's own too: the half-way height it had written is reset in the registry, not left in it.
  for (const key of ["height", "paddingTop", "marginTop", "borderTopWidth"]) expect(shown(own)[key] ?? null, key).toBeNull();
  // (`overflow: hidden` stays: Svelte takes it off only when an intro ends, on the web as here.)
  for (const key of ["height", "paddingTop", "marginTop", "borderTopWidth"]) expect(own.props[key] ?? null, key).toBeNull();
  expect(live()).toHaveLength(0);
});

test("transition:draw degrades on a native element: no path to measure, no throw, the stroke is left out with a warning, and the transition still ends", async () => {
  let clock: ReturnType<typeof fakeClock> | undefined;
  const warnings: string[] = [];
  const original = console.warn;
  console.warn = (...args: unknown[]) => { warnings.push(args.join(" ")); };
  try {
    const m = await fresh();
    const app = m.startSurface(63, m.Fixture, {});
    clock = fakeClock();
    app.setDrawing(true);
    await settle(m);
    expect(byId(63, "drawing")).toBeDefined();
    const main = animatesOf("drawing").at(-1) as Animate;
    expect(main.options.duration).toBe(100);
    expect(Object.keys(main.keyframes[0] as object).sort()).toEqual(["strokeDasharray", "strokeDashoffset"]);
    expect(warnings.filter((warning) => warning.includes("strokeDasharray"))).toHaveLength(1);
    expect(warnings.filter((warning) => warning.includes("strokeDashoffset"))).toHaveLength(1);
    expect(timings()).toHaveLength(0); // nothing to draw, so a timer and no shared value
    clock.advance(160);
    await settle(m);
    expect(main.animation.playState).toBe("idle"); // it ended by itself, and Svelte took its effect off
  } finally {
    clock?.restore();
    console.warn = original;
  }
});

test("an intro with a delay holds its first keyframe for the delay (a timer, no shared value), then plays", async () => {
  const m = await fresh();
  const app = m.startSurface(64, m.Fixture, {});
  const clock = fakeClock();
  try {
    app.setDelayed(true);
    await settle(m);
    const node = byId(64, "delayed");
    expect(node.props).toMatchObject({ opacity: 0, collapsable: false });
    expect(node.props.transform).toEqual([{ translateX: 0 }, { translateY: 20 }]);
    const held = animatesOf("delayed");
    expect(held).toHaveLength(1);
    expect(held[0]?.options).toEqual({ duration: 120, fill: "forwards" });
    expect(timings()).toHaveLength(0);
    expect(held[0]?.animation.playState).toBe("running");
    clock.advance(119);
    await settle(m);
    expect(animatesOf("delayed")).toHaveLength(1); // the delay is not over
    clock.advance(1);
    await settle(m);
    expect(held[0]?.animation.playState).toBe("idle"); // the hold was taken off when the transition started
  } finally {
    clock.restore();
  }
  expect(animatesOf("delayed")).toHaveLength(2);
  expect(animatesOf("delayed")[1]?.options.duration).toBe(100);
  expect(timings()).toHaveLength(1);
  expect(timings()[0]?.config.duration).toBe(100);
});

test("crossfade sends an item to the other list and receives it there (about the top left) while flip moves what stays", async () => {
  const m = await fresh();
  const app = m.startSurface(65, m.Fixture, {});
  animates.length = 0;
  app.setLists([1, 3], [2]); // item 2 leaves the first list (y = 50) for the second (y = 0); item 3 moves up (100 to 50)
  await settle(m);
  const sent = animatesOf("left-2").at(-1) as Animate;
  const received = animatesOf("right-2").at(-1) as Animate;
  expect(sent.keyframes[0]).toMatchObject({ transformOrigin: "top left" });
  expect(received.keyframes[0]).toMatchObject({ transformOrigin: "top left" });
  // From the other end's box: the received one starts 50 below where it is (in the first list, at y = 50), the sent one ends 50 above where it was.
  expect(String(received.keyframes[0]?.transform)).toContain("translate(0px,50px)");
  expect(String(sent.keyframes.at(-1)?.transform)).toContain("translate(0px,-50px)");
  expect(received.options.duration).toBe(200);
  const flipped = animatesOf("left-3").at(-1) as Animate;
  expect(flipped.keyframes[0]?.transform).toBe("translate(0px, 50px) scale(1, 1)");
  // The origin is a track too: the mapper writes it with the transform.
  const progress = (received.animation as unknown as { progress: { _value: number } }).progress;
  const writes = drawn(mapperFor(byId(65, "right-2").tag), progress, 0);
  expect(writes.transformOrigin).toBe("top left");
  expect((writes.transform as { translateY: number }[]).some((entry) => entry.translateY === 50)).toBe(true);
});

test("an animation whose fill does not hold its last keyframe leaves no effect when it ends, and the node's own values are written back", async () => {
  const m = await fresh();
  const app = m.startSurface(66, m.Fixture, {});
  await settle(m);
  const inner = measured(66, "inner");
  const tag = byId(66, "inner").tag;
  const none = inner.animate([{ opacity: "0.2" }, { opacity: "0.6" }], { duration: 100, fill: "none" });
  await settle(m);
  const timing = timings().at(-1) as NonNullable<AnimLog["timings"]>[number];
  expect(inner.getAnimations()).toContain(none);
  (timing.mutable as { _value: unknown })._value = 1;
  timing.callback?.(true);
  expect(none.playState).toBe("finished");
  expect(inner.getAnimations()).not.toContain(none);
  await settle(m);
  expect(drawn(mapperFor(tag)).opacity).toBe(1); // not the 0.6 it ended at
  void app;
});

test("an animation Reanimated cannot start ends at once, with one warning, so that an outro still ends", async () => {
  const warnings: string[] = [];
  const original = console.warn;
  console.warn = (...args: unknown[]) => { warnings.push(args.join(" ")); };
  try {
    const m = await fresh();
    const app = m.startSurface(67, m.Fixture, {});
    await settle(m);
    const inner = measured(67, "inner");
    inner.animate([{ opacity: "0" }, { opacity: "1" }], { duration: 100, fill: "forwards" }); // loads the layer
    await settle(m);
    let finished = 0;
    A().failMutable = true; // a shared value cannot be made now
    const broken = inner.animate([{ opacity: "0" }, { opacity: "1" }], { duration: 100, fill: "forwards" });
    broken.onfinish = () => { finished++; };
    inner.animate([{ opacity: "0" }, { opacity: "1" }], { duration: 100, fill: "forwards" });
    A().failMutable = false;
    await settle(m);
    expect(finished).toBe(1);
    expect(inner.getAnimations()).not.toContain(broken);
    expect(warnings.filter((warning) => warning.includes("could not be started"))).toHaveLength(1);
    void app;
  } finally {
    console.warn = original;
  }
});

test("the first layout read loads the animation layer before the tree it measures changes, not at the first animation", async () => {
  const m = await fresh();
  const app = m.startSurface(68, m.Fixture, {});
  expect(m.fabricStats().animationLoaded).toBe(false);
  expect(reads).toEqual([]);
  app.setItems([3, 1, 2]);
  await settle(m);
  expect(reads.length).toBeGreaterThan(0);
  expect(reads[0]).toBe(true); // already loaded when the first box was read, before the reorder was committed
});

test("getBoundingClientRect counts the ancestors' transforms and the node's own once (the animation's when one draws, the style's otherwise); clientWidth ignores transforms", async () => {
  const m = await fresh();
  const app = m.startSurface(69, m.Fixture, {});
  await settle(m);
  const inner = measured(69, "inner");
  // The committed tree: the parent is moved 10 down, the node 3 to the right.
  expect(box(inner)).toEqual([3, 10, 100, 50]);
  expect([inner.clientWidth, inner.clientHeight]).toEqual([100, 50]);
  // An animation draws the node: its transform replaces the style's, once (the commit has its first frame, the box is not asked to count it again).
  const move = inner.animate([{ transform: "translate(0px, 20px)" }, { transform: "translate(0px, 20px)" }], { duration: 1000, fill: "forwards" });
  await settle(m);
  expect(box(inner)).toEqual([0, 30, 100, 50]);
  move.cancel();
  // A scale about the top left keeps the corner; about the centre (no origin) it moves it.
  const corner = inner.animate([{ transform: "scale(0.5)", transformOrigin: "top left" }, { transform: "scale(0.5)", transformOrigin: "top left" }], { duration: 1000, fill: "forwards" });
  await settle(m);
  expect(box(inner)).toEqual([0, 10, 50, 25]);
  expect([inner.clientWidth, inner.clientHeight]).toEqual([100, 50]);
  corner.cancel();
  const centre = inner.animate([{ transform: "scale(0.5)" }, { transform: "scale(0.5)" }], { duration: 1000, fill: "forwards" });
  await settle(m);
  expect(box(inner)).toEqual([25, 22.5, 50, 25]);
  centre.cancel();
  void app;
});

test("an element with an animatedStyle of its own stays whole after its in:fade: the commit that ends the transition carries the node's own first frame, and the registry is left to the node", async () => {
  const m = await fresh();
  const app = m.startSurface(70, m.Fixture, {});
  app.setAnimated(true);
  await settle(m);
  const tag = byId(70, "animated").tag;
  expect(byId(70, "animated").props.opacity).toBe(0); // the transition's first frame, over the node's own 0.5
  const timing = timings()[0] as NonNullable<AnimLog["timings"]>[number];
  (timing.mutable as { _value: unknown })._value = 1;
  timing.callback?.(true);
  await settle(m);
  frame(); // the UI thread writes the node's own values back and tells JavaScript
  await settle(m);
  frame(); // the node's own worklet is the only one now
  await settle(m);
  const own = byId(70, "animated");
  // The runtime was made for the first frame of the transition; it commits the first frame of the worklets the node has now.
  expect(own.props.opacity).toBe(0.5);
  expect(shown(own).opacity).toBe(0.5);
  expect(A().registry?.get(tag)?.opacity).toBe(0.5);
  // Forgetting the tag would take the node's own values out of the registry with the transition's.
  expect(forgotten(tag)).toHaveLength(0);
  expect(live()).toHaveLength(1);
});

test("a node with Reanimated CSS keys keeps the registry when its outro is cancelled: the entries of its CSS animations are not the transition's to forget", async () => {
  const m = await fresh();
  const app = m.startSurface(71, m.Fixture, {});
  app.setCss(true);
  await settle(m);
  const tag = byId(71, "css").tag;
  app.setCss(false);
  await settle(m);
  app.setCss(true); // shown again before its outro ended
  await settle(m);
  frame();
  await settle(m);
  expect(byId(71, "css")).toBeDefined();
  expect(live()).toHaveLength(0); // the node's own values were acknowledged: the worklet went
  expect(forgotten(tag)).toHaveLength(0);
});

test("a reorder while a flip runs commits the new flip's first frame, not the first frame of the flip before it", async () => {
  const m = await fresh();
  const app = m.startSurface(72, m.Fixture, {});
  app.setItems([3, 1, 2]);
  await settle(m);
  const first = animatesOf("item-3").at(-1) as Animate;
  expect(first.keyframes[0]?.transform).toBe("translate(0px, 100px) scale(1, 1)");
  expect(byId(72, "item-3").props.transform).toEqual([{ translateX: 0 }, { translateY: 100 }, { scaleX: 1 }, { scaleY: 1 }]);
  (first.animation as unknown as { progress: { _value: number } }).progress._value = 0.5;
  app.setItems([1, 2, 3]);
  await settle(m);
  const second = animatesOf("item-3").at(-1) as Animate;
  expect(second.keyframes[0]?.transform).toBe("translate(0px, -87.5px) scale(1, 1)");
  expect(byId(72, "item-3").props.transform).toEqual([{ translateX: 0 }, { translateY: -87.5 }, { scaleX: 1 }, { scaleY: 1 }]);
});

test("the registry is let go once: it is not emptied again 400 ms later, when another animation of the node may be using it", async () => {
  const m = await fresh();
  const app = m.startSurface(73, m.Fixture, {});
  await settle(m);
  const inner = measured(73, "inner");
  const tag = byId(73, "inner").tag;
  const clock = fakeClock();
  try {
    inner.animate([{ opacity: "0.5" }, { opacity: "0.5" }], { duration: 1000, fill: "forwards" }).cancel();
    await settle(m);
    frame();
    await settle(m);
    expect(forgotten(tag)).toHaveLength(1);
    // Another animation of the node writes to the registry; a commit (a mount) comes after the 400 ms the node was marked again at.
    inner.animate([{ opacity: "0.25" }, { opacity: "0.75" }], { duration: 1000, fill: "forwards" });
    await settle(m);
    drawn(mapperFor(tag), (timings().at(-1) as NonNullable<AnimLog["timings"]>[number]).mutable as { _value: unknown }, 0);
    expect(A().registry?.get(tag)?.opacity).toBe(0.25);
    clock.advance(500);
    app.setIntro(true);
    await settle(m);
    expect(forgotten(tag)).toHaveLength(1);
    expect(A().registry?.get(tag)?.opacity).toBe(0.25);
  } finally {
    clock.restore();
  }
});

test("an app without Reanimated measures with no warning, and is told once that an animation cannot be played", async () => {
  const warnings: string[] = [];
  const original = console.warn;
  console.warn = (...args: unknown[]) => { warnings.push(args.join(" ")); };
  try {
    const m = await fresh();
    (globalThis as { __anim?: unknown }).__anim = { descriptors: [], mappers: [], updates: [], css: [], removable: [], failLoad: true };
    const app = m.startSurface(74, m.Fixture, {});
    await settle(m);
    const inner = measured(74, "inner");
    expect(box(inner)).toEqual([3, 10, 100, 50]); // a plain measure
    expect(inner.getAnimations()).toEqual([]);
    expect(warnings.filter((warning) => warning.includes("Svelte transitions"))).toHaveLength(0);
    let finished = 0;
    const first = inner.animate([{ opacity: "0" }, { opacity: "1" }], { duration: 100, fill: "forwards" });
    first.onfinish = () => { finished++; };
    inner.animate([{ opacity: "0" }, { opacity: "1" }], { duration: 100, fill: "forwards" });
    await settle(m);
    expect(finished).toBe(1); // it ends at once, so that an outro still ends
    expect(warnings.filter((warning) => warning.includes("react-native-reanimated did not load"))).toHaveLength(1);
    void app;
  } finally {
    console.warn = original;
  }
});

test("the ancestors' transforms take a child where it is drawn, scale included, and a scroll view's offset moves its direct children", async () => {
  const m = await fresh();
  const app = m.startSurface(75, m.Fixture, {});
  await settle(m);
  // A scaled parent: the child is drawn twice as large, about the parent's centre.
  const scaledInner = byId(75, "scaled-inner");
  expect(box(measured(75, "scaled-inner"))).toEqual(fake.getBoundingClientRect(scaledInner, true));
  expect(box(measured(75, "scaled-inner"))[2]).toBe(200);
  // A scrolled scroll view: React Native moves what is inside it by the offset, and not the scroll view itself.
  const scroller = find(roots[75] ?? [], "RCTScrollView")[0] as FakeNode;
  scrolled[scroller.tag] = { x: 0, y: 30 };
  expect(box(measured(75, "scroll-2"))).toEqual([0, 50 - 30, 100, 50]);
  delete scrolled[scroller.tag];
  void app;
});

test("a list of items under one parent reads the parent's transforms once for the task, not once for each item", async () => {
  const m = await fresh();
  const app = m.startSurface(76, m.Fixture, {});
  await settle(m);
  const parent = find(roots[76] ?? [], "RCTView").find((node) => node.props.testID === "list") as FakeNode;
  calls.length = 0;
  app.setItems([3, 1, 2]);
  await settle(m);
  // One pair of reads before the reorder (the items' old boxes) and one after (the new ones), not three pairs of each.
  expect(calls.filter((call) => call === `rect ${parent.tag} true`).length).toBeLessThanOrEqual(2);
  expect(calls.filter((call) => call === `rect ${parent.tag} false`).length).toBeLessThanOrEqual(2);
});

test("animations that start one another are committed together: the commit that follows the holds of a list has the first frame of every item's move, not of the first one's", async () => {
  const m = await fresh();
  const app = m.startSurface(77, m.Fixture, {});
  await settle(m);
  const first = measured(77, "inner");
  const second = measured(77, "scaled-inner");
  calls.length = 0;
  // Svelte's `animate:` plays a hold of no length for each item, and the item's move starts in the hold's `onfinish`, a microtask later. A commit queued by the first hold's change must not come
  // between the first move and the second: the second item would be committed, in its new place, without its first frame, and drawn so until the next commit.
  for (const node of [first, second]) {
    const hold = node.animate([{ opacity: "0.5" }, { opacity: "0.5" }], { duration: 0, fill: "forwards" });
    hold.onfinish = () => { node.animate([{ opacity: "0.25" }, { opacity: "0.75" }], { duration: 100, fill: "forwards" }); };
  }
  await settle(m);
  expect(calls.filter((call) => call === "completeRoot")).toHaveLength(1);
  expect(byId(77, "inner").props.opacity).toBe(0.25);
  expect(byId(77, "scaled-inner").props.opacity).toBe(0.25);
  void app;
});
