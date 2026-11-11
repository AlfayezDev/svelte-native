import { test, expect } from "bun:test";
import { resolve } from "node:path";
import { compile } from "svelte/compiler";
import { lowersHtml } from "../src/compile-options.ts";
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
    .toBe(`<native-view ref={(__ref) => (el = __ref)} id="b" testID="c" ref={fn}><native-view ></native-view></native-view>\n<native-image source={s} ></native-image>\n<native-spinner\n  size="large"\n></native-spinner>`);
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
    "<native-view {...__svelteNativeSpread(rest)} ref={__svelteNativeValue((__ref) => (el = __ref))} nativeClass={__svelteNativeClass(`a`, s)} id=\"b\" testID=\"c\" ref={__svelteNativeValue(fn)} onLayout={go} nativeStyle={s} width={3} animated={__svelteNativeValue(a.b)} shorthand={__svelteNativeValue(shorthand)} {...(__svelteNativeSpread(on ? p : q))}><native-view ></native-view></native-view>\n<native-image source={s} ></native-image>",
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

// HTML elements ------------------------------------------------------------------------------------------------------------------------------------------------------
// `lowerPrimitives(..., { html: true })` is what the Metro transformer runs for the app's own files (`lowersHtml`); `lower-html.ts` is the mapping.

const html = (source: string, options: { filename?: string; warn?: (message: string) => void } = {}) => lowerPrimitives(source, { filename: "page.svelte", warn: () => {}, ...options, html: true });
/** What the marker of an HTML element and its class helper are called is not what most of these tests are about: `plain` takes them out (the raw output has them, see "an HTML element is marked"). */
const plainHtml = (code: string) => code.replaceAll(" nativeHtml={true}", "").replaceAll("__svelteNativeHtmlClass", "__svelteNativeClass");
/** The markup after the script(s), whatever the lowering put into the script. */
const body = (source: string) => { const out = html(source); const end = out.lastIndexOf("</script>"); return plainHtml(end < 0 ? out : out.slice(end + "</script>".length).replace(/^\n/, "")); };
const compiled = (lowered: string) => compile(lowered, { filename: "/app/page.svelte", generate: "client", runes: true, experimental: { customRenderer: "@rasheed/svelte-native/renderer" } }).js.code;

test("HTML is left alone unless the caller asks (the web build, svelte-check and a svelte.config.js preprocessor see the markup as written)", () => {
  const source = `<script>\n  let { go } = $props();\n</script>\n<div class="a" onclick={go}><p>text</p><button>x</button><table></table></div>`;
  expect(lowerPrimitives(source, { filename: "page.svelte" })).toBe(source);
  expect(lower.markup({ content: source, filename: "page.svelte" })).toBeUndefined();
  expect(html(source.replace("<table></table>", ""))).not.toBe(source.replace("<table></table>", ""));
});

test("div, section, header, footer, main, nav, article, aside, ul, ol, li, form, label, figure and fieldset are views", () => {
  for (const name of "div section header footer main nav article aside ul ol li label figure fieldset dl dd".split(" ")) {
    expect(body(`<${name} class="x"></${name}>`), name).toBe("<native-view nativeClass={__svelteNativeClass(`x`)}></native-view>");
  }
  // A form is a view that knows it is one: its submit buttons and the inputs in it find it by `nativeForm`.
  expect(body(`<form class="x" onsubmit={save}></form>`)).toBe("<native-view nativeForm={true} nativeClass={__svelteNativeClass(`x`)} onsubmit={save}></native-view>");
  expect(body(`<div />`)).toBe("<native-view ></native-view>");
});

test("p, span, h1 to h6, strong, b, em, i, small, code, blockquote and figcaption are texts; headings are headers", () => {
  for (const name of "p span strong b em i small code blockquote figcaption dt mark kbd time abbr s u del ins q cite sub sup var samp dfn data".split(" ")) expect(body(`<${name}>x</${name}>`), name).toBe("<native-text>x</native-text>");
  for (const level of [1, 2, 3, 4, 5, 6]) expect(body(`<h${level}>x</h${level}>`), `h${level}`).toBe(`<native-text accessibilityRole="header">x</native-text>`);
  // The role the author wrote wins, and nothing is added next to a role.
  expect(body(`<h2 accessibilityRole="none">x</h2>`)).toBe(`<native-text accessibilityRole="none">x</native-text>`);
  expect(body(`<h2 role="heading" aria-level="2">x</h2>`)).toBe(`<native-text role="heading" aria-level="2">x</native-text>`);
});

test("a button is a pressable with the button role: onclick is onPress, type is dropped, disabled also dims it for the screen reader", () => {
  expect(body(`<button type="submit" onclick={go} class="b" disabled={busy}>Save</button>`))
    .toBe("<native-pressable accessibilityRole=\"button\" aria-disabled={busy}  onPress={(__event) => __svelteNativeClick(__event, go, (__event) => __svelteNativeSubmit(__event, undefined))} nativeClass={__svelteNativeClass(`b`)} disabled={busy}><native-text>Save</native-text></native-pressable>");
  // A button submits its form unless it says it is not a submit button; the press hook is the same one.
  const submit = (type: string) => `onPress={(__event) => __svelteNativeClick(__event, undefined, (__event) => __svelteNativeSubmit(__event, ${type}))}`;
  expect(body(`<button disabled>x</button>`)).toBe(`<native-pressable accessibilityRole="button" aria-disabled={true} ${submit("undefined")} disabled={true}><native-text>x</native-text></native-pressable>`);
  expect(body(`<button type={kind}>x</button>`)).toBe(`<native-pressable accessibilityRole="button" ${submit("kind")} ><native-text>x</native-text></native-pressable>`);
  expect(body(`<button type="button">x</button>`)).toBe(`<native-pressable accessibilityRole="button" ><native-text>x</native-text></native-pressable>`);
  expect(body(`<button type="reset" onclick={clear}>x</button>`)).toBe(`<native-pressable accessibilityRole="button"  onPress={clear}><native-text>x</native-text></native-pressable>`);
  // What the author said about the state or the role stands.
  expect(body(`<button aria-disabled="false" disabled role="tab" type="button">x</button>`)).toBe(`<native-pressable aria-disabled="false" disabled={true} role="tab" ><native-text>x</native-text></native-pressable>`);
});

test("onclick is onPress on every mapped element; a view with a handler is a pressable, a text stays a text", () => {
  expect(body(`<div onclick={go}>a</div>`)).toBe(`<native-pressable onPress={go}><native-text>a</native-text></native-pressable>`);
  expect(body(`<li onclick={() => pick(i)}><b>x</b></li>`)).toBe(`<native-pressable onPress={() => pick(i)}><native-text>x</native-text></native-pressable>`);
  expect(body(`<span onclick={go}>a</span>`)).toBe(`<native-text onPress={go}>a</native-text>`);
  expect(body(`<p {onclick}>a</p>`)).toBe(`<native-text onPress={onclick}>a</native-text>`);
  // The directive is the same event; a forwarding `on:click` has no handler to rename; the other events pass through as they are.
  expect(body(`<div on:click={go} onpointerdown={down} onLayout={size}></div>`)).toBe(`<native-pressable onPress={go} onpointerdown={down} onLayout={size}></native-pressable>`);
  expect(body(`<div on:click></div>`)).toBe(`<native-view on:click></native-view>`);
});

test("an <a> with an href presses to the router's link: a path goes to goto, another scheme to the platform; the instance script gets the call", () => {
  const out = html(`<script>\n  let id = 1;\n</script>\n<a href="/settings" class="link">Settings</a>`);
  expect(out.startsWith(`<script> ${helperImport("hostClick as __svelteNativeClick, hostHtmlClass as __svelteNativeHtmlClass")} import { useLink as __svelteNativeUseLink } from "@rasheed/svelte-native/router"; const __svelteNativeLink = __svelteNativeUseLink();\n  let id = 1;`)).toBe(true);
  expect(plainHtml(markup(out))).toBe("<native-pressable accessibilityRole=\"link\" onPress={(__event) => __svelteNativeClick(__event, undefined, () => __svelteNativeLink(\"/settings\"))}  nativeClass={__svelteNativeClass(`link`)}><native-text>Settings</native-text></native-pressable>");
  // A dynamic or interpolated href, and an `onclick` of its own that runs first: the link is followed after it, unless it called `preventDefault`.
  expect(body(`<script>let id = 1;</script><a href={url} onclick={log}>x</a>`)).toBe("<native-pressable accessibilityRole=\"link\"  onPress={(__event) => __svelteNativeClick(__event, log, () => __svelteNativeLink(url))}><native-text>x</native-text></native-pressable>");
  // biome-ignore lint/suspicious/noTemplateCurlyInString: the expected output is the source of a template literal
  expect(body(`<script>let id = 1;</script><a href="/posts/{id}?x=1">x</a>`)).toContain("__svelteNativeLink(`/posts/${(id) ?? \"\"}?x=1`)");
  // Without an href it is a pressable link role with only its own handler; an href alone with no instance script gets one.
  expect(body(`<a onclick={go}>x</a>`)).toBe(`<native-pressable accessibilityRole="link" onPress={go}><native-text>x</native-text></native-pressable>`);
  const bare = html(`<a href="https://example.com">x</a>`);
  expect(bare.startsWith(`<script>import { hostClick as __svelteNativeClick } from "@rasheed/svelte-native/renderer"; import { useLink as __svelteNativeUseLink } from "@rasheed/svelte-native/router"; const __svelteNativeLink = __svelteNativeUseLink();</script><native-pressable`)).toBe(true);
  expect(bare).not.toContain("href");
});

test("an <a> inside text is a press on the text, so a sentence with a link stays one text", () => {
  expect(body(`<p>Read the <a href="/terms">terms</a>.</p>`))
    .toBe(`<native-text>Read the <native-text accessibilityRole="link" onPress={(__event) => __svelteNativeClick(__event, undefined, () => __svelteNativeLink("/terms"))} >terms</native-text>.</native-text>`);
  // Text beside a link in a view is one line of its own, and the link is part of it.
  expect(body(`<div>See <a href="/x">this</a> now</div>`))
    .toBe(`<native-view><native-text>See <native-text accessibilityRole="link" onPress={(__event) => __svelteNativeClick(__event, undefined, () => __svelteNativeLink("/x"))} >this</native-text> now</native-text></native-view>`);
  // A link that stands alone in a view is a pressable around its text.
  expect(body(`<li><a href="/x">this</a></li>`)).toBe(`<native-view><native-pressable accessibilityRole="link" onPress={(__event) => __svelteNativeClick(__event, undefined, () => __svelteNativeLink("/x"))} ><native-text>this</native-text></native-pressable></native-view>`);
});

test("an <img> is a native image: src is the source (a string its uri, anything else as it is), width and height are numbers, onload and onerror the native events", () => {
  expect(body(`<img src="/logo.png" alt="Logo" width="40" height="30px" class="r" />`))
    .toBe("<native-image source={{ uri: \"/logo.png\" }} alt=\"Logo\" width={40} height={30} nativeClass={__svelteNativeClass(`r`)} ></native-image>");
  expect(body(`<img src={photo.url} width="50%" height={h}>`)).toBe(`<native-image source={__svelteNativeSource(photo.url)} width="50%" height={h}></native-image>`);
  // biome-ignore lint/suspicious/noTemplateCurlyInString: the expected output is the source of a template literal
  expect(body(`<img src="/a/{id}.png" onload={done} onerror={failed} />`)).toContain("source={__svelteNativeSource(`/a/${(id) ?? \"\"}.png`)} onLoad={done} onError={failed}");
  expect(body(`<img {src} />`)).toBe(`<native-image source={__svelteNativeSource(src)} ></native-image>`);
  // Next to a spread the image's own attributes are not boxed (the spread helper keeps a function a function).
  expect(body(`<img {...rest} src="/a.png" onload={done} />`)).toBe(`<native-image {...__svelteNativeWebSpread(rest)} source={{ uri: "/a.png" }} onLoad={done} ></native-image>`);
});

test("an <input> is a TextInput: its type is the keyboard, bind:value stays, oninput gets the web's event and disabled is editable", () => {
  // Enter in a single-line input submits the form above it (`hostSubmit`): the hook is in each of them, and is not what most of these are about.
  const input = (source: string) => body(`<script>let v = $state("");</script>${source}`).replace(" onSubmitEditing={(__event) => __svelteNativeSubmit(__event)}", "");
  expect(input(`<input bind:value={v} placeholder="Name" maxlength="12" />`)).toBe(`<SvelteNativeTextInput bind:value={v} placeholder="Name" maxLength={12} />`);
  expect(input(`<input type="email" bind:value={v}>`)).toBe(`<SvelteNativeTextInput keyboardType="email-address" autoComplete="email" autoCapitalize="none"  bind:value={v} />`);
  expect(input(`<input type="password" bind:value={v} />`)).toBe(`<SvelteNativeTextInput secureTextEntry={true} autoComplete="password" autoCapitalize="none"  bind:value={v} />`);
  for (const [type, props] of Object.entries({ number: `keyboardType="numeric"`, search: `returnKeyType="search"`, url: `keyboardType="url" autoCapitalize="none"`, tel: `keyboardType="phone-pad" autoComplete="tel"`, text: "" })) {
    expect(input(`<input type="${type}" />`), type).toBe(`<SvelteNativeTextInput${props ? ` ${props}` : ""}  />`);
  }
  // What the author wrote for a prop the type implies wins (no duplicate attribute), and a type that is an expression is worked out when it changes.
  expect(input(`<input type="email" autocomplete="off" />`)).toBe(`<SvelteNativeTextInput keyboardType="email-address" autoCapitalize="none"  autoComplete="off" />`);
  expect(input(`<input type={show ? "text" : "password"} bind:value={v} />`)).toBe(`<SvelteNativeTextInput {...__svelteNativeInputType(show ? "text" : "password")}  bind:value={v} />`);
  expect(input(`<input disabled readonly autofocus inputmode="numeric" enterkeyhint="done" onfocus={f} onblur={b}>`))
    .toBe(`<SvelteNativeTextInput editable={false} readOnly autoFocus inputMode="numeric" enterKeyHint="done" onFocus={f} onBlur={b} />`);
  expect(input(`<input disabled={!on} oninput={(e) => (v = e.currentTarget.value)} onchange={saved} />`))
    .toBe(`<SvelteNativeTextInput editable={!(!on)} onChangeText={(__text) => ((e) => (v = e.currentTarget.value))?.(__svelteNativeInputEvent("input", __text))} onEndEditing={(__event) => (saved)?.(__svelteNativeInputEvent("change", __event?.nativeEvent?.text))} />`);
  expect(input(`<input on:input={typed} />`)).toBe(`<SvelteNativeTextInput onChangeText={(__text) => (typed)?.(__svelteNativeInputEvent("input", __text))} />`);
  // `bind:this` is the host handle, through `ref`.
  expect(input(`<input bind:this={field} bind:value={v} />`)).toBe(`<SvelteNativeTextInput ref={(__ref) => (field = __ref)} bind:value={v} />`);
});

test("a <textarea> is a multiline TextInput; rows are its lines, and it has a closing tag", () => {
  expect(body(`<textarea bind:value={v} rows="4" placeholder="Notes"></textarea>`)).toBe(`<SvelteNativeTextInput multiline={true} bind:value={v} numberOfLines={4} placeholder="Notes"></SvelteNativeTextInput>`);
  expect(body(`<textarea bind:value={v} />`)).toBe(`<SvelteNativeTextInput multiline={true} bind:value={v} />`);
});

test("an <input type=checkbox> is a Switch: checked is its value, bind:checked binds it, onchange gets the web's event; the form's value is dropped", () => {
  expect(body(`<input type="checkbox" bind:checked={on} value="yes" name="n" disabled onchange={(e) => seen(e.currentTarget.checked)}>`))
    .toBe(`<SvelteNativeSwitch  bind:value={on}  name="n" disabled onValueChange={(__value) => ((e) => seen(e.currentTarget.checked))?.(__svelteNativeInputEvent("change", __value))} />`);
  expect(body(`<input type="checkbox" checked />`)).toBe(`<SvelteNativeSwitch  value={true} />`);
  expect(body(`<input type="checkbox" checked={on} bind:this={box} />`)).toBe(`<SvelteNativeSwitch  value={on} ref={(__ref) => (box = __ref)} />`);
  expect(body(`<input type="checkbox" bind:checked />`)).toBe(`<SvelteNativeSwitch  bind:value={checked} />`);
});

test("a <dialog> is a Modal that is visible while it is open; bind:open closes it with the platform's own dismissal", () => {
  expect(body(`<dialog open={shown} onclose={closed}>x</dialog>`)).toBe(`<SvelteNativeModal visible={shown} onRequestClose={closed}><native-text>x</native-text></SvelteNativeModal>`);
  expect(body(`<dialog open>x</dialog>`)).toBe(`<SvelteNativeModal visible={true}><native-text>x</native-text></SvelteNativeModal>`);
  expect(body(`<dialog><div>x</div></dialog>`)).toBe(`<SvelteNativeModal visible={false}><native-view><native-text>x</native-text></native-view></SvelteNativeModal>`);
  expect(body(`<dialog bind:open={shown} onclose={closed}></dialog>`)).toBe(`<SvelteNativeModal onRequestClose={(__event) => { shown = false; (closed)?.(__event); }} visible={shown} ></SvelteNativeModal>`);
});

test("the components the elements need are imported under names of their own, from the package's core entry", () => {
  const out = html(`<script lang="ts">\n  import { TextInput } from "@rasheed/svelte-native";\n  let v = $state("");\n</script>\n<input bind:value={v} /><input type="checkbox" /><dialog></dialog>`);
  expect(out.startsWith(`<script lang="ts"> ${helperImport("hostSubmit as __svelteNativeSubmit")} import { Modal as SvelteNativeModal, Switch as SvelteNativeSwitch, TextInput as SvelteNativeTextInput } from "@rasheed/svelte-native/core";\n`)).toBe(true);
  // The file's own `TextInput` is the author's: it stays a component.
  const own = html(`<script>\n  import { TextInput } from "@rasheed/svelte-native";\n</script>\n<TextInput bind:value={v} /><input bind:value={v} />`);
  expect(plainHtml(markup(own)).replace(" onSubmitEditing={(__event) => __svelteNativeSubmit(__event)}", "")).toBe(`<TextInput bind:value={v} /><SvelteNativeTextInput bind:value={v} />`);
});

test("where the generated imports and the call go: the instance script, the module script of a file that has no instance one, or a script of their own", () => {
  const module = `<script module lang="ts">\n  export const label: string = "x";\n</script>\n`;
  // A helper import is an import, which a module script can hold (as for the primitives): the file's own scripts are all there are.
  const withHelper = html(`${module}<img src={url} />`);
  expect(withHelper.startsWith(`<script module lang="ts"> ${helperImport("hostSource as __svelteNativeSource")}\n`)).toBe(true);
  // The call of `useLink` runs for each component instance, so it needs an instance script: one is written on the first line, and nothing below it moves.
  const withLink = html(`${module}<a href="/x">x</a>`);
  expect(withLink.startsWith(`<script>${helperImport("hostClick as __svelteNativeClick")} import { useLink as __svelteNativeUseLink } from "@rasheed/svelte-native/router"; const __svelteNativeLink = __svelteNativeUseLink();</script><script module lang="ts">\n`)).toBe(true);
  expect(withLink.split("\n")).toHaveLength(`${module}<a href="/x">x</a>`.split("\n").length);
  expect(compiled(withLink)).toContain("__svelteNativeLink");
  expect(compiled(html(`<script lang="ts">\n  let { go }: { go: (event: Event) => void } = $props();\n</script>\n<a href="/x" onclick={(event: Event) => go(event)}>x</a>`))).toContain("__svelteNativeLink");
});

test("text directly in a view-like element is a native-text of its own, with the whitespace Svelte keeps for a written Text", () => {
  expect(body(`<div>Hello</div>`)).toBe(`<native-view><native-text>Hello</native-text></native-view>`);
  expect(body(`<div>\n  Hello {name}!\n</div>`)).toBe(`<native-view><native-text>\n  Hello {name}!\n</native-text></native-view>`);
  // An expression alone is text; a block's text is wrapped where the block is.
  expect(body(`<li>{item.name}</li>`)).toBe(`<native-view><native-text>{item.name}</native-text></native-view>`);
  expect(body(`<div>{#if on}Shown{:else}Hidden{/if}</div>`)).toBe(`<native-view>{#if on}<native-text>Shown</native-text>{:else}<native-text>Hidden</native-text>{/if}</native-view>`);
  expect(body(`<div>{#each rows as row}{row}{/each}</div>`)).toBe(`<native-view>{#each rows as row}<native-text>{row}</native-text>{/each}</native-view>`);
  // Text and inline elements are one line; an element that is not inline ends it.
  expect(body(`<div>One <b>two</b> three<p>four</p>five</div>`)).toBe(`<native-view><native-text>One <native-text>two</native-text> three</native-text><native-text>four</native-text><native-text>five</native-text></native-view>`);
  // Whitespace and comments between elements are not text; elements alone are not wrapped.
  expect(body(`<div>\n  <span>a</span>\n  <!-- c -->\n  <span>b</span>\n</div>`)).toBe(`<native-view>\n  <native-text>a</native-text>\n  <!-- c -->\n  <native-text>b</native-text>\n</native-view>`);
  // `&nbsp;` is text.
  expect(body(`<div><span>a</span>&nbsp;</div>`)).toBe(`<native-view><native-text><native-text>a</native-text>&nbsp;</native-text></native-view>`);
});

test("text in a text, in a component's children, in a snippet and in the document is not wrapped", () => {
  expect(body(`<p>one {two} <em>three</em></p>`)).toBe(`<native-text>one {two} <native-text>three</native-text></native-text>`);
  expect(body(`<p>{#if on}shown{/if}</p>`)).toBe(`<native-text>{#if on}shown{/if}</native-text>`);
  expect(body(`<script>import { Screen } from "@rasheed/svelte-native";</script>text {x}\n<Screen>inside {y}<div>z</div></Screen>{#snippet s()}bare{/snippet}`))
    .toBe(`text {x}\n<Screen>inside {y}<native-view><native-text>z</native-text></native-view></Screen>{#snippet s()}bare{/snippet}`);
  // A host tag written by hand is the author's; the elements inside it are still lowered.
  expect(body(`<native-view>text<div>x</div></native-view>`)).toBe(`<native-view>text<native-view><native-text>x</native-text></native-view></native-view>`);
  // `<svelte:head>` is the document's: nothing of it is drawn, and nothing in it is an error.
  expect(body(`<svelte:head><title>T</title><meta name="a" content="b"></svelte:head><div />`)).toBe(`<svelte:head><title>T</title><meta name="a" content="b"></svelte:head><native-view ></native-view>`);
});

test("class, class:, style, spreads and ref carry over as on a lowered View; bind:this is a ref", () => {
  expect(body(`<div class="a {b}" class:on style={s} {...rest} id="x" aria-label="l">t</div>`))
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the expected output is the source of a template literal
    .toBe("<native-view nativeClass={__svelteNativeClass([`a ${(b) ?? \"\"}`, { \"on\": on }], s)}  nativeStyle={s} {...__svelteNativeWebSpread(rest, { \"on\": on })} id=\"x\" aria-label=\"l\"><native-text>t</native-text></native-view>");
  expect(body(`<p class="t" style={{ fontSize: 20 }} {onclick} hidden>x</p>`)).toBe("<native-text nativeClass={__svelteNativeClass(`t`, { fontSize: 20 })} nativeStyle={{ fontSize: 20 }} onPress={onclick} hidden={true}>x</native-text>");
  expect(body(`<div bind:this={el} id="a"></div>`)).toBe(`<native-view ref={(__ref) => (el = __ref)} id="a"></native-view>`);
  expect(body(`<div {...rest} bind:this={el} ref={other}></div>`)).toBe(`<native-view {...__svelteNativeWebSpread(rest)} ref={__svelteNativeValue((__ref) => (el = __ref))} ref={__svelteNativeValue(other)}></native-view>`);
  // The View a file imports from the package takes the same paths beside the HTML.
  const mixed = html(`<script>\n  import { View } from "@rasheed/svelte-native";\n</script>\n<View class="v"><div class="d">x</div></View>`);
  expect(markup(mixed)).toBe("<native-view nativeClass={__svelteNativeClass(`v`)}><native-view nativeHtml={true} nativeClass={__svelteNativeHtmlClass(`d`)}><native-text nativeHtml={true}>x</native-text></native-view></native-view>");
});

test("a spread's handlers are the native ones: onclick is onPress", () => {
  expect(body(`<button {...rest}>x</button>`)).toContain("{...__svelteNativeWebSpread(rest)}");
  expect(html(`<button {...rest}>x</button>`)).toContain("hostWebSpread as __svelteNativeWebSpread");
});

test("an HTML element with no native equivalent fails the build, naming the element, the file, the line and what to use", () => {
  const source = `<script>\n  let v = 1;\n</script>\n<div>\n  <table class="t">\n    <tr><td>x</td></tr>\n  </table>\n</div>\n<svg viewBox="0 0 1 1"><path d="M0 0" /></svg>`;
  let message = "";
  try {
    html(source, { filename: "src/lib/Grid.svelte" });
  } catch (error) {
    message = (error as Error).message;
  }
  expect(message).toStartWith("2 HTML elements or attributes have no native equivalent:");
  expect(message).toContain("src/lib/Grid.svelte:5:3 <table> is not supported on native: tables have no native equivalent");
  expect(message).toContain("src/lib/Grid.svelte:9:1 <svg> is not supported on native: SVG is react-native-svg here");
  // The elements inside a table or an svg are not reported again.
  expect(message).not.toContain("<tr>");
  expect(message).not.toContain("<path>");
  // One problem is the message itself.
  expect(() => html(`<div>\n  <select><option>1</option></select>\n</div>`, { filename: "a.svelte" })).toThrow(/^a\.svelte:2:3 <select> is not supported on native: there is no native select/);
  for (const [element, hint] of Object.entries({ canvas: "draw with the SVG components", video: "`Video`", iframe: "`WebView`", details: "`div`", bdi: "`span`", progress: "`ActivityIndicator`", select: "list of `button`s" })) {
    expect(() => html(`<${element}></${element}>`), element).toThrow(new RegExp(`page\\.svelte:1:1 <${element}> is not supported on native: .*${hint.replace(/[`.]/g, "\\$&")}`));
  }
});

test("what an input, a div or a button cannot do on native is an error too: the types, bind: and style:", () => {
  const failure = (source: string): string => { try { html(source); } catch (error) { return (error as Error).message; } return ""; };
  expect(failure(`<input type="radio" name="r">`)).toMatch(/^page\.svelte:1:1 <input type="radio"> is not supported on native: there is no native radio/);
  expect(failure(`<input type="range" />`)).toContain("<input type=\"range\"> is not supported");
  expect(failure(`<input type="date" />`)).toContain("DateTimePicker");
  expect(failure(`<input type="file" />`)).toContain("expo-document-picker");
  expect(failure(`<input type="checkbox" bind:group={g} />`)).toContain("bind:group on <input> is not supported on native");
  expect(failure(`<div bind:clientWidth={w}></div>`)).toBe("page.svelte:1:6 bind:clientWidth on <div> is not supported on native: measure with `onLayout`");
  expect(failure(`<p style:color={c}>x</p>`)).toBe("");
  expect(failure(`<input class:big={on} />`)).toContain("class:big on <input> is not supported on native");
  // A type the browser does not know is a text input there, and here.
  expect(failure(`<input type="whatever" />`)).toBe("");
});

test("line numbers are stable: every line of the markup keeps its content, so an error of the compiler points where the source says", () => {
  const source = [
    `<script lang="ts">`, `  let { rows } = $props();`, `  let v = $state("");`, `</script>`,
    `<div class="card"`, `  id="line-5-card"`, `  onclick={() => {`, `    pick();`, `  }}>`,
    `  Hello {rows.length}`, `  <h1 id="line-10">Title</h1>`, `  <a`, `    href="/x"`, `    id="line-13"`, `  >Go</a>`,
    `  <img src="/a.png"`, `       alt="line-16" id="line-16" />`,
    `  <input id="line-17" type="text"`, `    bind:value={v}`, `    oninput={(e) => {`, `      v = e.currentTarget.value;`, `    }}`, `  />`,
    `  <dialog id="line-23" open>x</dialog>`, `</div>`, ``,
  ];
  const out = html(source.join("\n"));
  const lowered = out.split("\n");
  expect(lowered).toHaveLength(source.length);
  // The same text on the same line: a marker of the source is on its line of the output.
  for (const [index, line] of source.entries()) {
    const marker = /line-\d+/.exec(line)?.[0];
    if (marker) expect(lowered[index], `line ${index + 1}`).toContain(marker);
  }
  expect(lowered[8]).toContain("}}");
  expect(compiled(out)).toContain("native-pressable");
});

test("the compiled output has no DOM events, class or style calls for a lowered page", () => {
  const code = compiled(html(`<script>\n  let { go, name = $bindable("") } = $props();\n</script>\n<div class="a" style={{ padding: 1 }} onclick={go}>Hi {name}<button onclick={go}>x</button><a href="/x">y</a><input bind:value={name}><img src="/a.png"></div>`));
  expect(code).toContain("native-pressable");
  expect(code).toContain("native-text");
  expect(code).toContain("native-image");
  expect(code).not.toMatch(/set_class|set_style|clsx|"click"/);
  expect(code).toContain("__svelteNativeLink");
});

test("the files that are lowered: the app's own, not libraries below node_modules nor this library's sources", () => {
  expect(lowersHtml("/work/app/src/routes/page.mobile.svelte")).toBe(true);
  expect(lowersHtml("/work/app/src/lib/Card.svelte")).toBe(true);
  expect(lowersHtml("/work/packages/ui/src/Button.svelte")).toBe(true);
  expect(lowersHtml("/work/app/node_modules/some-ui/Button.svelte")).toBe(false);
  expect(lowersHtml("C:\\work\\app\\node_modules\\some-ui\\Button.svelte")).toBe(false);
  expect(lowersHtml(resolve(import.meta.dirname, "../src/components/View.svelte"))).toBe(false);
});

test("a file with HTML the mapping does not touch, or only in a string, is returned as it is", () => {
  const source = `<script>\n  const markup = "<div>x</div>";\n</script>\n<native-view>{markup}</native-view>`;
  expect(html(source)).toBe(source);
  expect(html(`<script>let a = 1;</script>\n<native-text>{a}</native-text>`)).toBe(`<script>let a = 1;</script>\n<native-text>{a}</native-text>`);
  const broken = `<div {x>`;
  expect(html(broken)).toBe(broken);
});

test("an HTML element is marked, so the host passes text style down to the text below it; a View from the package is not", () => {
  const out = html(`<script>\n  import { View } from "@rasheed/svelte-native";\n</script>\n<div class="a">Hi <b>x</b><input /><img src="/a.png" /><View /></div>`);
  expect(markup(out)).toBe("<native-view nativeHtml={true} nativeClass={__svelteNativeHtmlClass(`a`)}><native-text nativeHtml={true}>Hi <native-text nativeHtml={true}>x</native-text></native-text><SvelteNativeTextInput nativeHtml={true} onSubmitEditing={(__event) => __svelteNativeSubmit(__event)} /><native-image source={{ uri: \"/a.png\" }} ></native-image><native-view ></native-view></native-view>");
  // The class of an element that is not HTML-made goes through the plain helper: its font size is the one it sets.
  expect(markup(lowerPrimitives(`<script>\n  import { View } from "@rasheed/svelte-native";\n</script>\n<View class="a" />`))).toContain("__svelteNativeClass(`a`)");
});

test("dl and dd are views, dt a text; mark, kbd, time and the other inline text elements are texts that flow in a line", () => {
  expect(body(`<dl><dt>Term</dt><dd>Definition</dd></dl>`)).toBe(`<native-view><native-text>Term</native-text><native-view><native-text>Definition</native-text></native-view></native-view>`);
  expect(body(`<div>Press <kbd>Esc</kbd> to <del>stay</del> <mark>leave</mark>, x<sup>2</sup></div>`))
    .toBe(`<native-view><native-text>Press <native-text>Esc</native-text> to <native-text>stay</native-text> <native-text>leave</native-text>, x<native-text>2</native-text></native-text></native-view>`);
});

test("a <br> is a newline of the text it is in, and an error anywhere else; an <hr> is a view with a hairline default under its class and style", () => {
  expect(body(`<p>a<br>b<br />c</p>`)).toBe(`<native-text>a{"\\n"}b{"\\n"}c</native-text>`);
  // Text beside a break in a view is one text, and the break is in it.
  expect(body(`<div>a<br>b</div>`)).toBe(`<native-view><native-text>a{"\\n"}b</native-text></native-view>`);
  expect(() => html(`<div><br></div>`)).toThrow(/page\.svelte:1:6 <br> is not supported on native outside text/);
  expect(body(`<hr class="my-2" />`)).toBe("<native-view nativeBase=\"hairline\" nativeClass={__svelteNativeClass(`my-2`)} ></native-view>");
  expect(body(`<hr style={{ height: 3 }}>`)).toBe("<native-view nativeBase=\"hairline\" nativeStyle={{ height: 3 }}></native-view>");
  // It is the host that knows what a hairline is on this screen (`nativeBase`).
  expect(html(`<hr />`)).not.toContain("renderer");
});

test("a <pre> is a text whose whitespace is its own: the text is a template literal, so Svelte does not trim it, and no line moves", () => {
  // `&#123;` is the `{` of the text: the template literal must escape the `${` it makes.
  const source = `<pre>\n  one\n    <b>two</b>  three \`x\` \\ $&#123;y}\n</pre>\n<div>after</div>`;
  const out = html(source);
  expect(out.split("\n")).toHaveLength(source.split("\n").length);
  // The newline after `<pre>` stays in the source, outside the literal (the first newline of a pre is not text); the others are in the text.
  // biome-ignore lint/suspicious/noTemplateCurlyInString: the expected output is the source of a template literal
  expect(body(source)).toBe("<native-text>\n{`  one\n    `}<native-text>{`two`}</native-text>{`  three \\`x\\` \\\\ \\${y}\n`}</native-text>\n<native-view><native-text>after</native-text></native-view>");
  // Compiled, the text is the literal: nothing of it is trimmed or collapsed by the compiler (the mounted text is in html-elements.test.ts).
  const code = compiled(out);
  expect(code).toContain("'  one\\n    '");
  expect(code).toContain("three `x` ");
});

test("a form is told by its fields: a submit button presses through hostClick and Enter in a single-line input through hostSubmit; a key event is its key press", () => {
  expect(body(`<input onkeydown={down} onkeyup={up} />`).replace(" onSubmitEditing={(__event) => __svelteNativeSubmit(__event)}", ""))
    .toBe(`<SvelteNativeTextInput onKeyPress={(__event) => { (down)?.(__svelteNativeKeyEvent("keydown", __event)); (up)?.(__svelteNativeKeyEvent("keyup", __event)); }}  />`);
  expect(body(`<input on:keyup={up} class="c" />`)).toContain(`onKeyPress={(__event) => { (up)?.(__svelteNativeKeyEvent("keyup", __event)); }}`);
  expect(body(`<input />`)).toBe(`<SvelteNativeTextInput onSubmitEditing={(__event) => __svelteNativeSubmit(__event)} />`);
  expect(body(`<input onSubmitEditing={mine} />`)).toBe(`<SvelteNativeTextInput onSubmitEditing={mine} />`);
  expect(body(`<textarea />`)).toBe(`<SvelteNativeTextInput multiline={true} />`);
});

test("a web handler that can never run on a device is a warning naming the file and line; the handlers that do run, and native ones, are not", () => {
  const warnings: string[] = [];
  const source = `<div onmouseover={a} onclick={b} onLayout={c}>\n  <input oninput={d} onkeydown={e} onpaste={f} on:select={g} />\n  <img onload={h} onclick={i} oncontextmenu={j} />\n  <form onsubmit={k} onreset={l} />\n  <dialog onclose={m} oncancel={n} />\n  <input type="checkbox" onchange={o} oninput={p} />\n</div>`;
  html(source, { filename: "page.svelte", warn: (message) => warnings.push(message) });
  expect(warnings).toEqual([
    `page.svelte:1:6 onmouseover on <div> never runs on a device: a native element has no "mouseover" event (the web still calls it)`,
    `page.svelte:2:36 onpaste on <input> never runs on a device: a native element has no "paste" event (the web still calls it)`,
    `page.svelte:2:48 on:select on <input> never runs on a device: a native element has no "select" event (the web still calls it)`,
    `page.svelte:3:31 oncontextmenu on <img> never runs on a device: a native element has no "contextmenu" event (the web still calls it)`,
    `page.svelte:4:22 onreset on <form> never runs on a device: a native element has no "reset" event (the web still calls it)`,
    `page.svelte:5:23 oncancel on <dialog> never runs on a device: a native element has no "cancel" event (the web still calls it)`,
    `page.svelte:6:39 oninput on <input> never runs on a device: a native element has no "input" event (the web still calls it)`,
  ]);
});

test("in:, out:, transition: and animate: pass through an HTML element untouched, whatever else is done to it", () => {
  const out = body(`<div in:fly={{ y: 8 }} out:fade={{ duration: 100 }} animate:flip class="a" onclick={go}>x</div><p transition:slide|local>y</p><button in:scale>z</button>`);
  expect(out).toContain("in:fly={{ y: 8 }} out:fade={{ duration: 100 }} animate:flip");
  expect(out).toContain("<native-text transition:slide|local>y</native-text>");
  expect(out).toContain("in:scale>");
  // They are the author's: no warning of the HTML lowering rejects them (the primitive lowering's own notice is the other branch's to change).
  expect(() => html(`<div in:fly out:fade transition:slide animate:flip use:tap />`)).not.toThrow();
});

test("style as a string is converted by the class converter when the file is built: units and colors mean what they mean in a class", () => {
  expect(body(`<div style="padding: 4px 8px; color: red; background-color: #fff; font-size: 1rem">a</div>`))
    .toBe(`<native-view nativeStyle={{"paddingTop":4,"paddingRight":8,"paddingBottom":4,"paddingLeft":8,"color":"#ff0000","backgroundColor":"#ffffff","fontSize":16}}><native-text>a</native-text></native-view>`);
  // A unitless line height waits for the font size the element ends up with.
  expect(body(`<p style="line-height: 1.5; letter-spacing: 0.1em">a</p>`)).toBe(`<native-text nativeStyle={{"fontRelative":{"lineHeight":1.5,"letterSpacing":0.1}}}>a</native-text>`);
  // On a component (an input), the style is the `style` prop; an empty one is nothing.
  expect(body(`<input style="margin: 2px" />`)).toContain(`style={{"marginTop":2,"marginRight":2,"marginBottom":2,"marginLeft":2}}`);
  expect(body(`<div style="">a</div>`)).toBe(`<native-view ><native-text>a</native-text></native-view>`);
  // A declaration the converter cannot express, or a value only the device knows, is an error that names it; so is a string with an expression in it.
  expect(() => html(`<div style="display: flex; float: left">a</div>`)).toThrow(/^page\.svelte:1:6 style="display: flex; float: left" on <div> cannot be converted: float: no React Native style for float/);
  expect(() => html(`<div style="width: 50vw">a</div>`)).toThrow(/cannot be converted: width: a viewport or safe-area unit is only for classes/);
  expect(() => html(`<div style="color: {c}">a</div>`)).toThrow(/^page\.svelte:1:6 style="\.\.\." with \{\.\.\.\} in it is not supported on native: write the style as an object/);
  // An object stays as it was written; the string `style` of the other elements is not touched when there is nothing to convert.
  expect(body(`<div style={s}>a</div>`)).toBe(`<native-view nativeStyle={s}><native-text>a</native-text></native-view>`);
});

test("style:property directives are one call that works them out when they change, joined with the style written beside them", () => {
  expect(body(`<div style:color={c} style:font-size="12px" style:width>a</div>`))
    .toBe(`<native-view nativeStyle={__svelteNativeStyleProps({ "color": c, "font-size": "12px", "width": width })}  ><native-text>a</native-text></native-view>`.replace("nativeStyle={__svelteNativeStyleProps({ \"color\": c, \"font-size\": \"12px\", \"width\": width })}  >", "nativeStyle={__svelteNativeStyleProps({ \"color\": c, \"font-size\": \"12px\", \"width\": width })}   >"));
  expect(body(`<div style={s} style:color={c}>a</div>`)).toBe(`<native-view nativeStyle={[s, __svelteNativeStyleProps({ "color": c })]} ><native-text>a</native-text></native-view>`);
  expect(body(`<div style="margin: 2px" style:opacity="0.5">a</div>`)).toBe(`<native-view nativeStyle={[{"marginTop":2,"marginRight":2,"marginBottom":2,"marginLeft":2}, __svelteNativeStyleProps({ "opacity": "0.5" })]} ><native-text>a</native-text></native-view>`);
  expect(body(`<input style:color={c} />`)).toContain(`style={__svelteNativeStyleProps({ "color": c })}`);
  expect(compiled(html(`<script>\n  let { c, s } = $props();\n</script>\n<div style={s} style:color={c} style:font-size="12px">a</div>`))).toContain("__svelteNativeStyleProps");
});

test("bind:this on a lowered primitive is a ref, because the real compiler refuses it on a host tag and on the component it is the instance", () => {
  const source = `<script>\n  import { View, Text, ScrollView } from "@rasheed/svelte-native";\n  let view = $state(null);\n  let text = $state(null);\n  let scroll;\n  let { rest } = $props();\n</script>\n<View bind:this={view} id="a"><Text bind:this={text} {...rest}>x</Text></View>\n<ScrollView bind:this={scroll} />\n<div bind:this={view}></div>`;
  const out = lowerPrimitives(source, { filename: "page.svelte", html: true });
  expect(out).toContain("<native-view ref={(__ref) => (view = __ref)} id=\"a\">");
  expect(out).toContain("<native-text ref={__svelteNativeValue((__ref) => (text = __ref))} {...__svelteNativeSpread(rest)}>");
  expect(out).toContain("<native-scroll ref={(__ref) => (scroll = __ref)} ></native-scroll>");
  expect(out).not.toContain("bind:this");
  // Without the rewrite the compiler says it cannot (the probe that makes the assertion below mean something).
  expect(() => compiled(out.replaceAll("ref={(__ref) => (view = __ref)}", "bind:this={view}"))).toThrow(/`bind:` is not compatible with `customRenderer`/);
  expect(compiled(out)).toContain("native-view");
  // A multi-line binding keeps its lines.
  const lines = `<script>\n  import { View } from "@rasheed/svelte-native";\n  let el;\n</script>\n<View\n  bind:this={\n    el\n  }\n  id="x"\n/>`;
  expect(lowerPrimitives(lines).split("\n")).toHaveLength(lines.split("\n").length);
  expect(compiled(lowerPrimitives(lines))).toContain("native-view");
});
