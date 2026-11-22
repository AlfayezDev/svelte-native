import { expect, test } from "bun:test";
import { compile } from "svelte/compiler";
import { componentOptions } from "../../src/compile-options.ts";
import { LOWERED_TAGS, lowerPrimitives } from "../../src/lower.ts";

/** What the lowering of the primitives leaves alone (the components that take snippets) and what it passes on to Svelte's compiler (the transition directives). */
const noop = () => {};

test("Screen, Stack and Tabs stay components: they take snippets, so the lowering preprocessor must not rewrite them", () => {
  expect(Object.hasOwn(LOWERED_TAGS, "Screen")).toBe(false);
  expect(Object.hasOwn(LOWERED_TAGS, "Stack")).toBe(false);
  expect(Object.hasOwn(LOWERED_TAGS, "Tabs")).toBe(false);
  const source = `<script>\n  import { Screen, Stack, Tabs, View } from "expo-svelte";\n</script>\n<Screen title="x">{#snippet headerRight()}<View />{/snippet}</Screen>\n<Stack header={{ large: true }}>{@render children()}</Stack>\n<Tabs items={items} selected={s} content={pane} />`;
  const lowered = lowerPrimitives(source, { filename: "x.svelte", warn: noop });
  expect(lowered).toContain('<Screen title="x">');
  expect(lowered).toContain("<native-view ></native-view>");
  expect(lowered).toContain("<Stack header={{ large: true }}>");
  expect(lowered).toContain("<Tabs items={items}");
});

const imports = `<script>\n  import { View, Text, Image } from "expo-svelte";\n  import { fade, fly, scale } from "svelte/transition";\n  import { flip } from "svelte/animate";\n  let { rows = [] } = $props();\n</script>\n`;

test("a lowered View, Text and Image take the directives through to the compiled host tags", () => {
  const source = `${imports}<View in:fly={{ y: 20 }} out:fade style={{ padding: 4 }}><Text transition:scale={{ start: 0.5 }}>x</Text></View>\n{#each rows as row (row)}<Image animate:flip={{ duration: 200 }} in:fade source={row} />{/each}`;
  const lowered = lowerPrimitives(source);
  expect(lowered).toContain("<native-view in:fly={{ y: 20 }} out:fade nativeStyle={{ padding: 4 }}>");
  const code = compile(lowered, componentOptions("transitions.svelte")).js.code;
  expect(code).toContain("$.transition(1, native_view, () => fly, () => ({ y: 20 }));");
  expect(code).toContain("$.transition(2, native_view, () => fade);");
  expect(code).toContain("$.transition(3, native_text, () => scale, () => ({ start: 0.5 }));");
  expect(code).toContain("$.animation(native_image, () => flip, () => ({ duration: 200 }));");
  expect(code).toContain("$.transition(1, native_image, () => fade);");
  expect(code).not.toMatch(/\bView\(|\bText\(|\bImage\(/);
});
