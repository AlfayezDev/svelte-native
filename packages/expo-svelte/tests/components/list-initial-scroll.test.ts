import { afterEach, expect, test } from "bun:test";
import { resolve } from "node:path";
import { type FakeNode, type Module, all, emit, fake, host, load, settle } from "../support/html-harness.ts";

/**
 * `initialScrollIndex` on the real Fabric host (#120), where a commit is a microtask of its own and the platform's scroll view clamps a scroll to the content it has. A list that gets its rows after its
 * first layout sees them in an effect of Svelte's flush, and the host commits them in a later microtask: a `scrollTo` sent from the effect goes out ahead of the commit that grows the spacer and lands
 * at 0 on Android. The scroll is sent when the platform has laid the content out (the spacer's layout), which comes after the commit. `scrolls` is what that scroll view would have done: each `scrollTo`
 * against the tree committed when it was sent.
 */
const fixture = resolve(import.meta.dirname, "fixtures/list-header-fixture.svelte");
const original = fake.dispatchCommand;
let surface = 970;
/** The geometry the platform's scroll view is modeled with: the viewport, the header and the footer along the axis, the container's padding and the inset after the content (iOS counts it, Android has none). */
type Geometry = { viewport?: number; header?: number; footer?: number; padding?: number; inset?: number; horizontal?: boolean; events?: "auto" | "manual"; os?: "ios" | "android" };
let started: { m: Module; tag: number } | undefined;
afterEach(() => {
  delete (globalThis as { __htmlOS?: string }).__htmlOS;
  fake.dispatchCommand = original;
  if (started) started.m.stopSurface(started.tag);
  started = undefined;
});

async function mount(props: Record<string, unknown>, geometry: Geometry = {}) {
  const { viewport = 120, header = 80, footer = 0, padding = 0, inset = 0, horizontal = false, events = "auto", os = "android" } = geometry;
  (globalThis as { __htmlOS?: string }).__htmlOS = os;
  const m = await load(fixture);
  host.roots = {};
  const tag = ++surface;
  const app = m.startSurface(tag, m.Fixture, { initialScrollIndex: 8, horizontal, size: viewport, ...props }) as { setCount(count: number): void; viewedBatches(): string[][]; endsReached(): number };
  started = { m, tag };
  await settle(m);
  const tree = () => all(host.roots[tag] ?? []);
  const byId = (testID: string) => tree().find((node) => node.props.testID === testID);
  const scroller = () => tree().find((node) => node.name === "RCTScrollView") as FakeNode;
  const headerWrapper = () => tree().find((node) => node.children.some((child) => child.props.testID === "header")) as FakeNode;
  // The spacer: the view whose style is a height and nothing else (the rows' wrappers are placed, the header's has no style, the scroll content's is a list).
  const styleOf = (node: FakeNode) => node.props.style as { height?: unknown; position?: unknown } | null | undefined;
  const footerWrapper = () => tree().find((node) => node.children.some((child) => child.props.testID === "footer")) as FakeNode;
  const axis = horizontal ? "width" : "height";
  const spacer = () => tree().find((node) => node.name === "RCTView" && !Array.isArray(node.props.style) && typeof styleOf(node)?.[axis] === "number" && styleOf(node)?.position === undefined) as FakeNode;
  const spacerHeight = () => (styleOf(spacer())?.[axis] as number | undefined) ?? 0;
  const scrolls: { asked: number; landed: number; content: number }[] = [];
  // The scroll view clamps a scroll to the content it has, and says so with a scroll event only when it moved (a scroll that lands where it is is silent). `events: "manual"` holds the event back for [deliver].
  let nativeOffset = 0;
  let undelivered: (() => void) | undefined;
  const deliver = () => { const send = undelivered; undelivered = undefined; send?.(); };
  fake.dispatchCommand = ((node: FakeNode, command: string, args: unknown[]) => {
    if (command === "scrollTo") {
      const content = padding + header + spacerHeight() + footer + (os === "ios" ? inset : 0);
      const asked = args[horizontal ? 0 : 1] as number;
      const landed = Math.min(asked, Math.max(0, content - viewport));
      scrolls.push({ asked, content, landed });
      if (landed !== nativeOffset) {
        nativeOffset = landed;
        const send = () => emit(scroller().target, "topScroll", { contentOffset: { x: horizontal ? landed : 0, y: horizontal ? 0 : landed }, contentSize: { width: horizontal ? content : 300, height: horizontal ? 300 : content }, layoutMeasurement: { width: horizontal ? viewport : 300, height: horizontal ? 300 : viewport }, target: 1 });
        if (events === "auto") queueMicrotask(send);
        else undelivered = send;
      }
    }
    original(node, command, args);
  }) as typeof fake.dispatchCommand;
  const layout = (node: FakeNode, main: number, cross: number) => emit(node.target, "topLayout", { layout: { x: 0, y: 0, width: horizontal ? main : cross, height: horizontal ? cross : main } });
  return {
    m, app, scrolls, byId, spacer, spacerHeight, deliver, tree,
    viewportLaidOut: () => layout(scroller(), viewport, 300),
    headerLaidOut: () => layout(headerWrapper(), header, 300),
    footerLaidOut: () => layout(footerWrapper(), footer, 300),
    /** The platform's report of the spacer, which follows the commit that has it. */
    spacerLaidOut: () => layout(spacer(), spacerHeight(), 300),
  };
}

test("rows that arrive after the first layout are scrolled to once the platform has them: the scroll waits for the content's layout, which comes after the commit", async () => {
  const t = await mount({ count: 0 });
  t.viewportLaidOut();
  t.headerLaidOut();
  t.spacerLaidOut();
  await settle(t.m);
  expect(t.scrolls).toEqual([]);
  t.app.setCount(30);
  await settle(t.m);
  // The rows and the spacer at 1200 are committed. A scroll from the effect that saw the rows would have gone out ahead of that commit, to a scroll view that had 80 dp of content: it lands at 0.
  expect(t.spacerHeight()).toBe(1200);
  expect(t.scrolls).toEqual([]);
  // The window is around the row it will scroll to, not at the top of the list: the first rows would be replaced when the scroll goes, and a frame at the target would show none.
  expect(t.byId("r8")).toBeDefined();
  expect(t.byId("r0")).toBeUndefined();
  t.spacerLaidOut();
  await settle(t.m);
  expect(t.scrolls).toEqual([{ asked: 400, content: 1280, landed: 400 }]);
});

test("a list that has its rows at its first layout is scrolled to its row with the header's size once the three layouts are in, whichever comes first", async () => {
  for (const order of [["viewportLaidOut", "headerLaidOut", "spacerLaidOut"], ["spacerLaidOut", "headerLaidOut", "viewportLaidOut"], ["headerLaidOut", "spacerLaidOut", "viewportLaidOut"]] as const) {
    const t = await mount({ count: 30 });
    for (const event of order) {
      expect(t.scrolls, `before ${event} of ${order.join(", ")}`).toEqual([]);
      t[event]();
      await settle(t.m);
    }
    expect(t.scrolls, order.join(", ")).toEqual([{ asked: 400, content: 1280, landed: 400 }]);
    started?.m.stopSurface(started.tag);
    started = undefined;
  }
});

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const mounted = (t: { byId(id: string): unknown }, count: number) => Array.from({ length: count }, (_, id) => t.byId(`r${id}`) !== undefined);
const keysViewed = (t: { app: { viewedBatches(): string[][] } }) => new Set(t.app.viewedBatches().flat());

test("a list whose whole content fits is not left at the offset it asked for: the scroll view cannot move and says nothing, so every row is mounted and reported (#138)", async () => {
  // An 80 dp header, ten rows of 40 dp, a viewport of 480, `initialScrollIndex` 8; the header and the spacer are laid out before the viewport.
  const t = await mount({ count: 10 }, { viewport: 480 });
  t.headerLaidOut();
  await settle(t.m);
  t.spacerLaidOut();
  await settle(t.m);
  expect(t.scrolls).toEqual([]);
  t.viewportLaidOut();
  await settle(t.m);
  // The command asks for 400 and the scroll view has 0 to give: it stays where it is, and no scroll event follows.
  expect(t.scrolls).toEqual([{ asked: 400, content: 480, landed: 0 }]);
  await wait(90);
  expect(mounted(t, 10)).toEqual(Array(10).fill(true));
  expect([...keysViewed(t)].sort((a, b) => Number(a) - Number(b))).toEqual(["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"]);
});

test("the footer is part of what the scroll view can scroll: a jump to the last row lands at the end of the footer, and the window is there before the event says so (#138)", async () => {
  // 80 + 30 * 40 + 40 = 1320 in a viewport of 120: the end is at 1200, and the last row's offset is 1240. The event is held back: it is the window the list chose that is read.
  const t = await mount({ count: 30, initialScrollIndex: 29, withFooter: true }, { footer: 40, events: "manual" });
  t.headerLaidOut();
  t.footerLaidOut();
  t.spacerLaidOut();
  t.viewportLaidOut();
  await settle(t.m);
  expect(t.scrolls).toEqual([{ asked: 1240, content: 1320, landed: 1200 }]);
  await wait(90);
  expect(t.app.viewedBatches().at(-1)).toEqual(["28", "29"]);
  t.deliver();
  await wait(90);
  expect(t.app.viewedBatches().at(-1)).toEqual(["28", "29"]);
});

test("a footer that fits with the rows leaves nothing to scroll to, and the list is at the top (#138)", async () => {
  const t = await mount({ count: 8, initialScrollIndex: 7, withFooter: true }, { viewport: 480, footer: 40 });
  t.headerLaidOut();
  t.footerLaidOut();
  t.spacerLaidOut();
  t.viewportLaidOut();
  await settle(t.m);
  // 80 + 320 + 40 = 440 in a viewport of 480: asked 360, landed 0, no event.
  expect(t.scrolls).toEqual([{ asked: 360, content: 440, landed: 0 }]);
  await wait(90);
  expect(mounted(t, 8)).toEqual(Array(8).fill(true));
  expect(keysViewed(t).size).toBe(8);
});

test("the inset after the content is part of it on iOS, which scrolls into it, and not on Android, which has none (#138)", async () => {
  for (const os of ["ios", "android"] as const) {
    const t = await mount({ count: 30, initialScrollIndex: 29, contentInset: { bottom: 40 } }, { inset: 40, os, events: "manual" });
    t.headerLaidOut();
    t.spacerLaidOut();
    t.viewportLaidOut();
    await settle(t.m);
    // iOS: 80 + 1200 + 40 - 120 = 1200; Android: 1160. The last row asks for 1240 on both.
    expect(t.scrolls, os).toEqual([{ asked: 1240, content: os === "ios" ? 1320 : 1280, landed: os === "ios" ? 1200 : 1160 }]);
    await wait(90);
    expect(t.app.viewedBatches().at(-1), os).toEqual(os === "ios" ? ["28", "29"] : ["27", "28", "29"]);
    started?.m.stopSurface(started.tag);
    started = undefined;
  }
});

test("the container's padding along the axis is part of the content (#138)", async () => {
  // paddingVertical 20 = 40 of content more; a number only, and the ends beat the pair.
  const t = await mount({ count: 30, initialScrollIndex: 29, contentPadding: { paddingVertical: 10, paddingBottom: 30 } }, { padding: 40, events: "manual" });
  t.headerLaidOut();
  t.spacerLaidOut();
  t.viewportLaidOut();
  await settle(t.m);
  expect(t.scrolls).toEqual([{ asked: 1240, content: 1320, landed: 1200 }]);
  await wait(90);
  expect(t.app.viewedBatches().at(-1)).toEqual(["28", "29"]);
});

test("along the horizontal axis the same: a list that fits is not left at its offset, and the footer, the padding and the viewport are widths (#138)", async () => {
  const fits = await mount({ count: 10, horizontal: true }, { viewport: 480, horizontal: true });
  fits.headerLaidOut();
  fits.spacerLaidOut();
  fits.viewportLaidOut();
  await settle(fits.m);
  expect(fits.scrolls).toEqual([{ asked: 400, content: 480, landed: 0 }]);
  await wait(90);
  expect(mounted(fits, 10)).toEqual(Array(10).fill(true));
  expect(keysViewed(fits).size).toBe(10);
  started?.m.stopSurface(started.tag);
  started = undefined;
  const footer = await mount({ count: 30, initialScrollIndex: 29, withFooter: true, horizontal: true, contentPadding: { paddingHorizontal: 5, paddingLeft: 10 } }, { footer: 40, padding: 15, horizontal: true, events: "manual" });
  footer.headerLaidOut();
  footer.footerLaidOut();
  footer.spacerLaidOut();
  footer.viewportLaidOut();
  await settle(footer.m);
  // 15 + 80 + 1200 + 40 = 1335 in 120: the end is at 1215; the last row is at 1240.
  expect(footer.scrolls).toEqual([{ asked: 1240, content: 1335, landed: 1215 }]);
  await wait(90);
  expect(footer.app.viewedBatches().at(-1)).toEqual(["28", "29"]);
});
