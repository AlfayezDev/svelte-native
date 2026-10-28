import { test, expect } from "bun:test";
import { compile } from "svelte/compiler";
import lowerDefault, { lower, lowerPrimitives } from "../src/lower.ts";

const imp = `<script>\n  import { View, Text, Pressable, ScrollView, Image, ActivityIndicator, SafeAreaView, TextInput } from "@rasheed/svelte-native";\n</script>\n`;
const run = (markup: string, header = imp) => lowerPrimitives(header + markup, { filename: "x.svelte", warn: () => {} }).slice(header.length);

test("acceptance: keyed rows lower to host tags", () => {
  const source = `{#each rows as row, i (row.id)}\n  <View style={rowStyle} onLayout={(e) => seen(e)}><Text style={t}>Row {i}</Text></View>\n{/each}`;
  expect(run(source)).toBe(`{#each rows as row, i (row.id)}\n  <native-view nativeStyle={rowStyle} onLayout={(e) => seen(e)}><native-text nativeStyle={t}>Row {i}</native-text></native-view>\n{/each}`);
});

test("compiled acceptance fixture has host tags and no component calls", () => {
  const source = `<script>\n  import { View, Text } from "@rasheed/svelte-native";\n  let { rows } = $props();\n  const rowStyle = {}; const t = {};\n</script>\n{#each rows as row, i (row.id)}\n  <View style={rowStyle} onLayout={() => {}}><Text style={t}>Row {i}</Text></View>\n{/each}`;
  const code = (lowered: string) => compile(lowered, { filename: "f.svelte", generate: "client", runes: true, experimental: { customRenderer: "@rasheed/svelte-native/renderer" } }).js.code;
  const output = code(lowerPrimitives(source));
  expect(output).toContain("native-view");
  expect(output).toContain("native-text");
  expect(output).not.toMatch(/\bView\(|\bText\(/);
  expect(code(source)).toMatch(/\bView\(/);
});

test("nested, self-closing, aliases, spreads, bind:this, class and id", () => {
  const header = `<script>\n  import { View as V, Image, ActivityIndicator } from "@rasheed/svelte-native";\n</script>\n`;
  expect(run(`<V {...rest} bind:this={el} class="a" id="b" testID="c" ref={fn}><V /></V>\n<Image source={s} />\n<ActivityIndicator\n  size="large"\n/>`, header))
    .toBe(`<native-view {...rest} bind:this={el} class="a" id="b" testID="c" ref={fn}><native-view ></native-view></native-view>\n<native-image source={s} ></native-image>\n<native-spinner\n  size="large"\n></native-spinner>`);
});

test("every mapped primitive", () => {
  const out = run(`<View/><Text/><ScrollView></ScrollView><Image/><ActivityIndicator/><Pressable></Pressable>`);
  expect(out).toBe(`<native-view></native-view><native-text></native-text><native-scroll></native-scroll><native-image></native-image><native-spinner></native-spinner><native-pressable></native-pressable>`);
});

test("nested Text inside Text lowers both", () => {
  expect(run(`<Text>a <Text style={b}>b</Text></Text>`)).toBe(`<native-text>a <native-text nativeStyle={b}>b</native-text></native-text>`);
});

test("lowered inside and outside a snippet", () => {
  expect(run(`{#snippet row(x)}<View>{x}</View>{/snippet}\n<View>{@render row(1)}</View>`))
    .toBe(`{#snippet row(x)}<native-view>{x}</native-view>{/snippet}\n<native-view>{@render row(1)}</native-view>`);
});

test("never lowers behavioural components, svelte:component or unrelated imports", () => {
  const markup = `<TextInput bind:value={v} /><svelte:component this={View}><Text>x</Text></svelte:component>`;
  const out = run(markup);
  expect(out).toContain("<TextInput bind:value={v} />");
  expect(out).toContain("<svelte:component this={View}>");
  expect(out).toContain("<native-text>x</native-text>");
  const local = `<script>\n  import View from "./View.svelte";\n  import { Text } from "other";\n</script>\n<View><Text>x</Text></View>`;
  expect(lowerPrimitives(local)).toBe(local);
});

test("Pressable lowers only without a style function or parameterised children", () => {
  expect(run(`<Pressable onPress={go} style={{ padding: 1 }}>x</Pressable>`)).toBe(`<native-pressable onPress={go} nativeStyle={{ padding: 1 }}>x</native-pressable>`);
  const fn = `<Pressable style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1 })}>x</Pressable>`;
  expect(run(fn)).toBe(fn);
  const named = `<Pressable style={styleFn}>x</Pressable>`;
  expect(run(named)).toBe(named);
  const snippet = `<Pressable>{#snippet children({ pressed })}<Text>{pressed}</Text>{/snippet}</Pressable>`;
  expect(run(snippet)).toBe(snippet.replace("<Text>", "<native-text>").replace("</Text>", "</native-text>"));
});

test("bindings other than this and let: directives keep the component", () => {
  const source = `<View bind:clientWidth={w}>x</View>`;
  expect(run(source)).toBe(source);
});

test("directives are left alone and warned about", () => {
  const warnings: string[] = [];
  const source = `${imp}<View use:tap transition:fade>x</View>`;
  const out = lowerPrimitives(source, { filename: "d.svelte", warn: (m) => warnings.push(m) });
  expect(out).toContain("<native-view use:tap transition:fade>x</native-view>");
  expect(warnings).toHaveLength(2);
});

test("TypeScript scripts parse and stay untouched; line numbers are stable", () => {
  const header = `<script lang="ts">\n  import { View, type ViewProps } from "@rasheed/svelte-native";\n  let { a }: { a: ViewProps; b?: Array<string> } = $props();\n  const x = <T,>(v: T): T => v;\n</script>\n`;
  const source = `${header}<View style={a.style}>\n  hi\n</View>\n`;
  const out = lowerPrimitives(source);
  expect(out.startsWith(header)).toBe(true);
  expect(out.split("\n")).toHaveLength(source.split("\n").length);
  expect(out).toContain("<native-view nativeStyle={a.style}>");
});

test("fast path and parse errors return the input unchanged", () => {
  const plain = `<View>x</View>`;
  expect(lowerPrimitives(plain)).toBe(plain);
  const broken = `${imp}<View><Text></View>`;
  expect(lowerPrimitives(broken)).toBe(broken);
});

test("preprocessor object", () => {
  expect(lowerDefault).toBe(lower);
  expect(lower.markup({ content: "<p/>", filename: "a.svelte" })).toBeUndefined();
  expect(lower.markup({ content: `${imp}<View/>` , filename: "a.svelte" })?.code).toContain("<native-view></native-view>");
});

test("valueless attributes stay boolean true on lowered tags", () => {
  const source = `<script>\n  import { ScrollView } from "@rasheed/svelte-native";\n</script>\n<ScrollView nestedScrollEnabled horizontal={false}>x</ScrollView>`;
  expect(lowerPrimitives(source)).toContain(`<native-scroll nestedScrollEnabled={true} horizontal={false}>x</native-scroll>`);
});

test("what the svg entry exports as Text and Image is not lowered: they are SVG elements, not the primitives", () => {
  const header = `<script>\n  import { View } from "@rasheed/svelte-native";\n  import { Svg, Text, Image as SvgImage, Text as Label } from "@rasheed/svelte-native/svg";\n</script>\n`;
  const markup = `<View><Svg><Text x={1}>a</Text><SvgImage href="x" /><Label>b</Label></Svg></View>`;
  expect(run(markup, header)).toBe(`<native-view><Svg><Text x={1}>a</Text><SvgImage href="x" /><Label>b</Label></Svg></native-view>`);
  // The other entries still lower: a subpath that exports a primitive is the package's own.
  const core = `<script>\n  import { Text } from "@rasheed/svelte-native/core";\n</script>\n`;
  expect(run(`<Text>a</Text>`, core)).toBe(`<native-text>a</native-text>`);
});
