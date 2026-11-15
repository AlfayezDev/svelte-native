import { afterEach, expect, test } from "bun:test";
import type { AnimLog } from "../reanimated-stubs.ts";
import { type FakeNode as HarnessNode, all, fake as base, flat, host, load, settle, textOf } from "../html-harness.ts";
import { type Layout, type LayoutNode as FakeNode, attachLayout } from "../support/layout-host.ts";
import { resolve } from "node:path";

// Svelte's transitions on HTML elements: the lowering turns `<div in:fly>` into a native view that keeps the directive, and the host plays it. What the two do together: an element that is made
// again as another component while its transition runs, an outro on a span of a paragraph, `animate:flip` on `<li>`, and the text style an element gives its children while it fades.
const A = () => (globalThis as unknown as { __anim: AnimLog }).__anim;
/**
 * The harness's binding with a layout read, and Reanimated's registry put over every commit (its commit hook) and emptied for a tag that was marked removable and is in no tree (its mount
 * hook). The harness shares its binding with other files, so the layout is taken off again when a test ends.
 */
let layout: Layout | undefined;
afterEach(() => { layout?.detach(); layout = undefined; });

type Tx = { setOn(value: boolean): void; setShown(value: boolean): void; setBold(value: boolean): void; setItems(value: number[]): void; setFaded(value: boolean): void; setColor(value: string): void; setEvented(value: boolean): void; heard(): string[] };
let surface = 700;
async function mount(fixture = "transitions-html-fixture.svelte") {
  delete (globalThis as { __anim?: unknown }).__anim;
  host.roots = {};
  layout = attachLayout({ fake: base, get roots() { return host.roots; }, calls: [] }, { absolute: false, transforms: false });
  const m = await load(resolve(import.meta.dirname, "fixtures", fixture));
  // The host warns in development. Set after the harness took its snapshot of the global object, so its restore takes it away again.
  (globalThis as { __DEV__?: boolean }).__DEV__ = true;
  const tag = ++surface;
  m.startSurface(tag, m.Fixture, {});
  await settle(m);
  const tx = (globalThis as unknown as { __tx: Tx }).__tx;
  const byID = (testID: string) => {
    const found = all(host.roots[tag] ?? []).find((node) => node.props.testID === testID);
    if (!found) throw new Error(`no node ${testID}`);
    return found as FakeNode;
  };
  return { m, tx, byID, tag };
}

const timings = () => (A().timings ?? []).filter((timing) => timing.config.duration !== 16);
type Timing = NonNullable<AnimLog["timings"]>[number];
const isAcknowledgement = (mapper: AnimLog["mappers"][number]) => String(mapper.worklet).includes("scheduleOnRN");
const live = () => A().mappers.filter((mapper) => !mapper.stopped && !isAcknowledgement(mapper));
const frame = () => { for (const mapper of A().mappers.filter((entry) => !entry.stopped)) mapper.worklet(); };
const progressOf = (timing: Timing) => timing.mutable as { _value: number };
const forgotten = (tag: number) => A().removable.filter((wrapper) => (wrapper as { tag?: number }).tag === tag);
/** What a mapper writes to the view of a tag: the one that writes to the latest descriptor set the tag was added to. */
function write(tag: number, mutable?: { _value: number }, progress?: number): Record<string, unknown> {
  const id = A().descriptors.findLast((entry) => entry.adds.some((add) => add.tag === tag))?.id;
  for (const mapper of live()) {
    if (mutable && progress !== undefined) mutable._value = progress;
    const before = A().updates.length;
    mapper.worklet(true);
    const last = A().updates.slice(before).at(-1);
    if ((last?.descriptors as { id: number } | undefined)?.id === id) return last?.values ?? {};
  }
  throw new Error(`no live mapper writes to the node with tag ${tag}`);
}

test("an element made again while its transition runs (a span of a run, then a text of its own) lets the old view go, is not drawn as a span, and is drawn again from where the transition is", async () => {
  const warn = console.warn;
  console.warn = () => {}; // the span's warning is the next test's
  try { await remade(); } finally { console.warn = warn; }
});

async function remade() {
  const { m, tx, byID } = await mount();
  tx.setShown(true);
  await settle(m);
  const first = byID("remade");
  expect(first.name).toBe("RCTText");
  expect(flat(first.props.style).opacity).toBe(0); // the first frame of in:fade
  expect(first.props.collapsable).toBe(false);
  const timing = timings()[0] as Timing;
  expect(timing.config.duration).toBe(100);
  write(first.tag, progressOf(timing), 0.5); // the UI thread draws it half way, and Reanimated keeps what it wrote
  expect(A().registry?.get(first.tag)?.opacity).toBeCloseTo(0.5, 2);

  // Text beside it: it is a span of the run now, another component with another tag. The old view's animation is let go of; the transition goes on, and nothing is drawn for a span.
  tx.setOn(true);
  await settle(m);
  const second = byID("remade");
  expect(second.name).toBe("RCTVirtualText");
  expect(second.tag).not.toBe(first.tag);
  expect(second.props.collapsable).toBeUndefined();
  expect(flat(second.props.style).opacity).toBeUndefined();
  expect(live()).toHaveLength(0);
  expect(forgotten(first.tag)).toHaveLength(1); // its shadow node is marked removable, so the registry of the old tag goes with the next mount
  expect(A().registry?.get(first.tag)).toBeUndefined();
  expect(timing.cancelled).toBe(false);
  expect((second.target as { getAnimations(): unknown[] }).getAnimations().length).toBeGreaterThan(0);

  // The text is gone: a text of its own again, drawn from where the transition is (half way: opacity 0.5) by a worklet for its new tag.
  tx.setOn(false);
  await settle(m);
  const third = byID("remade");
  expect(third.name).toBe("RCTText");
  expect(third.tag).not.toBe(second.tag);
  expect(flat(third.props.style).opacity).toBeCloseTo(0.5, 2);
  expect(third.props.collapsable).toBe(false);
  expect(live()).toHaveLength(1);
  expect(write(third.tag, progressOf(timing), 0.75).opacity as number).toBeCloseTo(0.75, 2);

  // It ends, the node's own values are written back, and the registry of the tag it has now is let go of, once.
  progressOf(timing)._value = 1;
  timing.callback?.(true);
  await settle(m);
  frame();
  await settle(m);
  expect(live()).toHaveLength(0);
  expect(forgotten(third.tag)).toHaveLength(1);
  expect(flat(byID("remade").props.style).opacity).toBeUndefined();
}

test("an out: on an element inside a paragraph runs its length and draws nothing: no worklet for a span, one warning, and the text goes when the outro ends", async () => {
  const warnings: string[] = [];
  const warn = console.warn;
  console.warn = (...args: unknown[]) => { warnings.push(args.join(" ")); };
  try {
    const { m, tx, byID } = await mount();
    expect(textOf(byID("para"))).toBe("Hello world!");
    tx.setBold(false);
    await settle(m);
    // Svelte keeps the node until the outro ends.
    const bold = byID("bold");
    expect(bold.name).toBe("RCTVirtualText");
    expect(textOf(byID("para"))).toBe("Hello world!");
    expect(bold.props.collapsable).toBeUndefined();
    expect(flat(bold.props.style).opacity).toBeUndefined();
    expect(live()).toHaveLength(0);
    const timing = timings().at(-1) as Timing;
    expect(timing.config.duration).toBe(100);
    progressOf(timing)._value = 1;
    timing.callback?.(true);
    await settle(m);
    expect(textOf(byID("para"))).toBe("Hello !");
    expect(all(host.roots[surface] ?? []).some((node) => node.props.testID === "bold")).toBe(false);
    expect(forgotten(bold.tag)).toHaveLength(0); // no view, nothing in the registry to forget
    expect(warnings.filter((warning) => warning.includes("not drawn"))).toHaveLength(1);
  } finally {
    console.warn = warn;
  }
});

/** A list of three items `animate:flip`s when its order changes: each moves from where it was (a view with its transform in the first commit and a worklet for it), and the flips end in identity. */
async function flips(fixture?: string) {
  const { m, tx, byID } = await mount(fixture);
  tx.setItems([3, 1, 2]);
  await settle(m);
  const transformOf = (id: string) => flat(byID(id).props.style).transform;
  expect(byID("item-3").name).toBe("RCTView");
  // Item 3 was third (y = 100) and is first (y = 0); items 1 and 2 moved down a row.
  expect(transformOf("item-3")).toEqual([{ translateX: 0 }, { translateY: 100 }, { scaleX: 1 }, { scaleY: 1 }]);
  expect(transformOf("item-1")).toEqual([{ translateX: 0 }, { translateY: -50 }, { scaleX: 1 }, { scaleY: 1 }]);
  expect(byID("item-3").props.collapsable).toBe(false);
  expect(live()).toHaveLength(3);
  // The flips end: the items are their own again, and each one's registry is let go of.
  for (const timing of timings().filter((entry) => entry.config.duration === 300)) { progressOf(timing)._value = 1; timing.callback?.(true); }
  await settle(m);
  frame();
  await settle(m);
  expect(live()).toHaveLength(0);
  for (const id of ["item-1", "item-2", "item-3"]) {
    expect(flat(byID(id).props.style).transform ?? []).toEqual([]);
    expect(forgotten(byID(id).tag)).toHaveLength(1);
  }
}

// Svelte's `<svelte:element>` hands the `animate:` of everything that renders with it (the first render of its children) to the effect around it, so a keyed each that renders inside one never measures its items.
// What the library renders itself is written with its elements for that: the last two put a page in the `native-stack` of a screen and of a router, in the first render of both.
test.each([
  ["<li> in a keyed each", undefined],
  ["the first render of a page in a screen of its own (the screen's native-stack is not a <svelte:element>)", "transitions-screen-fixture.svelte"],
  ["the first render of a page in the router's stack (the router's native-stack is not a <svelte:element>)", "transitions-router-fixture.svelte"],
] as const)("animate:flip on %s moves each item from where it was: a view with its transform in the first commit and a worklet for it", async (_where, fixture) => {
  await flips(fixture);
});

test("the text style an element gives its children stays theirs while it fades in, follows the element when it changes meanwhile, and the fade's values never reach the children", async () => {
  const { m, tx, byID } = await mount();
  tx.setFaded(true);
  await settle(m);
  const inherited = { color: "red", fontSize: 20 };
  expect(flat(byID("fading").props.style)).toMatchObject({ ...inherited, opacity: 0 });
  expect(flat(byID("fading-child").props.style)).toEqual(inherited);
  // The element's text style changes while the fade runs: the child follows, and the fade is not disturbed.
  tx.setColor("blue");
  await settle(m);
  expect(flat(byID("fading-child").props.style)).toEqual({ color: "blue", fontSize: 20 });
  expect(flat(byID("fading").props.style)).toMatchObject({ color: "blue", fontSize: 20, opacity: 0 });
  expect(live()).toHaveLength(1);
  // The fade ends: the element is its own, and its children keep the style.
  const timing = timings().at(-1) as Timing;
  progressOf(timing)._value = 1;
  timing.callback?.(true);
  await settle(m);
  frame();
  await settle(m);
  expect(flat(byID("fading").props.style).opacity).toBeUndefined();
  expect(flat(byID("fading").props.style)).toMatchObject({ color: "blue", fontSize: 20 });
  expect(flat(byID("fading-child").props.style)).toEqual({ color: "blue", fontSize: 20 });
  expect(live()).toHaveLength(0);
});

test("onintrostart, onintroend, onoutrostart and onoutroend on an HTML element are not warned about, and run as the element's transitions begin and end", async () => {
  const { m, tx, byID } = await mount();
  // The lowering of the fixture, which has them on a <div>, said nothing about them (the harness collects what it warned about).
  expect(host.warnings.filter((warning) => /never runs on a device/.test(warning))).toEqual([]);
  tx.setEvented(true);
  await settle(m);
  expect(byID("evented").name).toBe("RCTView");
  expect(tx.heard()).toEqual(["introstart"]);
  const intro = timings().at(-1) as Timing;
  progressOf(intro)._value = 1;
  intro.callback?.(true);
  await settle(m);
  expect(tx.heard()).toEqual(["introstart", "introend"]);
  tx.setEvented(false);
  await settle(m);
  expect(tx.heard()).toEqual(["introstart", "introend", "outrostart"]);
  const outro = timings().at(-1) as Timing;
  progressOf(outro)._value = 1;
  outro.callback?.(true);
  await settle(m);
  expect(tx.heard()).toEqual(["introstart", "introend", "outrostart", "outroend"]);
});
