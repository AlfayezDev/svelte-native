import { afterEach, test, expect } from "bun:test";
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
type FakeNode = { tag: number; name: string; props: Record<string, unknown>; children: FakeNode[]; sealed: boolean; target?: unknown };
let roots: Record<number, FakeNode[]> = {};
const calls: string[] = [];
const ROW = 50;
/** The layout of the committed tree: a node is as wide as 100 and as high as 50 and sits at its index among its siblings times 50; a node with `position: absolute` is out of the flow, at the top. */
function rectOf(target: FakeNode): number[] | undefined {
  const search = (nodes: FakeNode[]): number[] | undefined => {
    let index = 0;
    for (const node of nodes) {
      const absolute = node.props.position === "absolute";
      if (node === target) return [0, absolute ? 0 : index * ROW, 100, ROW];
      if (!absolute) index++;
      const found = search(node.children);
      if (found) return found;
    }
    return undefined;
  };
  for (const root of Object.values(roots)) { const found = search(root); if (found) return found; }
  return undefined;
}
const fake = {
  createNode(tag: number, name: string, _root: number, props: Record<string, unknown>, target: unknown) { calls.push(`create ${name}`); return { tag, name, props: { ...props }, children: [], sealed: false, target }; },
  cloneNodeWithNewChildren(node: FakeNode) { calls.push(`cloneChildren ${node.name}`); return { ...node, children: [], sealed: false }; },
  cloneNodeWithNewProps(node: FakeNode, props: Record<string, unknown>) { calls.push(`cloneProps ${node.name}`); return { ...node, props: { ...node.props, ...props }, children: [...node.children], sealed: false }; },
  cloneNodeWithNewChildrenAndProps(node: FakeNode, props: Record<string, unknown>) { calls.push(`cloneBoth ${node.name}`); return { ...node, props: { ...node.props, ...props }, children: [], sealed: false }; },
  appendChild(parent: FakeNode, child: FakeNode) { if (parent.sealed) throw new Error(`appendChild on sealed ${parent.name}`); parent.children.push(child); },
  createChildSet(root: number) { return { root, children: [] as FakeNode[] }; },
  appendChildToSet(set: { children: FakeNode[] }, child: FakeNode) { set.children.push(child); },
  completeRoot(root: number, set: { children: FakeNode[] }) {
    calls.push("completeRoot");
    const seal = (n: FakeNode) => { n.sealed = true; n.children.forEach(seal); };
    set.children.forEach(seal);
    roots[root] = set.children;
  },
  getBoundingClientRect(node: FakeNode, includeTransform: boolean) { calls.push(`rect ${node.tag} ${includeTransform}`); return rectOf(node); },
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
type App = { setIntro(value: boolean): void; setOutro(value: boolean): void; setReversible(value: boolean): void; setBlurred(value: boolean): void; setItems(value: number[]): void; setRows(value: number[]): void; setSlid(value: boolean): void; seen(): string[] };
type Loaded = { startSurface(root: number, component: unknown, props: object): App; tick(): Promise<void>; Fixture: unknown; NativeNode: NodeClass };

async function load(): Promise<Loaded> {
  const bundle = await build({
    stdin: {
      contents: `import Fixture from './transitions-fixture.svelte';
        import { startSurface } from '../src/fabric/host.ts';
        import { NativeNode } from '../src/renderer.ts';
        import { tick } from 'svelte';
        export { startSurface, tick, Fixture, NativeNode };`,
      resolveDir: import.meta.dirname,
    },
    bundle: true, format: "esm", platform: "neutral", conditions: ["browser"], mainFields: ["main"], write: false,
    plugins: [...reactNativeConverters("android"), {
      name: "transitions-fixture",
      setup(builder) {
        builder.onResolve({ filter: /^(react-native|expo-modules-core)/ }, (args) => (args.path.startsWith("react-native-gesture-handler") ? undefined : { path: args.path, namespace: "stub" }));
        builder.onLoad({ filter: /.*/, namespace: "stub" }, (args) => ({ contents: stubs[args.path] ?? "export {};", loader: "js" }));
        builder.onResolve({ filter: /^@example\/svelte-native\/renderer$/ }, () => ({ path: resolve(import.meta.dirname, "../src/renderer.ts") }));
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
  animates.length = 0;
  const m = await load();
  const original = m.NativeNode.prototype.animate;
  m.NativeNode.prototype.animate = function (this: unknown, keyframes: unknown, options: unknown) {
    const animation = original.call(this, keyframes, options);
    animates.push({ node: this, keyframes: keyframes as Animate["keyframes"], options: options as Animate["options"], animation });
    return animation;
  };
  return m;
}
const find = (nodes: FakeNode[], name: string): FakeNode[] => nodes.flatMap((n) => [...(n.name === name ? [n] : []), ...find(n.children, name)]);
const byId = (root: number, id: string) => find(roots[root] ?? [], "RCTView").find((n) => n.props.testID === id) as FakeNode;
/** Lets every microtask that is queued, and the ones those queue, run. */
const settle = async (m: Loaded) => { await m.tick(); await new Promise((done) => setTimeout(done, 0)); };
// A cancelled animation leaves the node's own values in its worklet for a moment (RESTORE_MS) and then takes it away: let that timer fire while this test's log is still the one it writes to.
afterEach(async () => { await new Promise((done) => setTimeout(done, 150)); });
const timings = () => log().timings ?? [];
const A = () => log();
/** The values the node's mapper writes at a progress (the test plays the UI thread: it moves the shared value, then runs the mapper's worklet). */
function drawn(mapper: AnimLog["mappers"][number], mutable?: { _value: unknown }, progress?: number): Record<string, unknown> {
  if (mutable && progress !== undefined) mutable._value = progress;
  const before = A().updates.length;
  mapper.worklet(true);
  return A().updates.slice(before).at(-1)?.values ?? {};
}
const live = () => A().mappers.filter((mapper) => !mapper.stopped);
/** The mapper that writes to the view of a node: the one that writes to the descriptor set the node's tag was added to. */
function mapperFor(tag: number): AnimLog["mappers"][number] {
  const id = A().descriptors.find((entry) => entry.adds.some((add) => add.tag === tag))?.id;
  for (const mapper of live()) {
    const before = A().updates.length;
    mapper.worklet(true);
    if ((A().updates.slice(before).at(-1)?.descriptors as { id: number } | undefined)?.id === id) return mapper;
  }
  throw new Error(`no live mapper writes to the node with tag ${tag}`);
}

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
  expect(A().mappers.filter((mp) => !mp.stopped).length).toBeGreaterThan(0);
  await new Promise((done) => setTimeout(done, 200)); // after the settle timer the node's worklet is gone: the mapper stops
  expect(live().some((mp) => mp === restore)).toBe(false);
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
  const mapper = live().at(-1) as AnimLog["mappers"][number];
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
  const restoring = drawn(mapperFor(node.tag));
  expect(restoring).toEqual({ height: undefined, minHeight: undefined, opacity: 1 });
});
