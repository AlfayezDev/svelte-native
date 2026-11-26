import { afterEach, beforeEach, expect, test } from "bun:test";
import { resolve } from "node:path";
import type { NativeNode } from "../../src/renderer.ts";
import { load as loadBundle, src } from "../support/bundle.ts";

// The async-mode run (`support/async-mode-setup.ts`) puts a `requestAnimationFrame` on the global object for the whole process. The windowing tests assume none unless they
// install their own (as the frame-driven ones below do), so each test starts without one and the previous value is put back after it.
const frameScope = globalThis as { requestAnimationFrame?: unknown; cancelAnimationFrame?: unknown };
let framesBefore: [unknown, unknown] = [undefined, undefined];
beforeEach(() => {
  framesBefore = [frameScope.requestAnimationFrame, frameScope.cancelAnimationFrame];
  delete frameScope.requestAnimationFrame;
  delete frameScope.cancelAnimationFrame;
});
afterEach(() => {
  [frameScope.requestAnimationFrame, frameScope.cancelAnimationFrame] = framesBefore;
  if (framesBefore[0] === undefined) delete frameScope.requestAnimationFrame;
  if (framesBefore[1] === undefined) delete frameScope.cancelAnimationFrame;
});

/** The list mounted on the renderer alone (no Fabric host): a bundle built once, and evaluated afresh for each test. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the list is a bundle loaded at run time
const load = (fixture = "list-fixture.svelte") => loadBundle<any>({
  entry: `import Fixture from ${JSON.stringify(resolve(import.meta.dirname, "fixtures", fixture))};
    import renderer, {NativeNode} from ${JSON.stringify(src("renderer.ts"))};
    import {mount,tick} from 'svelte';
    export const root = new NativeNode('fragment');
    export const start = (props) => mount(Fixture, {target:root,renderer,props});
    export {tick};`,
  converters: false,
});

const nodes = (node: NativeNode): NativeNode[] => [node, ...node.getSnapshot().children.flatMap(nodes)];
/** The spacer, the content the rows are in: the one view whose style is a size and nothing else (the rows' wrappers are placed, `position: absolute`). */
const spacerOf = (root: NativeNode) => nodes(root).find((node) => {
  const style = node.getSnapshot().props.nativeStyle as { height?: unknown; width?: unknown; position?: unknown } | undefined;
  return node.name === "native-view" && style !== undefined && style.position === undefined && (typeof style.height === "number" || typeof style.width === "number");
}) as NativeNode;

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

test("rowHeights that read state, and a new rowHeights for the same items, move the rows below and what scrollToIndex scrolls to (#93)", async () => {
  const t = await setup({ count: 12, rowHeight: null, growing: true }, { height: 320, width: 300 });
  expect(t.style("r1")).toMatchObject({ top: 40, height: 40 });
  const commands: unknown[] = [];
  t.sp().ref({ dispatchCommand: (name: string, args: unknown[]) => commands.push([name, args]) });
  t.app.grow();
  await t.result.tick();
  expect(t.style("r0")).toMatchObject({ top: 0, height: 120 });
  expect(t.style("r1")).toMatchObject({ top: 120, height: 40 });
  expect(t.style("r2")).toMatchObject({ top: 160 });
  t.app.jump(1);
  expect(commands.splice(0)).toEqual([["scrollTo", [0, 120, false]]]);
  t.app.setHeights((_item: unknown, index: number) => (index === 0 ? 60 : 40));
  await t.result.tick();
  expect(t.style("r1")).toMatchObject({ top: 60, height: 40 });
  t.app.jump(1);
  expect(commands.splice(0)).toEqual([["scrollTo", [0, 60, false]]]);
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
  // The row is scrolled to once the content it is in has been laid out, as React Native's list does: the spacer's layout is what says so.
  expect(commands).toEqual([]);
  (spacerOf(root).getSnapshot().props.nativeProps as Record<string, (event: unknown) => void>).onLayout({ nativeEvent: { layout: { height: 12000, width: 300, x: 0, y: 0 } } });
  await result.tick();
  expect(commands).toEqual([["scrollTo", [0, 4000, false]]]);
  expect(ids()).toContain("r96");
  expect(ids()).toContain("r100");
  void app;
});

/** A list with a header of 80 dp over rows of 40 dp in a viewport of 120 dp, scrolled to row 8 at first: 80 + 8 * 40 = 400. */
async function withHeader(props: Record<string, unknown>) {
  const result = await load("list-header-fixture.svelte");
  const root: NativeNode = result.root;
  const app = result.start({ initialScrollIndex: 8, ...props });
  await result.tick();
  const scroll = () => nodes(root).find((node) => node.name === "native-scroll") as NativeNode;
  const sp = () => scroll().getSnapshot().props.nativeProps as Record<string, (event: unknown) => void>;
  const header = () => ((nodes(root).find((node) => node.getSnapshot().props["data-id"] === "header") as NativeNode).parent as NativeNode).getSnapshot().props.nativeProps as Record<string, (event: unknown) => void>;
  const ids = () => nodes(root).map((node) => String(node.getSnapshot().props["data-id"] ?? "")).filter((id) => /^r\d/.test(id));
  const commands: unknown[] = [];
  sp().ref({ dispatchCommand: (name: string, args: unknown[]) => commands.push([name, args]) });
  const layoutEvent = (height: number) => ({ nativeEvent: { layout: { x: 0, y: 0, width: 300, height } } });
  const viewport = () => sp().onLayout(layoutEvent(120));
  const headerLaidOut = (height = 80) => header().onLayout(layoutEvent(height));
  /** The spacer at the size the rows ask for (30 rows of 40 dp), as the platform reports it after the commit that has them. */
  // The spacer has the handler only while the jump waits: a layout that comes after it is one nobody asked for.
  const spacerLaidOut = (height = 1200) => (spacerOf(root).getSnapshot().props.nativeProps as Record<string, (event: unknown) => void> | undefined)?.onLayout?.(layoutEvent(height));
  const scrolled = (y: number) => sp().onScroll({ nativeEvent: { contentOffset: { x: 0, y }, contentSize: { width: 300, height: 0 }, layoutMeasurement: { width: 300, height: 120 } } });
  return { result, app, commands, viewport, headerLaidOut, spacerLaidOut, ids, scrolled };
}

test.each([
  ["the viewport's layout first, the header's and the spacer's a turn later", ["viewport", "header", "spacer"], false],
  ["the header's layout first", ["header", "viewport", "spacer"], false],
  ["the spacer's layout first", ["spacer", "header", "viewport"], false],
  ["the three in the same turn", ["viewport", "header", "spacer"], true],
] as const)("initialScrollIndex scrolls past the header, its height plus the row's offset, once, when the last of the three layouts is in: %s (#120)", async (_order, events, sameTurn) => {
  const t = await withHeader({});
  const send = { viewport: t.viewport, header: t.headerLaidOut, spacer: t.spacerLaidOut };
  for (const [index, event] of events.entries()) {
    send[event]();
    if (!sameTurn) await t.result.tick();
    if (index < events.length - 1) expect(t.commands, `after ${event}`).toEqual([]);
  }
  await t.result.tick();
  expect(t.commands).toEqual([["scrollTo", [0, 400, false]]]);
  // The list is where it was put: a later layout of the viewport or of the header (a header that grew) does not send it back to the row.
  t.viewport();
  t.headerLaidOut(100);
  await t.result.tick();
  expect(t.commands).toHaveLength(1);
});

test("the rows around the row it will scroll to are mounted while the jump waits, not the first rows of the list (a blank frame at the target)", async () => {
  const t = await withHeader({});
  t.viewport();
  await t.result.tick();
  // The header's size is not known yet: the window is at 320 (row 8) and moves with the size when it is.
  expect(t.ids()).toContain("r8");
  expect(t.ids()).not.toContain("r0");
  t.headerLaidOut();
  await t.result.tick();
  expect(t.ids()).toContain("r8");
  expect(t.ids()).not.toContain("r0");
  t.spacerLaidOut();
  await t.result.tick();
  expect(t.ids()).toContain("r8");
  expect(t.ids()).not.toContain("r0");
});

test("a scroll the app asks for before the layouts is the last word over initialScrollIndex, whichever layout comes last", async () => {
  const t = await withHeader({});
  t.app.scrollToOffset(200);
  t.viewport();
  t.headerLaidOut();
  t.spacerLaidOut();
  await t.result.tick();
  expect(t.commands).toEqual([["scrollTo", [0, 200, false]]]);
});

test("a row the app asks for before the layouts is scrolled to with the header's size, which the viewport's layout does not have yet", async () => {
  const t = await withHeader({});
  t.app.scrollToIndex(2);
  t.viewport();
  await t.result.tick();
  expect(t.commands).toEqual([]);
  t.headerLaidOut();
  t.spacerLaidOut();
  await t.result.tick();
  // 80 + 2 * 40: the index request wins over initialScrollIndex's 400, and it is the one that has the header's 80.
  expect(t.commands).toEqual([["scrollTo", [0, 160, false]]]);
});

test("initialScrollIndex waits for the rows and for their layout: a list that is empty at its first layout scrolls to the row once the content that has them is laid out, once", async () => {
  const t = await withHeader({ count: 0 });
  t.viewport();
  t.headerLaidOut();
  t.spacerLaidOut(0);
  await t.result.tick();
  expect(t.commands).toEqual([]);
  t.app.setCount(30);
  await t.result.tick();
  // The rows are in the tree, the platform has not laid the content out: the scroll would go to a scroll view that has none (#120).
  expect(t.commands).toEqual([]);
  expect(t.ids()).toContain("r8");
  t.spacerLaidOut();
  await t.result.tick();
  expect(t.commands).toEqual([["scrollTo", [0, 400, false]]]);
  t.app.setCount(40);
  await t.result.tick();
  t.spacerLaidOut(1600);
  await t.result.tick();
  expect(t.commands).toHaveLength(1);
});

test("a list with no initialScrollIndex when it has its first rows is not scrolled by one that is set later, when the list grows", async () => {
  const t = await withHeader({ initialScrollIndex: undefined, count: 10 });
  t.viewport();
  t.headerLaidOut();
  await t.result.tick();
  t.app.setInitial(5);
  t.app.setCount(20);
  await t.result.tick();
  t.app.setCount(30);
  await t.result.tick();
  expect(t.commands).toEqual([]);
});

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test("what is viewable and the end are not reported while the jump waits: late rows give no impression of the first rows, then the jump reports the rows it shows (#120)", async () => {
  const t = await withHeader({ count: 0 });
  t.viewport();
  t.headerLaidOut();
  t.spacerLaidOut(0);
  await t.result.tick();
  t.app.setCount(30);
  await t.result.tick();
  await wait(90);
  // The list is at 0 until the jump goes, and rows 0 to 2 are what 0 shows: nothing is reported of them, and the end is not asked about.
  expect(t.app.viewedBatches()).toEqual([]);
  expect(t.app.endsReached()).toBe(0);
  t.spacerLaidOut();
  await t.result.tick();
  expect(t.commands).toEqual([["scrollTo", [0, 400, false]]]);
  t.scrolled(400);
  await wait(90);
  const first = t.app.viewedBatches()[0] ?? [];
  expect(t.app.viewedBatches()).toHaveLength(1);
  // The keys are the ids: row 8 first, and nothing of the first rows.
  expect(first[0]).toBe("8");
  expect(first).not.toContain("0");
});

test("a list that ends where the jump goes reports its end after the jump, not before it (#120)", async () => {
  const t = await withHeader({ count: 2, initialScrollIndex: 1 });
  t.viewport();
  t.headerLaidOut();
  t.spacerLaidOut(80);
  await t.result.tick();
  expect(t.commands).toEqual([["scrollTo", [0, 120, false]]]);
  t.scrolled(120);
  await t.result.tick();
  expect(t.app.endsReached()).toBe(1);
});

test("a header that goes while the jump waits for its first layout stops it waiting: the jump goes without the header's size (#120)", async () => {
  const t = await withHeader({});
  t.viewport();
  t.spacerLaidOut();
  await t.result.tick();
  expect(t.commands).toEqual([]);
  t.app.setHeader(false);
  await t.result.tick();
  expect(t.commands).toEqual([["scrollTo", [0, 320, false]]]);
  expect(t.ids()).toContain("r8");
});

test("a row the app asks for while the header has not been seen is sent when the header goes (#120)", async () => {
  const t = await withHeader({});
  t.app.scrollToIndex(2);
  t.viewport();
  t.spacerLaidOut();
  await t.result.tick();
  expect(t.commands).toEqual([]);
  t.app.setHeader(false);
  await t.result.tick();
  // 2 * 40, with no header: and the request is the last word over initialScrollIndex.
  expect(t.commands).toEqual([["scrollTo", [0, 80, false]]]);
});

test("rows replaced while the jump waits are scrolled to when the content that has them is laid out, from the new content, once (#120)", async () => {
  const t = await withHeader({});
  t.viewport();
  t.headerLaidOut();
  await t.result.tick();
  t.app.setCount(12);
  await t.result.tick();
  // The platform's layout of the old content (30 rows) is a size the new rows (12) do not ask for: a smaller content is enough for the rows it has.
  t.spacerLaidOut(1200);
  await t.result.tick();
  expect(t.commands).toEqual([["scrollTo", [0, 400, false]]]);
  t.spacerLaidOut(480);
  await t.result.tick();
  expect(t.commands).toHaveLength(1);
});

test("rows that arrive in chunks are scrolled to with the first, to the end of it when the index is past it, once, as React Native's does (#120)", async () => {
  const t = await withHeader({ count: 5 });
  t.viewport();
  t.headerLaidOut();
  t.spacerLaidOut(200);
  await t.result.tick();
  // Row 8 is not there: the last row of the chunk is (80 + 4 * 40).
  expect(t.commands).toEqual([["scrollTo", [0, 240, false]]]);
  t.app.setCount(30);
  await t.result.tick();
  t.spacerLaidOut(1200);
  await t.result.tick();
  expect(t.commands).toHaveLength(1);
});

test("a jump whose content never reports its layout goes after a wait, with what the list has (#120)", async () => {
  const t = await withHeader({});
  t.viewport();
  t.headerLaidOut();
  await t.result.tick();
  expect(t.commands).toEqual([]);
  await wait(1150);
  expect(t.commands).toEqual([["scrollTo", [0, 400, false]]]);
});

test("rows that arrive after the fallback's wait are still scrolled to, when the content that has them is laid out: the fallback is for a list that has rows, not a jump into an empty one (#120)", async () => {
  const t = await withHeader({ count: 0 });
  t.viewport();
  t.headerLaidOut();
  t.spacerLaidOut(0);
  await t.result.tick();
  // Longer than the fallback's wait, with no rows: nothing is sent (the platform clamps a scroll to 0 in an empty content), and the jump is not used up.
  await wait(1250);
  expect(t.commands).toEqual([]);
  t.app.setCount(30);
  await t.result.tick();
  expect(t.commands).toEqual([]);
  t.spacerLaidOut();
  await t.result.tick();
  expect(t.commands).toEqual([["scrollTo", [0, 400, false]]]);
});

test("the end and the viewable rows are asked about when the jump goes, also when it moves nothing and no scroll event follows: a first page that fits, an index clamped to 0 (#120)", async () => {
  // One row of 40 under a header of 80 in a viewport of 120: the page fits, the index is 0, and the platform scrolls nowhere (it has 0 to scroll), so it sends no scroll event.
  const t = await withHeader({ count: 1, initialScrollIndex: 0 });
  t.viewport();
  t.headerLaidOut();
  await t.result.tick();
  await wait(90);
  // Waiting for the spacer: neither is reported about a list that is not where it will be.
  expect(t.app.endsReached()).toBe(0);
  expect(t.app.viewedBatches()).toEqual([]);
  expect(t.commands).toEqual([]);
  t.spacerLaidOut(40);
  await t.result.tick();
  expect(t.commands).toEqual([["scrollTo", [0, 80, false]]]);
  // No `scrolled()`: the answers are due with the jump, as the list gave them at its layout before there was a jump to wait for.
  expect(t.app.endsReached()).toBe(1);
  await wait(90);
  expect(t.app.viewedBatches()).toEqual([["0"]]);
});

test("a jump that waits for the spacer waits again for rows that come after the rows it waited for went: the wait of rows that are gone does not end into the new ones (#120)", async () => {
  const t = await withHeader({});
  t.viewport();
  t.headerLaidOut();
  await t.result.tick();
  // The wait has started, for 30 rows.
  await wait(600);
  expect(t.commands).toEqual([]);
  t.app.setCount(0);
  await t.result.tick();
  await wait(380);
  // The rows come back just before the first wait would have ended (at 1000 ms), and their layout is not there yet.
  t.app.setCount(30);
  await t.result.tick();
  await wait(120);
  expect(t.commands, "past the first wait, before the new rows' own").toEqual([]);
  // Their own wait is the one that ends, with the rows that are there.
  await wait(1000);
  expect(t.commands).toEqual([["scrollTo", [0, 400, false]]]);
});

test("a scroll asked for from inside a derived is not a write of state (#120)", async () => {
  const t = await withHeader({});
  // The call is made where a write of state is refused: the request is kept in plain fields and the state is let go of in a microtask.
  expect(t.app.askFromDerived()).toBe(true);
  t.viewport();
  t.headerLaidOut();
  t.spacerLaidOut();
  await t.result.tick();
  expect(t.commands).toEqual([["scrollTo", [0, 200, false]]]);
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
