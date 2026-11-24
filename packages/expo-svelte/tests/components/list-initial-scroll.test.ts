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
const viewport = 120;
const header = 80;
let surface = 970;
let started: { m: Module; tag: number } | undefined;
afterEach(() => {
  fake.dispatchCommand = original;
  if (started) started.m.stopSurface(started.tag);
  started = undefined;
});

async function mount(props: Record<string, unknown>) {
  const m = await load(fixture);
  host.roots = {};
  const tag = ++surface;
  const app = m.startSurface(tag, m.Fixture, { initialScrollIndex: 8, ...props }) as { setCount(count: number): void };
  started = { m, tag };
  await settle(m);
  const tree = () => all(host.roots[tag] ?? []);
  const byId = (testID: string) => tree().find((node) => node.props.testID === testID);
  const scroller = () => tree().find((node) => node.name === "RCTScrollView") as FakeNode;
  const headerWrapper = () => tree().find((node) => node.children.some((child) => child.props.testID === "header")) as FakeNode;
  // The spacer: the view whose style is a height and nothing else (the rows' wrappers are placed, the header's has no style, the scroll content's is a list).
  const styleOf = (node: FakeNode) => node.props.style as { height?: unknown; position?: unknown } | null | undefined;
  const spacer = () => tree().find((node) => node.name === "RCTView" && !Array.isArray(node.props.style) && typeof styleOf(node)?.height === "number" && styleOf(node)?.position === undefined) as FakeNode;
  const spacerHeight = () => (styleOf(spacer())?.height as number | undefined) ?? 0;
  const scrolls: { asked: number; landed: number; content: number }[] = [];
  fake.dispatchCommand = ((node: FakeNode, command: string, args: unknown[]) => {
    if (command === "scrollTo") {
      const content = header + spacerHeight();
      scrolls.push({ asked: args[1] as number, content, landed: Math.min(args[1] as number, Math.max(0, content - viewport)) });
    }
    original(node, command, args);
  }) as typeof fake.dispatchCommand;
  const layout = (node: FakeNode, width: number, height: number) => emit(node.target, "topLayout", { layout: { x: 0, y: 0, width, height } });
  return {
    m, app, scrolls, byId, spacer, spacerHeight,
    viewportLaidOut: () => layout(scroller(), 300, viewport),
    headerLaidOut: () => layout(headerWrapper(), 300, header),
    /** The platform's report of the spacer, which follows the commit that has it. */
    spacerLaidOut: () => layout(spacer(), 300, spacerHeight()),
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
