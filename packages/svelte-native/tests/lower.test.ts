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

test("nested, self-closing, aliases, bind:this and id", () => {
  const header = `<script>\n  import { View as V, Image, ActivityIndicator } from "@rasheed/svelte-native";\n</script>\n`;
  expect(run(`<V bind:this={el} id="b" testID="c" ref={fn}><V /></V>\n<Image source={s} />\n<ActivityIndicator\n  size="large"\n/>`, header))
    .toBe(`<native-view bind:this={el} id="b" testID="c" ref={fn}><native-view ></native-view></native-view>\n<native-image source={s} ></native-image>\n<native-spinner\n  size="large"\n></native-spinner>`);
});

test("a press handler that may be undefined is passed as nativeOnPress; one written as a function stays an event", () => {
  // Svelte compiles `onPress={enabled ? go : undefined}` to a listener that stays on the node and does nothing while it is undefined (see `PRESS_HANDLERS` in lower.ts).
  expect(run(`<Text onPress={enabled ? go : undefined} onPressIn={handler} onPressOut={maybe?.out} onLongPress={() => hold()} onPressChange={function (p) { held = p; }} />`))
    .toBe(`<native-text nativeOnPress={enabled ? go : undefined} nativeOnPressIn={handler} nativeOnPressOut={maybe?.out} onLongPress={() => hold()} onPressChange={function (p) { held = p; }} ></native-text>`);
  // A shorthand keeps its braces; other events and a handler string are untouched; a spread sends every attribute through `set_attributes`, which removes a nullish handler's listener itself.
  expect(run(`<Pressable {onPress} onLayout={maybe}>x</Pressable>`)).toBe(`<native-pressable nativeOnPress={onPress} onLayout={maybe}>x</native-pressable>`);
  expect(run(`<View {...rest} onPress={enabled ? go : undefined} />`)).toContain(`<native-view {...__svelteNativeSpread(rest)} onPress={enabled ? go : undefined} ></native-view>`);
  // Compiled, the handler is a prop of the element and not an event listener.
  const compiled = compile(lowerPrimitives(`<script>\n  import { Text } from "@rasheed/svelte-native";\n  let { go } = $props();\n</script>\n<Text onPress={go} />`), { filename: "f.svelte", generate: "client", runes: true, experimental: { customRenderer: "@rasheed/svelte-native/renderer" } }).js.code;
  expect(compiled).toContain("nativeOnPress");
  expect(compiled).not.toContain("$.event(");
});

/** The markup after the script, whatever the lowering put into the script (a helper import). */
const markup = (out: string) => out.slice(out.indexOf("</script>\n") + "</script>\n".length);

test("class and class:name on a lowered tag become one nativeClass, worked out by the renderer's hostClass", () => {
  const lowered = (source: string) => lowerPrimitives(imp + source, { filename: "c.svelte", warn: () => {} });
  const out = lowered(`<View class="card p-4" testID="a"><Text class={[tone, on && "bold"]}>x</Text></View>`);
  expect(out.startsWith(`<script> ${helperImport("hostClass as __svelteNativeClass")}\n`)).toBe(true);
  expect(markup(out)).toBe("<native-view nativeClass={__svelteNativeClass(`card p-4`)} testID=\"a\"><native-text nativeClass={__svelteNativeClass([tone, on && \"bold\"])}>x</native-text></native-view>");
  // A quoted value with expressions is a template literal; a backtick and a backslash in its text are escaped (a `{` in markup always opens an expression).
  // biome-ignore lint/suspicious/noTemplateCurlyInString: the expected output is the source of a template literal
  expect(markup(lowered("<View class=\"a {size} b-[`x`]\\$\" />"))).toBe("<native-view nativeClass={__svelteNativeClass(`a ${(size) ?? \"\"} b-[\\`x\\`]\\\\$`)} ></native-view>");
  // `class:name` toggles join the class value as an object, in one nativeClass where the `class` was (the first directive without one); the directives are removed.
  expect(markup(lowered(`<View class:selected class="row" class:dim={!on} />`))).toBe("<native-view  nativeClass={__svelteNativeClass([`row`, { \"selected\": selected, \"dim\": !on }])}  ></native-view>");
  expect(markup(lowered(`<View class:active={on} />`))).toBe(`<native-view nativeClass={__svelteNativeClass({ "active": on })} ></native-view>`);
  // Next to a spread, toggles without a class go before every spread, and every spread gets them for a class it may carry.
  expect(markup(lowered(`<View {...p} class:loud={on} testID="t" />`))).toBe(`<native-view nativeClass={__svelteNativeClass({ "loud": on })} {...__svelteNativeSpread(p, { "loud": on })}  testID="t" ></native-view>`);
  expect(markup(lowered(`<View class="k" {...p} class:loud={on} />`))).toBe("<native-view nativeClass={__svelteNativeClass([`k`, { \"loud\": on }])} {...__svelteNativeSpread(p, { \"loud\": on })}  ></native-view>");
  // A component that stays a component gets its class as a prop (createNativeProps).
  expect(markup(lowered(`<Pressable class="a" style={fn} />`))).toBe(`<Pressable class="a" style={fn} />`);
});

test("a tag that has a style hands it to hostClass with the class: the font size it sets is what a font-relative class is made from", () => {
  const lowered = (source: string) => markup(lowerPrimitives(imp + source, { filename: "c.svelte", warn: () => {} }));
  expect(lowered(`<Text class="leading-none" style={{ fontSize: 30 }} />`)).toBe("<native-text nativeClass={__svelteNativeClass(`leading-none`, { fontSize: 30 })} nativeStyle={{ fontSize: 30 }} ></native-text>");
  expect(lowered(`<Text style={s} class={["a", on && "b"]} class:c={d} />`)).toBe(`<native-text nativeStyle={s} nativeClass={__svelteNativeClass([["a", on && "b"], { "c": d }], s)}  ></native-text>`);
  expect(lowered(`<View {style} class="a" />`)).toBe("<native-view {style} nativeClass={__svelteNativeClass(`a`, style)} ></native-view>");
  // A quoted style is a string: it sets no size, and is not passed.
  expect(lowered(`<Text class="a" style="color: red" />`)).toBe("<native-text nativeClass={__svelteNativeClass(`a`)} nativeStyle=\"color: red\" ></native-text>");
  // No class, no call.
  expect(lowered(`<Text style={s} />`)).toBe("<native-text nativeStyle={s} ></native-text>");
});

test("compiled, a lowered class is a hostClass call in the element's template effect and never Svelte's set_class", () => {
  const source = `<script>\n  import { View } from "@rasheed/svelte-native";\n  let { tone } = $props();\n</script>\n<View class={["card", tone]} />\n<View class="fixed" />`;
  const code = compile(lowerPrimitives(source), { filename: "f.svelte", generate: "client", runes: true, experimental: { customRenderer: "@rasheed/svelte-native/renderer" } }).js.code;
  expect(code).toContain("__svelteNativeClass(");
  expect(code).toContain("nativeClass");
  expect(code).not.toMatch(/set_class|clsx/);
});

const helperImport = (names: string) => `import { ${names} } from "@rasheed/svelte-native/renderer";`;

test("spreads: the spread and the attributes beside it are wrapped, so a function-valued ref survives Svelte's set_attributes", () => {
  const source = `${imp}<View {...rest} bind:this={el} class="a" id="b" testID="c" ref={fn} onLayout={go} style={s} width={3} animated={a.b} {shorthand} {...(on ? p : q)}><View /></View>\n<Image source={s} />`;
  const out = lowerPrimitives(source, { filename: "s.svelte", warn: () => {} });
  // One import, on the line of the opening tag: no line below moves.
  expect(out.startsWith(`<script> ${helperImport("hostClass as __svelteNativeClass, hostSpread as __svelteNativeSpread, hostValue as __svelteNativeValue")}\n`)).toBe(true);
  expect(out.split("\n")).toHaveLength(source.split("\n").length);
  expect(out.slice(out.indexOf("<native-view"))).toBe(
    "<native-view {...__svelteNativeSpread(rest)} bind:this={el} nativeClass={__svelteNativeClass(`a`, s)} id=\"b\" testID=\"c\" ref={__svelteNativeValue(fn)} onLayout={go} nativeStyle={s} width={3} animated={__svelteNativeValue(a.b)} shorthand={__svelteNativeValue(shorthand)} {...(__svelteNativeSpread(on ? p : q))}><native-view ></native-view></native-view>\n<native-image source={s} ></native-image>",
  );
});

test("no spread, no helper and no import; a component that stays a component keeps its spread", () => {
  const plain = run(`<View ref={fn} {x} testID="a" />`);
  expect(plain).toBe(`<native-view ref={fn} {x} testID="a" ></native-view>`);
  expect(lowerPrimitives(`${imp}<View ref={fn} />`, { warn: () => {} })).not.toContain("renderer");
  const stays = run(`<TextInput {...rest} />`);
  expect(stays).toBe(`<TextInput {...rest} />`);
  expect(lowerPrimitives(`${imp}<TextInput {...rest} />`, { warn: () => {} })).toBe(`${imp}<TextInput {...rest} />`);
});

test("the helper import goes into a module script when the file has no instance script", () => {
  const source = `<script module lang="ts">\n  import { View } from "@rasheed/svelte-native";\n  export const probe = () => ({ ref: () => {} });\n</script>\n<View {...probe()} />`;
  const out = lowerPrimitives(source, { warn: () => {} });
  expect(out.startsWith(`<script module lang="ts"> ${helperImport("hostSpread as __svelteNativeSpread")}\n`)).toBe(true);
  expect(out).toContain("<native-view {...__svelteNativeSpread(probe())} ></native-view>");
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
  expect(run(`<Pressable onPress={go} style={{ padding: 1 }}>x</Pressable>`)).toBe(`<native-pressable nativeOnPress={go} nativeStyle={{ padding: 1 }}>x</native-pressable>`);
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
