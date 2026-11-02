import { test, expect } from "bun:test";
import { build } from "esbuild";
import { readFile, mkdtemp, writeFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { compile } from "svelte/compiler";
import type { NativeNode } from "../src/renderer.ts";

async function load() {
  const bundle = await build({
    stdin: {
      contents: `import Fixture from './list-fixture.svelte';
        import renderer, {NativeNode} from '../src/renderer.ts';
        import {mount,tick} from 'svelte';
        export const root = new NativeNode('fragment');
        export const start = (props) => mount(Fixture, {target:root,renderer,props});
        export {tick};`,
      resolveDir: import.meta.dirname,
    },
    bundle: true, format: "esm", platform: "neutral", conditions: ["browser"], write: false,
    external: ["react-native"],
    plugins: [{
      name: "native-fixture",
      setup(builder) {
        builder.onResolve({ filter: /^@rasheed\/svelte-native\/renderer$/ }, () => ({ path: resolve(import.meta.dirname, "../src/renderer.ts") }));
        builder.onResolve({ filter: /^esm-env$/ }, () => ({ path: resolve(import.meta.dirname, "../src/environment.ts") }));
        builder.onLoad({ filter: /\.svelte$/ }, async ({ path }) => ({
          contents: compile(await readFile(path, "utf8"), { filename: path, css: "external", dev: false, experimental: { customRenderer: "@rasheed/svelte-native/renderer" } }).js.code,
          loader: "js",
        }));
      },
    }],
  });
  const directory = await mkdtemp(resolve(tmpdir(), "svelte-native-list-"));
  const file = resolve(directory, "list.mjs");
  await writeFile(file, bundle.outputFiles[0].contents);
  const result = await import(pathToFileURL(file).href);
  await rm(directory, { recursive: true });
  return result;
}

const nodes = (node: NativeNode): NativeNode[] => [node, ...node.getSnapshot().children.flatMap(nodes)];

test("a virtual list mounts a window of rows, moves it on scroll and keeps keyed rows", async () => {
  const result = await load();
  const root: NativeNode = result.root;
  const ends: number[] = [];
  const app = result.start({ count: 300, onEnd: () => ends.push(1) });
  await result.tick();
  const scroll = () => nodes(root).find((node) => node.name === "native-scroll") as NativeNode;
  const props = () => scroll().getSnapshot().props.nativeProps as Record<string, (event: unknown) => void> & { ref: (handle: unknown) => void };
  const ids = () => nodes(root).filter((node) => String(node.getSnapshot().props["data-id"] ?? "").startsWith("r")).map((node) => String(node.getSnapshot().props["data-id"]));
  const rowNode = (id: string) => nodes(root).find((node) => node.getSnapshot().props["data-id"] === id) as NativeNode;
  const rowTop = (id: string) => ((rowNode(id).parent as NativeNode).getSnapshot().props.nativeStyle as { top: number }).top;

  // Before the first layout: 10 rows.
  expect(ids()).toHaveLength(10);
  const commands: unknown[] = [];
  props().ref({ dispatchCommand: (name: string, args: unknown[]) => commands.push([name, args]) });

  props().onLayout({ nativeEvent: { layout: { height: 400, width: 300, x: 0, y: 0 } } });
  await result.tick();
  expect(ids()).toHaveLength(14); // 10 visible + 4 overscan
  expect(rowTop("r5")).toBe(200);
  const r10 = rowNode("r10");
  const r10Wrapper = r10.parent as NativeNode;

  props().onScroll({ nativeEvent: { contentOffset: { x: 0, y: 40 } } });
  await result.tick();
  expect(rowNode("r10")).toBe(r10);
  expect(ids()).toContain("r14");

  props().onScroll({ nativeEvent: { contentOffset: { x: 0, y: 4000 } } });
  await result.tick();
  const mounted = ids();
  expect(mounted.length).toBeLessThanOrEqual(18);
  expect(mounted).toContain("r100");
  expect(mounted).not.toContain("r0");
  expect(r10Wrapper.parent).toBeNull();
  expect(rowTop("r100")).toBe(4000);
  expect(ends).toHaveLength(0);

  props().onScroll({ nativeEvent: { contentOffset: { x: 0, y: 11600 } } });
  await result.tick();
  expect(ends).toHaveLength(1);
  props().onScroll({ nativeEvent: { contentOffset: { x: 0, y: 11600 } } });
  expect(ends).toHaveLength(1);
  expect(ids()).toContain("r299");

  app.jump(50);
  app.jump(2);
  expect(commands).toEqual([["scrollTo", [0, 2000, false]], ["scrollTo", [0, 80, false]]]);
});

async function setup(props: Record<string, unknown>, layout = { height: 400, width: 300 }) {
  const result = await load();
  const root: NativeNode = result.root;
  const app = result.start(props);
  await result.tick();
  const scroll = () => nodes(root).find((node) => node.name === "native-scroll") as NativeNode;
  const sp = () => scroll().getSnapshot().props.nativeProps as Record<string, (event: unknown) => void>;
  const rowNode = (id: string) => nodes(root).find((node) => node.getSnapshot().props["data-id"] === id) as NativeNode | undefined;
  const wrapper = (id: string) => rowNode(id)?.parent as NativeNode;
  const style = (id: string) => wrapper(id).getSnapshot().props.nativeStyle as Record<string, number>;
  const ids = () => nodes(root).filter((node) => String(node.getSnapshot().props["data-id"] ?? "").startsWith("r")).map((node) => String(node.getSnapshot().props["data-id"]));
  const layoutEvent = (size: { width?: number; height?: number }) => ({ nativeEvent: { layout: { x: 0, y: 0, width: 0, height: 0, ...size } } });
  sp().onLayout(layoutEvent(layout));
  await result.tick();
  const scrollTo = async (x: number, y: number) => { sp().onScroll({ nativeEvent: { contentOffset: { x, y } } }); await result.tick(); };
  return { result, root, app, sp, rowNode, wrapper, style, ids, layoutEvent, scrollTo, scroll };
}
const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

test("rows without a fixed height are measured and shift the rows after them", async () => {
  const t = await setup({ count: 100, rowHeight: null });
  expect(t.style("r0").top).toBe(0);
  expect(t.style("r2").top).toBe(96); // estimates of 48
  expect(t.wrapper("r0").getSnapshot().props.nativeProps).toBeDefined();
  const onLayout = (id: string) => (t.wrapper(id).getSnapshot().props.nativeProps as Record<string, (e: unknown) => void>).onLayout;
  onLayout("r0")(t.layoutEvent({ height: 100 }));
  onLayout("r1")(t.layoutEvent({ height: 20 }));
  expect(t.style("r2").top).toBe(96); // batched until the next frame
  await sleep(40);
  await t.result.tick();
  expect(t.style("r1").top).toBe(100);
  expect(t.style("r2").top).toBe(120);
  expect(t.style("r3").top).toBe(168);
  // Matching the estimate changes nothing; scrollToIndex uses the table.
  const commands: unknown[] = [];
  t.sp().ref({ dispatchCommand: (name: string, args: unknown[]) => commands.push([name, args]) });
  t.app.jump(2);
  expect(commands).toEqual([["scrollTo", [0, 120, false]]]);
});

test("rowHeights skips measuring", async () => {
  const t = await setup({ count: 50, rowHeight: null, heightOf: (_: unknown, index: number) => 30 + index });
  expect(t.wrapper("r0").getSnapshot().props.nativeProps).toBeUndefined();
  expect(t.style("r3")).toMatchObject({ top: 30 + 31 + 32, height: 33 });
});

test("horizontal lists window on x and scroll by x", async () => {
  const t = await setup({ count: 300, rowHeight: 40, horizontal: true }, { height: 100, width: 300 });
  expect(t.scroll().getSnapshot().props.nativeProps).toMatchObject({ horizontal: true });
  expect(t.ids()).toHaveLength(12); // 8 visible (ceil 300/40) + 4 overscan
  expect(t.style("r5")).toMatchObject({ left: 200, width: 40, top: 0, bottom: 0 });
  await t.scrollTo(4000, 0);
  expect(t.ids()).toContain("r100");
  expect(t.ids()).not.toContain("r0");
  const commands: unknown[] = [];
  t.sp().ref({ dispatchCommand: (name: string, args: unknown[]) => commands.push([name, args]) });
  t.app.jump(50);
  expect(commands).toEqual([["scrollTo", [2000, 0, false]]]);
});

test("initialScrollIndex mounts and scrolls to that row on first layout", async () => {
  const result = await load();
  const root: NativeNode = result.root;
  const app = result.start({ count: 300, initialScrollIndex: 100 });
  await result.tick();
  const scroll = () => nodes(root).find((node) => node.name === "native-scroll") as NativeNode;
  const sp = () => scroll().getSnapshot().props.nativeProps as Record<string, (event: unknown) => void>;
  const ids = () => nodes(root).map((n) => String(n.getSnapshot().props["data-id"] ?? "")).filter((id) => id.startsWith("r"));
  expect(ids()[0]).toBe("r100");
  const commands: unknown[] = [];
  sp().ref({ dispatchCommand: (name: string, args: unknown[]) => commands.push([name, args]) });
  sp().onLayout({ nativeEvent: { layout: { height: 400, width: 300, x: 0, y: 0 } } });
  await result.tick();
  expect(commands).toEqual([["scrollTo", [0, 4000, false]]]);
  expect(ids()).toContain("r96");
  expect(ids()).toContain("r100");
  void app;
});

test("a scroll asked for before the scroll view is bound and laid out is sent when both are, the last one asked for", async () => {
  const result = await load();
  const root: NativeNode = result.root;
  const app = result.start({ count: 300 });
  await result.tick();
  const scroll = () => nodes(root).find((node) => node.name === "native-scroll") as NativeNode;
  const sp = () => scroll().getSnapshot().props.nativeProps as Record<string, (event: unknown) => void>;
  const commands: unknown[] = [];
  const view = { dispatchCommand: (name: string, args: unknown[]) => commands.push([name, args]) };
  const layoutEvent = { nativeEvent: { layout: { height: 400, width: 300, x: 0, y: 0 } } };

  // Neither the view nor its layout yet: nothing is sent, and the page's call is not lost.
  app.jump(50);
  app.jump(60);
  expect(commands).toEqual([]);
  // The view alone is not enough (it has no content to scroll before its first layout).
  sp().ref(view);
  expect(commands).toEqual([]);
  sp().onLayout(layoutEvent);
  await result.tick();
  expect(commands).toEqual([["scrollTo", [0, 2400, false]]]);
  // It is sent once, and a request made now goes at once.
  sp().onLayout(layoutEvent);
  app.jump(2);
  expect(commands).toEqual([["scrollTo", [0, 2400, false]], ["scrollTo", [0, 80, false]]]);
});

test("a scroll asked for before the layout is sent by the ref when the layout came first", async () => {
  const result = await load();
  const root: NativeNode = result.root;
  const app = result.start({ count: 300 });
  await result.tick();
  const scroll = () => nodes(root).find((node) => node.name === "native-scroll") as NativeNode;
  const sp = () => scroll().getSnapshot().props.nativeProps as Record<string, (event: unknown) => void>;
  const commands: unknown[] = [];
  app.jump(10);
  sp().onLayout({ nativeEvent: { layout: { height: 400, width: 300, x: 0, y: 0 } } });
  await result.tick();
  expect(commands).toEqual([]);
  sp().ref({ dispatchCommand: (name: string, args: unknown[]) => commands.push([name, args]) });
  expect(commands).toEqual([["scrollTo", [0, 400, false]]]);
});

test("onViewableItemsChanged reports visible keys, debounced", async () => {
  const events: { viewableItems: { key: string }[]; changed: { key: string; isViewable: boolean }[] }[] = [];
  const t = await setup({ count: 300, onViewable: (info: never) => events.push(info) });
  await sleep(80);
  expect(events).toHaveLength(1);
  expect(events[0].viewableItems.map((v) => v.key)).toEqual(Array.from({ length: 10 }, (_, i) => `r${i}`));
  await t.scrollTo(0, 20); // r0 half hidden: 50% still counts; r10 half shown
  await t.scrollTo(0, 30); // r0 25% visible
  await sleep(80);
  expect(events).toHaveLength(2);
  expect(events[1].changed).toEqual(expect.arrayContaining([expect.objectContaining({ key: "r0", isViewable: false }), expect.objectContaining({ key: "r10", isViewable: true })]));
  expect(events[1].viewableItems.map((v) => v.key)[0]).toBe("r1");
});

test("an empty list renders the empty snippet", async () => {
  const t = await setup({ none: true });
  expect(t.rowNode("empty")).toBeDefined();
});

test("recycle mode keeps wrapper nodes and re-targets them by index", async () => {
  const t = await setup({ count: 300, recycle: true });
  const spacer = t.wrapper("r0").parent as NativeNode;
  const wrappers = () => spacer.getSnapshot().children.filter((n) => n.name === "native-view") as NativeNode[];
  const before = [...wrappers()];
  expect(before.length).toBe(19); // viewport 10 rows + 1 + 2 * overscan
  expect(t.style("r5").top).toBe(200);
  for (const y of [40, 400, 4000, 8000, 11600, 0]) await t.scrollTo(0, y);
  const after = wrappers();
  expect(after).toHaveLength(before.length);
  for (const node of after) expect(before).toContain(node);
  await t.scrollTo(0, 4000);
  expect(wrappers().every((node, i) => node === before[i])).toBe(true);
  expect(t.ids()).toContain("r100");
  expect(t.ids()).not.toContain("r0");
  expect(t.style("r100").top).toBe(4000);
});

test("a list that says its height mounts the rows that fill it first, the overscan after its layout", async () => {
  const result = await load();
  const root: NativeNode = result.root;
  result.start({ count: 300, height: 360, rowHeight: 46 });
  await result.tick();
  const rows = () => nodes(root).filter((node) => String(node.getSnapshot().props["data-id"] ?? "").startsWith("r")).length;
  expect(rows()).toBe(8); // 360 / 46 = 7.8: eight rows show, the ninth and tenth would be below the fold
  const scroll = nodes(root).find((node) => node.name === "native-scroll") as NativeNode;
  (scroll.getSnapshot().props.nativeProps as { onLayout: (event: unknown) => void }).onLayout({ nativeEvent: { layout: { height: 360, width: 300, x: 0, y: 0 } } });
  await result.tick();
  expect(rows()).toBe(12); // the viewport's rows (0-7) and 4 of overscan
});

test("a list that fills mounts the rows that show first and the overscan a few frames later", async () => {
  const frames: (() => void)[] = [];
  const scope = globalThis as { requestAnimationFrame?: (callback: () => void) => number; cancelAnimationFrame?: (handle: number) => void };
  const saved = [scope.requestAnimationFrame, scope.cancelAnimationFrame];
  scope.requestAnimationFrame = (callback) => frames.push(callback);
  scope.cancelAnimationFrame = () => {};
  try {
    const result = await load();
    const root: NativeNode = result.root;
    const app = result.start({ count: 0, height: 360, rowHeight: 46 }) as { setCount: (count: number) => void };
    await result.tick();
    const rows = () => nodes(root).filter((node) => String(node.getSnapshot().props["data-id"] ?? "").startsWith("r")).length;
    const scroll = nodes(root).find((node) => node.name === "native-scroll") as NativeNode;
    (scroll.getSnapshot().props.nativeProps as { onLayout: (event: unknown) => void }).onLayout({ nativeEvent: { layout: { height: 360, width: 300, x: 0, y: 0 } } });
    await result.tick();
    expect(rows()).toBe(0);
    app.setCount(300);
    await result.tick();
    // The viewport is known (the list was laid out empty): the rows that show, and nothing around them yet.
    expect(rows()).toBe(8);
    // The overscan waits a few frames, not the next one: the rows that show have the thread (and their layout event) first.
    for (let frame = 1; frame <= 3; frame++) {
      expect(frames.length).toBe(1);
      frames.splice(0)[0]();
      await result.tick();
      expect(rows()).toBe(8);
    }
    expect(frames.length).toBe(1);
    frames.splice(0)[0]();
    await result.tick();
    expect(rows()).toBe(12);
  } finally {
    [scope.requestAnimationFrame, scope.cancelAnimationFrame] = saved;
  }
});

test("rows of one size keep the style objects of their wrappers when the list grows, and follow a change of the size", async () => {
  const t = await setup({ count: 20, rowHeight: 40 });
  const app = t.app as unknown as { setCount: (count: number) => void };
  const wrapperStyle = (id: string) => t.wrapper(id).getSnapshot().props.nativeStyle as Record<string, number>;
  const before = wrapperStyle("r3");
  expect(before).toEqual({ position: "absolute", top: 120, left: 0, right: 0, height: 40 });
  app.setCount(40);
  await t.result.tick();
  expect(wrapperStyle("r3")).toBe(before); // the same object: its effect did not run for a longer list
  expect(t.ids()).toContain("r8");
  (t.app as unknown as { setRowHeight: (size: number) => void }).setRowHeight(50);
  await t.result.tick();
  expect(wrapperStyle("r3")).toEqual({ position: "absolute", top: 150, left: 0, right: 0, height: 50 });
});

test("a list that waits for its overscan lets go of the wait when it empties", async () => {
  const frames: (() => void)[] = [];
  const cancelled: number[] = [];
  const scope = globalThis as { requestAnimationFrame?: (callback: () => void) => number; cancelAnimationFrame?: (handle: number) => void };
  const saved = [scope.requestAnimationFrame, scope.cancelAnimationFrame];
  scope.requestAnimationFrame = (callback) => frames.push(callback);
  scope.cancelAnimationFrame = (handle) => { cancelled.push(handle); };
  try {
    const result = await load();
    const app = result.start({ count: 300, height: 360, rowHeight: 46 }) as { setCount: (count: number) => void };
    await result.tick();
    expect(frames.length).toBe(1);
    app.setCount(0);
    await result.tick();
    expect(cancelled).toEqual([1]); // the frame request that was waiting is cancelled, not left to turn the overscan on for an empty list
  } finally {
    [scope.requestAnimationFrame, scope.cancelAnimationFrame] = saved;
  }
});

test("rows of one size keep their wrappers when rows arrive in front of them, and move to their new places", async () => {
  const t = await setup({ count: 20, rowHeight: 40 });
  const app = t.app as unknown as { prepend: (count: number) => void };
  const wrapperBefore = t.wrapper("r3");
  expect(t.style("r3").top).toBe(120);
  app.prepend(2);
  await t.result.tick();
  expect(t.wrapper("r3")).toBe(wrapperBefore); // the key kept its row
  expect(t.style("r3").top).toBe(200); // 2 + 3 rows above it now
  expect(t.style("r-2").top).toBe(0);
  expect(t.ids().slice(0, 3)).toEqual(["r-2", "r-1", "r0"]);
});

/** A frame loop the test drives: callbacks wait until `run`, a cancelled one never runs. */
function frameLoop() {
  const scope = globalThis as { requestAnimationFrame?: (callback: () => void) => number; cancelAnimationFrame?: (handle: number) => void };
  const saved = [scope.requestAnimationFrame, scope.cancelAnimationFrame];
  const pending = new Map<number, () => void>();
  let next = 1;
  scope.requestAnimationFrame = (callback) => { pending.set(next, callback); return next++; };
  scope.cancelAnimationFrame = (handle) => { pending.delete(handle); };
  return {
    pending: () => pending.size,
    /** The frame callbacks that are waiting now run; the ones they ask for wait for the next frame. */
    run() { const due = [...pending]; pending.clear(); for (const [, callback] of due) callback(); },
    restore() { [scope.requestAnimationFrame, scope.cancelAnimationFrame] = saved; },
  };
}

test("the overscan wait counts from the fill: a list that grows during it does not start it again, one that empties and refills does", async () => {
  const frames = frameLoop();
  try {
    const result = await load();
    const root: NativeNode = result.root;
    const app = result.start({ count: 0, height: 360, rowHeight: 46 }) as { setCount: (count: number) => void };
    await result.tick();
    const rows = () => nodes(root).filter((node) => String(node.getSnapshot().props["data-id"] ?? "").startsWith("r")).length;
    const scroll = nodes(root).find((node) => node.name === "native-scroll") as NativeNode;
    (scroll.getSnapshot().props.nativeProps as { onLayout: (event: unknown) => void }).onLayout({ nativeEvent: { layout: { height: 360, width: 300, x: 0, y: 0 } } });
    await result.tick();
    const frame = async () => { frames.run(); await result.tick(); };

    app.setCount(100);
    await result.tick();
    expect(rows()).toBe(8);
    await frame();
    await frame();
    expect(rows()).toBe(8);
    // A feed loads more: the wait goes on, with two frames left, not four.
    app.setCount(160);
    await result.tick();
    expect(frames.pending()).toBe(1);
    await frame();
    expect(rows()).toBe(8);
    await frame();
    expect(rows()).toBe(12); // four frames after the fill, whatever came in between

    // Emptied during a wait and filled again: four frames from the refill.
    app.setCount(0);
    await result.tick();
    expect(rows()).toBe(0);
    app.setCount(100);
    await result.tick();
    expect(rows()).toBe(8);
    await frame();
    app.setCount(0);
    await result.tick();
    expect(frames.pending()).toBe(0); // the wait that was on is cancelled
    app.setCount(120);
    await result.tick();
    for (let wait = 1; wait <= 3; wait++) { await frame(); expect(rows()).toBe(8); }
    await frame();
    expect(rows()).toBe(12);
  } finally {
    frames.restore();
  }
});

test("rows of one size are described once: the same object across a grow, a scroll step and a new items array with the same keys", async () => {
  const t = await setup({ count: 20, rowHeight: 40 });
  const app = t.app as unknown as { setCount: (count: number) => void; prepend: (count: number) => void };
  const described = (id: string) => ({ wrapper: t.wrapper(id), style: t.wrapper(id).getSnapshot().props.nativeStyle });
  const r2 = described("r2");
  const r5 = described("r5");
  app.setCount(30); // a new items array, the same keys for the rows there are
  await t.result.tick();
  expect(described("r2").style).toBe(r2.style);
  expect(described("r5").style).toBe(r5.style);
  await t.scrollTo(0, 40); // one row's step: the window moves, r2 stays in it
  expect(described("r2").style).toBe(r2.style);
  expect(described("r2").wrapper).toBe(r2.wrapper);
  // A key that moves to another index is described again (its style says where it is now); the others keep theirs.
  app.prepend(1);
  await t.result.tick();
  expect(described("r2").wrapper).toBe(r2.wrapper);
  expect(described("r2").style).not.toBe(r2.style);
  expect((described("r2").style as Record<string, number>).top).toBe(120); // 1 + 2 rows above it now
});
