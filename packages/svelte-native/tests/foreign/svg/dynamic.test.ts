import { afterAll, beforeAll, expect, test } from "bun:test";
import { find, type FakeNode } from "../../foreign-harness.ts";
import { describeOurs, describeTheirs, settle, svgWorld, toNode, type Spec, type SvgLoaded } from "./support/harness.ts";
import { loadOracle } from "./support/oracle.ts";
import { resolve } from "node:path";

// The harnesses are made in `beforeAll`, outside the per-test restore of `support/preload.ts`: the file puts the global object back when it is done.
const world = svgWorld();
const fixture = (name: string) => resolve(import.meta.dirname, "fixtures", name);

/**
 * What changes after the first commit (SPEC.md, "react-native-svg"): a prop is a clone of the same Fabric node that carries the changed props only, text is
 * the `content` of a span or a span of its own, and the stops of a gradient are read again when one of them changes, appears or goes.
 */
type App = { show(node: unknown): void; update(node: unknown): void };
let loaded: SvgLoaded;
let app: App;
let roots: () => Record<number, FakeNode[]>;
let calls: string[];
const rootTag = 140;

beforeAll(async () => {
  const harness = await world.harness("android");
  loaded = await harness.load(fixture("svg-cases-fixture.svelte")) as SvgLoaded;
  app = loaded.startSurface(rootTag, loaded.Fixture, {}) as App;
  roots = harness.roots;
  calls = harness.calls;
}, 60_000);

const show = async (spec: Spec) => { app.show(toNode(spec)); await settle(loaded); calls.length = 0; };
const update = async (spec: Spec) => { calls.length = 0; app.update(toNode(spec)); await settle(loaded); };
const nodes = (name: string) => find(roots()[rootTag] ?? [], name);
const created = () => calls.filter((call) => call.startsWith("create"));

test("a changed prop is a clone of the same node", async () => {
  await show({ tag: "circle", props: { cx: 1, cy: 2, r: 5, fill: "red" } });
  const before = nodes("RNSVGCircle")[0];
  expect(before.props).toMatchObject({ cx: 1, cy: 2, r: 5 });
  await update({ tag: "circle", props: { cx: 1, cy: 2, r: 9, fill: "red" } });
  expect(created()).toEqual([]);
  expect(calls).toEqual(["cloneProps RNSVGCircle"]);
  const after = nodes("RNSVGCircle")[0];
  expect(after.tag).toBe(before.tag);
  expect(after.props.r).toBe(9);
});

/** The fixture draws text with the components themselves, as an app writes it: `<TSpan>{lone}</TSpan>`, `<Text>...</Text>`. */
type Words = { set(values: { lone?: string; word?: string; more?: boolean; name?: string; nested?: boolean }): void };
async function words(): Promise<{ app: Words; roots: () => FakeNode[]; calls: string[]; loaded: SvgLoaded }> {
  const harness = await world.harness("android");
  const text = await harness.load(fixture("svg-text-fixture.svelte")) as SvgLoaded;
  const surface = text.startSurface(141, text.Fixture, {}) as Words;
  return { app: surface, roots: () => harness.roots()[141] ?? [], calls: harness.calls, loaded: text };
}
const contents = (node: FakeNode): unknown[] => node.children.map((child) => (child.props.content === undefined ? child.name : child.props.content));

test("the text of a lone string is the content of its span and changes with it", async () => {
  const text = await words();
  const [span] = text.roots();
  expect(span?.name).toBe("RNSVGTSpan");
  expect(span?.props.content).toBe("one");
  expect(span?.children).toEqual([]);
  // What the library's `<TSpan x={1}>one</TSpan>` mounts (a JSX string child, not the array its XML renderer gives).
  const oracle = await loadOracle("android");
  expect([describeOurs(span as FakeNode)]).toEqual(describeTheirs([oracle.mount(oracle.create(oracle.tags.tspan, { x: 1 }, "one")) as never], text.loaded, "android"));
  text.calls.length = 0;
  text.app.set({ lone: "two" });
  await settle(loaded);
  expect(text.calls.filter((call) => call.startsWith("create"))).toEqual([]);
  expect(text.roots()[0]?.props.content).toBe("two");
  expect(text.roots()[0]?.tag).toBe(span?.tag);
});

test("a string in a text is a span of its own: updated in place, added and removed with the strings", async () => {
  const text = await words();
  const container = () => text.roots()[1] as FakeNode;
  expect(container().name).toBe("RNSVGText");
  const oracle = await loadOracle("android");
  expect([describeOurs(container())]).toEqual(describeTheirs([oracle.mount(oracle.create(oracle.tags.text, { y: 2 }, "a")) as never], text.loaded, "android"));
  const [first] = container().children;
  expect(contents(container())).toEqual(["a"]);
  text.calls.length = 0;
  text.app.set({ word: "b" });
  await settle(loaded);
  expect(text.calls.filter((call) => call.startsWith("create"))).toEqual([]);
  expect(contents(container())).toEqual(["b"]);
  expect(container().children[0]?.tag).toBe(first?.tag);
  text.app.set({ more: true });
  await settle(loaded);
  // The span of a `TSpan` element with a lone string has the string as its content; the string after it is a span of its own.
  expect(contents(container())).toEqual(["b", "c", "d"]);
  expect(container().children[0]?.tag).toBe(first?.tag);
  text.app.set({ more: false });
  await settle(loaded);
  expect(contents(container())).toEqual(["b"]);
});

test("a span whose lone string becomes mixed content loses its `content`, and gets it back", async () => {
  const text = await words();
  const outer = () => text.roots()[5] as FakeNode;
  const oracle = await loadOracle("android");
  expect(outer().props.content).toBe("a");
  expect(outer().children).toEqual([]);
  const tag = outer().tag;
  // `<TSpan>a{#if more}<TSpan>b</TSpan>{/if}</TSpan>` with `more` on: the "a" is a span of its own next to the inner `TSpan`, and the outer one has no `content` of its own (it drew "a" twice).
  text.app.set({ nested: true });
  await settle(loaded);
  expect(outer().tag).toBe(tag);
  expect(outer().props.content ?? null).toBeNull();
  expect(contents(outer())).toEqual(["a", "b"]);
  expect([describeOurs(outer())]).toEqual(describeTheirs([oracle.mount(oracle.create(oracle.tags.tspan, null, "a", oracle.create(oracle.tags.tspan, null, "b"))) as never], text.loaded, "android"));
  text.app.set({ nested: false });
  await settle(loaded);
  expect(outer().props.content).toBe("a");
  expect(outer().children).toEqual([]);
});

test("one text node is one span: `Hello {name}!` is a single string", async () => {
  const text = await words();
  const hello = text.roots()[2] as FakeNode;
  expect(contents(hello)).toEqual(["Hello world!"]);
  text.app.set({ name: "there" });
  await settle(loaded);
  expect(contents(text.roots()[2] as FakeNode)).toEqual(["Hello there!"]);
});

test("spans on their own lines are spans, with the whitespace between them as text, as in HTML", async () => {
  const text = await words();
  const lines = text.roots()[3] as FakeNode;
  expect(lines.children.map((child) => child.props.content)).toEqual(["one", " ", "two"]);
});

test("a text path takes its text as spans too", async () => {
  const text = await words();
  const path = text.roots()[4] as FakeNode;
  expect(path.name).toBe("RNSVGTextPath");
  expect(path.props.href).toBe("curve");
  expect(contents(path)).toEqual(["Along world"]);
});

test("the first commit of a gradient has its stops, and a changed, added or removed stop is read again", async () => {
  const stop = (offset: number | string, stopColor: string, stopOpacity?: number): Spec => ({ tag: "stop", props: { offset, stopColor, ...(stopOpacity === undefined ? {} : { stopOpacity }) } });
  app.show(toNode({ tag: "linearGradient", props: { id: "g" }, children: [stop(1, "#0000ff"), stop(0, "#ff0000")] }));
  await settle(loaded);
  // `gradient` is offset, colour pairs in order of offset; the colours are processColor's, with the stop opacity in the alpha byte.
  expect(nodes("RNSVGLinearGradient")[0]?.props.gradient).toEqual([0, -65536, 1, -16776961]);
  calls.length = 0;
  await update({ tag: "linearGradient", props: { id: "g" }, children: [stop(1, "#0000ff"), stop(0, "#00ff00")] });
  expect(created()).toEqual([]);
  expect(nodes("RNSVGLinearGradient")[0]?.props.gradient).toEqual([0, -16711936, 1, -16776961]);
  await update({ tag: "linearGradient", props: { id: "g" }, children: [stop(1, "#0000ff"), stop(0.5, "#ffffff", 0.5), stop(0, "#00ff00")] });
  expect(nodes("RNSVGLinearGradient")[0]?.props.gradient).toEqual([0, -16711936, 0.5, 0x80ffffff | 0, 1, -16776961]);
  await update({ tag: "linearGradient", props: { id: "g" }, children: [stop(0, "#00ff00")] });
  expect(nodes("RNSVGLinearGradient")[0]?.props.gradient).toEqual([0, -16711936]);
  // The stops draw nothing: no node of their own.
  expect(nodes("RNSVGLinearGradient")[0]?.children).toEqual([]);
});

test("the nodes of a merge are read again as well", async () => {
  await show({ tag: "feMerge", children: [{ tag: "feMergeNode", props: { in: "a" } }] });
  expect(nodes("RNSVGFeMerge")[0]?.props.nodes).toEqual(["a"]);
  await update({ tag: "feMerge", children: [{ tag: "feMergeNode", props: { in: "a" } }, { tag: "feMergeNode", props: { in: "b" } }] });
  expect(nodes("RNSVGFeMerge")[0]?.props.nodes).toEqual(["a", "b"]);
});

test("a merge node or a stop that arrives late lands at its place in the document, not last", async () => {
  const harness = await world.harness("android");
  const order = await harness.load(fixture("svg-order-fixture.svelte")) as SvgLoaded;
  const surface = order.startSurface(142, order.Fixture, {}) as { set(values: { middle?: boolean; first?: boolean }): void };
  const tree = () => harness.roots()[142] ?? [];
  const merge = () => find(tree(), "RNSVGFeMerge")[0]?.props.nodes;
  const line = () => find(tree(), "RNSVGLinearGradient")[0]?.props.gradient;
  const round = () => find(tree(), "RNSVGRadialGradient")[0]?.props.gradient;
  const [red, green, blue] = [-65536, -16711936, -16776961];
  expect(merge()).toEqual(["a", "c"]);
  expect(line()).toEqual([0, red, 0, blue]);
  expect(round()).toEqual([1, red, 1, blue]);
  // In the middle of the merge, and between two stops of one offset (the sort by offset keeps the document order of equal ones).
  surface.set({ middle: true });
  await settle(order);
  await settle(order);
  expect(merge()).toEqual(["a", "b", "c"]);
  expect(line()).toEqual([0, red, 0, green, 0, blue]);
  // At the front of both.
  surface.set({ first: true });
  await settle(order);
  await settle(order);
  expect(merge()).toEqual(["z", "a", "b", "c"]);
  expect(round()).toEqual([1, green, 1, red, 1, blue]);
  surface.set({ middle: false, first: false });
  await settle(order);
  await settle(order);
  expect(merge()).toEqual(["a", "c"]);
  expect(line()).toEqual([0, red, 0, blue]);
  expect(round()).toEqual([1, red, 1, blue]);
});

test("a tag that changes in place replaces the component", async () => {
  await show({ tag: "rect", props: { width: 3, height: 3 } });
  expect(nodes("RNSVGRect").length).toBe(1);
  await update({ tag: "ellipse", props: { rx: 3, ry: 2 } });
  expect(nodes("RNSVGRect")).toEqual([]);
  expect(nodes("RNSVGEllipse")[0]?.props).toMatchObject({ rx: 3, ry: 2 });
});

test("a drawing that animates nothing does not load the animation layer", async () => {
  const text = await words();
  expect(text.roots().length).toBeGreaterThan(0);
  expect((globalThis as { __svelteFabric?: { stats(): { animationLoaded: boolean } } }).__svelteFabric?.stats().animationLoaded).toBe(false);
});

// The harness is created in `beforeAll`, outside the per-test restore of `support/preload.ts`: the file puts the global object back itself.
afterAll(() => world.restore());
