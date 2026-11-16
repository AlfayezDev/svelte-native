import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { baseStubs, load, src } from "../support/bundle.ts";
import { type FakeNode, settle } from "../support/host.ts";
import { fakeHost } from "../support/fake-host.ts";

/**
 * `Text` keeps the whitespace it is given, as React Native's `Text` does: a sentence split across source lines reaches the native text with its line break and the next line's
 * indent, where a browser would show one space. (Svelte's compiler trims what sits at the edges of an element's content and turns a whitespace-only gap between two nodes into one
 * space; it leaves the rest of a text as written, and in a browser it is CSS that collapses it.) This pins that behaviour, documented in REFERENCE.md ("Text") and the README ("Coming from
 * Svelte on the web"), so a change to it is a decision: the pattern for a long sentence is `{"one long string"}` or one source line.
 */
const host = fakeHost();

/** The fixture is lowered the way Metro's transformer does it: the primitives become host tags first. */
const mount = () => load<{ startSurface: typeof import("../../src/fabric/host.ts").startSurface; tick: () => Promise<void>; Fixture: never }>({
  entry: `import Fixture from ${JSON.stringify(resolve(import.meta.dirname, "fixtures/text-whitespace-fixture.svelte"))};
    import { startSurface } from ${JSON.stringify(src("fabric/host.ts"))};
    import { tick } from 'svelte';
    export { startSurface, tick, Fixture };`,
  // The fixture's `import { Text } from "@alfayez/svelte-native"` is lowered to `<native-text>` and the import is then unused.
  stubs: { ...baseStubs(), "@alfayez/svelte-native": "export const Text = null;" },
  lower: {},
});

/** The text of each `RCTText` that is not inside another one, with what is inside nested ones in the order they were written. */
const textsOf = (nodes: FakeNode[]): string[][] => nodes.flatMap((node) => {
  if (node.name === "RCTText") return [node.children.flatMap((child) => (child.name === "RCTRawText" ? [String(child.props.text)] : child.name === "RCTVirtualText" ? child.children.map((inner) => String(inner.props.text)) : []))];
  return textsOf(node.children);
});

test("a sentence split across source lines reaches the native text with its line break and indent", async () => {
  const m = await mount();
  const app = m.startSurface(21, m.Fixture, {}) as { rename(next: string): void };
  const texts = textsOf(host.roots[21]);
  // Lowered `Text` and the `Text` component alike.
  expect(texts[0]).toEqual(["A sentence that is split\n    across two source lines."]);
  expect(texts[1]).toEqual(["The same through\n    the component."]);
  // An expression is part of the same string; the interior whitespace is as written.
  expect(texts[2]).toEqual(["Hello Ada,\n    welcome   back."]);
  app.rename("Grace");
  await settle(m);
  expect(textsOf(host.roots[21])[2]).toEqual(["Hello Grace,\n    welcome   back."]);
});

test("what Svelte's compiler trims stays trimmed: the edges of the content, and a whitespace-only gap becomes one space", async () => {
  const m = await mount();
  m.startSurface(22, m.Fixture, {});
  const texts = textsOf(host.roots[22]);
  // The recommended pattern for a long sentence: one string, no line break in it.
  expect(texts[3]).toEqual(["one long string"]);
  // Spaces around the content of one line are dropped; the line breaks around a nested `Text` are one space each.
  expect(texts[4]).toEqual(["padded on one line"]);
  expect(texts[5]).toEqual(["Before ", "nested", " after."]);
  // The other way to wrap a long sentence in the source: a string built from pieces has no line break in it.
  expect(texts[6]).toEqual(["A long sentence written over two source lines."]);
});
