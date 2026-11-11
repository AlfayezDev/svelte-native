import { test, expect } from "bun:test";
import { resolve } from "node:path";
import { compile } from "svelte/compiler";
import { lowersHtml } from "../src/compile-options.ts";
import lowerDefault, { lower, lowerPrimitives } from "../src/lower.ts";
import { mayHaveHtml, oneLine } from "../src/lower-html.ts";

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
  // `bind:this` of a host tag is a `ref` (the compiler refuses it), which needs the renderer's helper: the import is in the script, and the markup is after it.
  expect(markup(lowerPrimitives(`${header}<V bind:this={el} id="b" testID="c" ref={fn}><V /></V>\n<Image source={s} />\n<ActivityIndicator\n  size="large"\n/>`, { warn: () => {} })))
    .toBe(`<native-view ref={__svelteNativeBind((__k, __v) => (el = __v), (__k) => el, [])} id="b" testID="c" ref={fn}><native-view ></native-view></native-view>\n<native-image source={s} ></native-image>\n<native-spinner\n  size="large"\n></native-spinner>`);
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
  expect(out.startsWith(`<script> ${helperImport("hostBind as __svelteNativeBind, hostClass as __svelteNativeClass, hostSpread as __svelteNativeSpread, hostValue as __svelteNativeValue")}\n`)).toBe(true);
  expect(out.split("\n")).toHaveLength(source.split("\n").length);
  expect(out.slice(out.indexOf("<native-view"))).toBe(
    "<native-view {...__svelteNativeSpread(rest)} ref={__svelteNativeValue(__svelteNativeBind((__k, __v) => (el = __v), (__k) => el, []))} nativeClass={__svelteNativeClass(`a`, s)} id=\"b\" testID=\"c\" ref={__svelteNativeValue(fn)} onLayout={go} nativeStyle={s} width={3} animated={__svelteNativeValue(a.b)} shorthand={__svelteNativeValue(shorthand)} {...(__svelteNativeSpread(on ? p : q))}><native-view ></native-view></native-view>\n<native-image source={s} ></native-image>",
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

test("transition:, in:, out: and animate: stay on the host tag and are not warned about; an action other than gesture is", () => {
  const warnings: string[] = [];
  const source = `${imp}<View use:tap transition:fade in:fly={{ y: 20 }} out:fade animate:flip={{ duration: 200 }}>x</View>`;
  const out = lowerPrimitives(source, { filename: "d.svelte", warn: (m) => warnings.push(m) });
  expect(out).toContain("<native-view use:tap transition:fade in:fly={{ y: 20 }} out:fade animate:flip={{ duration: 200 }}>x</native-view>");
  expect(warnings).toHaveLength(1);
  expect(warnings[0]).toContain("use:tap");
  const clean: string[] = [];
  lowerPrimitives(`${imp}<View transition:fade><Text in:fly out:fade>x</Text><Image animate:flip /><Pressable transition:scale /></View>`, { warn: (m) => clean.push(m) });
  expect(clean).toEqual([]);
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
// `lowerPrimitives(..., { html: true })` is what the Metro transformer runs for the app's own files (`lowersHtml`); `lower-html.ts` is the mapping. What the elements do on the
// device is in html-elements.test.ts (mounted on a fake host); the compiled output and the line numbers of whole files are in lower-html-compile.test.ts.

const html = (source: string, options: { filename?: string; warn?: (message: string) => void } = {}) => lowerPrimitives(source, { filename: "page.svelte", warn: () => {}, ...options, html: true });
/** What the markers of an HTML element and its class helper are called is not what most of these tests are about: `plainHtml` takes them out (the raw output has them: "an HTML element is marked"). */
const plainHtml = (code: string) => code.replaceAll(" nativeHtml={true}", "").replaceAll(' nativeHtml="inline"', "").replace(/ nativeBase="[^"]*"/g, "").replaceAll("__svelteNativeHtmlClass", "__svelteNativeClass");
/** The markup after the script(s), whatever the lowering put into the script. */
const body = (source: string) => { const out = html(source); const end = out.lastIndexOf("</script>"); return plainHtml(end < 0 ? out : out.slice(end + "</script>".length).replace(/^\n/, "")); };
const compiled = (lowered: string) => compile(lowered, { filename: "/app/page.svelte", generate: "client", runes: true, experimental: { customRenderer: "@rasheed/svelte-native/renderer" } }).js.code;
/** The press hook of a button and of a link: what the element does after the handler, read from the element when it is pressed. */
const submitHook = (handler = "undefined") => `onPress={(__event) => __svelteNativeClick(__event, ${handler}, (__event) => __svelteNativeSubmit(__event))}`;
const linkHook = (handler = "undefined") => `onPress={(__event) => __svelteNativeClick(__event, ${handler}, (__event) => __svelteNativeLink(__svelteNativeHref(__event)))}`;

test("HTML is left alone unless the caller asks (the web build, svelte-check and a svelte.config.js preprocessor see the markup as written)", () => {
  const source = `<script>\n  let { go } = $props();\n</script>\n<div class="a" onclick={go}><p>text</p><button>x</button><table></table></div>`;
  expect(lowerPrimitives(source, { filename: "page.svelte" })).toBe(source);
  expect(lower.markup({ content: source, filename: "page.svelte" })).toBeUndefined();
  expect(html(source.replace("<table></table>", ""))).not.toBe(source.replace("<table></table>", ""));
});

test("only a file that has an element that is not a component or a host tag is parsed: every file has a script, and many a style", () => {
  expect(mayHaveHtml(`<script lang="ts">\n  let a = 1;\n</script>\n<style>p { color: red }</style>\n<native-view><Card /><svelte:options runes /></native-view>`)).toBe(false);
  expect(mayHaveHtml(`<script>let a = 1;</script>\n<native-view />`)).toBe(false);
  for (const markup of ["<div>", "<p class=x>", "<a\nhref=x>", "<input/>", "<svelte:head>", "<svelte:window ", "<svelte:element this={t}>", "<svelte:body>", "<svelte:document>", "<table>", "<center>", "<my-widget />", "<title>"]) expect(mayHaveHtml(markup), markup).toBe(true);
});

test("div, section, header, footer, main, nav, article, aside, ul, ol, li, label, figure, fieldset, dl and dd are views; a form is a view that knows it is one", () => {
  for (const name of "div section header footer main nav article aside ul ol li label figure fieldset dl dd".split(" ")) {
    expect(body(`<${name} class="x"></${name}>`), name).toBe("<native-view nativeClass={__svelteNativeClass(`x`)}></native-view>");
  }
  expect(body(`<div />`)).toBe("<native-view ></native-view>");
  // Its submit buttons and the inputs in it find it by `nativeForm`; `onsubmit` is the event it hears.
  expect(body(`<form class="x" onsubmit={save}></form>`)).toBe("<native-view nativeForm={true} nativeClass={__svelteNativeClass(`x`)} onsubmit={save}></native-view>");
});

test("p, span, h1 to h6, strong, b, em, i, small, code, blockquote, figcaption, dt and the inline text elements are texts; headings are headers", () => {
  for (const name of "p span strong b em i small code blockquote figcaption dt mark kbd time abbr s u del ins q cite sub sup var samp dfn data".split(" ")) expect(body(`<${name}>x</${name}>`), name).toBe("<native-text>x</native-text>");
  for (const level of [1, 2, 3, 4, 5, 6]) expect(body(`<h${level}>x</h${level}>`), `h${level}`).toBe(`<native-text accessibilityRole="header">x</native-text>`);
  // The role the author wrote wins, and nothing is added next to a role.
  expect(body(`<h2 accessibilityRole="none">x</h2>`)).toBe(`<native-text accessibilityRole="none">x</native-text>`);
  expect(body(`<h2 role="heading" aria-level="2">x</h2>`)).toBe(`<native-text role="heading" aria-level="2">x</native-text>`);
});

test("an HTML element is marked, so the host passes text style down and draws the text bare in it; the elements that flow in a line are inline, and a browser's default style is its base", () => {
  const out = html(`<script>\n  import { View } from "@rasheed/svelte-native";\n</script>\n<div class="a">Hi <b>x</b><h1>T</h1><hr><input /><img src="/a.png" /><dialog /><View /></div>`);
  expect(markup(out)).toBe([
    "<native-view nativeHtml={true} nativeClass={__svelteNativeHtmlClass(`a`)}>Hi ",
    `<native-text nativeHtml="inline" nativeBase="b">x</native-text>`,
    `<native-text nativeHtml={true} nativeBase="h1" accessibilityRole="header">T</native-text>`,
    `<native-view nativeHtml={true} nativeBase="hairline"></native-view>`,
    "<SvelteNativeTextInput nativeHtml={true} />",
    `<native-image source={{ uri: "/a.png" }} ></native-image>`,
    "<SvelteNativeModal nativeHtml={true} open={false} />",
    "<native-view ></native-view></native-view>",
  ].join(""));
  // The class of an element that is not HTML-made goes through the plain helper: its font size is the one it sets.
  expect(markup(lowerPrimitives(`<script>\n  import { View } from "@rasheed/svelte-native";\n</script>\n<View class="a" />`))).toContain("__svelteNativeClass(`a`)");
  // The elements with a default style have a base of their own name; the others have none, and a link has no default color.
  const base = (source: string) => html(source).match(/nativeBase="([^"]*)"/)?.[1];
  for (const name of "b strong em i cite dfn var u ins s del code kbd samp pre small sub sup mark h1 h2 h3 h4 h5 h6".split(" ")) expect(base(`<${name}>x</${name}>`), name).toBe(name);
  for (const name of "p span a div blockquote q time abbr".split(" ")) expect(base(`<${name}>x</${name}>`), name).toBeUndefined();
});

test("a button is a pressable with the button role; its press reads its own type when it is pressed, so none of that is decided here", () => {
  expect(body(`<button type="submit" onclick={go} class="b" disabled={busy}>Save</button>`))
    .toBe(`<native-pressable accessibilityRole="button" type="submit" ${submitHook("go")} nativeClass={__svelteNativeClass(\`b\`)} disabled={busy}>Save</native-pressable>`);
  expect(body(`<button>x</button>`)).toBe(`<native-pressable accessibilityRole="button" ${submitHook()}>x</native-pressable>`);
  expect(body(`<button type={kind} onclick={clear}>x</button>`)).toBe(`<native-pressable accessibilityRole="button" type={kind} ${submitHook("clear")}>x</native-pressable>`);
  expect(body(`<button on:click={go} role="tab">x</button>`)).toBe(`<native-pressable ${submitHook("go")} role="tab">x</native-pressable>`);
  // What the author said about the role stands; a disabled button is dimmed for the screen reader by the host (a press reads `disabled`), so nothing is copied.
  expect(body(`<button disabled aria-disabled="false">x</button>`)).toBe(`<native-pressable accessibilityRole="button" ${submitHook()} disabled={true} aria-disabled="false">x</native-pressable>`);
});

test("onclick is onPress on every mapped element; a view with a handler is a pressable, a text stays a text", () => {
  expect(body(`<div onclick={go}>a</div>`)).toBe(`<native-pressable onPress={go}>a</native-pressable>`);
  expect(body(`<li onclick={() => pick(i)}><b>x</b></li>`)).toBe(`<native-pressable onPress={() => pick(i)}><native-text>x</native-text></native-pressable>`);
  expect(body(`<span onclick={go}>a</span>`)).toBe(`<native-text onPress={go}>a</native-text>`);
  expect(body(`<p {onclick}>a</p>`)).toBe(`<native-text onPress={onclick}>a</native-text>`);
  expect(body(`<img onclick={go} src="/a.png" />`)).toContain("onPress={go}");
  // The directive is the same event; a forwarding `on:click` has no handler to rename; the other events pass through as they are.
  expect(body(`<div on:click={go} onpointerdown={down} onLayout={size}></div>`)).toBe(`<native-pressable onPress={go} onpointerdown={down} onLayout={size}></native-pressable>`);
  // Svelte's custom renderer refuses `on:`, so what is left of a directive is the attribute of its event (a warning that it never runs, for an event the element does not get), and what cannot be is an error that says what to write.
  const warnings: string[] = [];
  const out = html(`<div on:mouseover={over} on:click={go}></div>`, { warn: (message) => warnings.push(message) });
  expect(out).toContain("<native-pressable nativeHtml={true} onmouseover={over} onPress={go}>");
  expect(warnings).toEqual([expect.stringContaining('on:mouseover on <div> never runs on a device')]);
  compiled(out);
  for (const directive of ["on:click", "on:click|preventDefault={go}", "on:keydown|once={go}", "on:custom"]) expect(() => html(`<div ${directive}></div>`), directive).toThrow(/on:\w+(\|\w+)? on <div> is not supported on native: write the `on\w+` attribute with a function/);
  expect(() => html(`<img on:load={f} on:click|stopPropagation={g} src="a">`)).toThrow("on:click|stopPropagation on <img> is not supported on native");
  expect(compiled(html(`<img on:load={f} on:error={e} src="/a.png" /><form on:submit={s}></form>`))).not.toContain("on:");
});

test("an <a> follows its href when pressed: the attribute stays, so one from a spread counts and none is no link; the instance script gets the call", () => {
  const out = html(`<script>\n  let id = 1;\n</script>\n<a href="/settings" class="link">Settings</a>`);
  expect(out.startsWith(`<script> ${helperImport("hostClick as __svelteNativeClick, hostHref as __svelteNativeHref, hostHtmlClass as __svelteNativeHtmlClass")} import { useLink as __svelteNativeUseLink } from "@rasheed/svelte-native/router"; const __svelteNativeLink = __svelteNativeUseLink();\n  let id = 1;`)).toBe(true);
  expect(plainHtml(markup(out))).toBe(`<native-pressable accessibilityRole="link" ${linkHook()} href="/settings" nativeClass={__svelteNativeClass(\`link\`)}>Settings</native-pressable>`);
  // A dynamic href, an `onclick` of its own that runs first (the link is followed after it, unless it called `preventDefault`), and no href at all: the same hook.
  expect(body(`<script>let id = 1;</script><a href={url} onclick={log}>x</a>`)).toBe(`<native-pressable accessibilityRole="link" href={url} ${linkHook("log")}>x</native-pressable>`);
  expect(body(`<a>x</a>`)).toBe(`<native-pressable accessibilityRole="link" ${linkHook()}>x</native-pressable>`);
  expect(body(`<a {...rest}>x</a>`)).toContain("{...__svelteNativeWebClickSpread(rest)}");
  const bare = html(`<a href="https://example.com">x</a>`);
  expect(bare.startsWith(`<script>${helperImport("hostClick as __svelteNativeClick, hostHref as __svelteNativeHref")} import { useLink as __svelteNativeUseLink }`)).toBe(true);
});

test("an <a> inside text is a press on the text, so a sentence with a link stays one text; one that stands alone in a view is a pressable around its text", () => {
  expect(body(`<p>Read the <a href="/terms">terms</a>.</p>`)).toBe(`<native-text>Read the <native-text accessibilityRole="link" ${linkHook()} href="/terms">terms</native-text>.</native-text>`);
  expect(body(`<div>See <a href="/x">this</a> now</div>`)).toBe(`<native-view>See <native-text accessibilityRole="link" ${linkHook()} href="/x">this</native-text> now</native-view>`);
  expect(body(`<li><a href="/x">this</a></li>`)).toBe(`<native-view><native-pressable accessibilityRole="link" ${linkHook()} href="/x">this</native-pressable></native-view>`);
  // The text elements that flow in a line are inline for the host, which draws a run of them and the text bare beside them as one line.
  expect(html(`<div>See <b>this</b> <a href="/x">now</a></div>`).match(/nativeHtml="inline"/g)).toHaveLength(2);
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

test("an <input> is a TextInput and keeps its attributes: the component works the HTML ones out when the app runs, so a type={expression} and a spread mean the same", () => {
  const input = (source: string) => body(`<script>let v = $state("");</script>${source}`);
  expect(input(`<input bind:value={v} placeholder="Name" maxlength="12" />`)).toBe(`<SvelteNativeTextInput bind:value={v} placeholder="Name" maxlength="12" />`);
  expect(input(`<input type="email" bind:value={v}>`)).toBe(`<SvelteNativeTextInput type="email" bind:value={v} />`);
  expect(input(`<input type={show ? "text" : "password"} disabled readonly oninput={f} onkeydown={k}>`)).toBe(`<SvelteNativeTextInput type={show ? "text" : "password"} disabled readonly oninput={f} onkeydown={k} />`);
  // A directive is the attribute, the name the component reads; the other events of the element are the web's (and a warning).
  expect(input(`<input on:input={typed} on:keyup={up} on:focus={f} />`)).toBe(`<SvelteNativeTextInput oninput={typed} onkeyup={up} onfocus={f} />`);
  // `bind:this` is the host handle, through `ref`; a type that has no native equivalent is an error naming the type.
  expect(input(`<input bind:this={field} bind:value={v} />`)).toBe(`<SvelteNativeTextInput ref={__svelteNativeBind((__k, __v) => (field = __v), (__k) => field, [])} bind:value={v} />`);
  expect(() => html(`<input type="range" />`)).toThrow("<input type=\"range\"> is not supported on native");
});

test("a <textarea> is a multiline TextInput with a closing tag; the text between its tags is its initial value unless it has a value", () => {
  expect(body(`<textarea bind:value={v} rows="4" placeholder="Notes"></textarea>`)).toBe(`<SvelteNativeTextInput multiline={true} bind:value={v} rows="4" placeholder="Notes"></SvelteNativeTextInput>`);
  expect(body(`<textarea bind:value={v} />`)).toBe(`<SvelteNativeTextInput multiline={true} bind:value={v} />`);
  // biome-ignore lint/suspicious/noTemplateCurlyInString: the expected output is the source of a template literal
  expect(body(`<textarea>Hi {name}!</textarea>`)).toBe("<SvelteNativeTextInput multiline={true} value={`Hi ${(name) ?? \"\"}!`}></SvelteNativeTextInput>");
  expect(body(`<textarea bind:value={v}>ignored</textarea>`)).toBe(`<SvelteNativeTextInput multiline={true} bind:value={v}>ignored</SvelteNativeTextInput>`);
  expect(body(`<textarea value="x">ignored</textarea>`)).toContain("ignored");
});

test("an <input type=checkbox> is a Switch: checked is its value, bind:checked binds it, onchange gets the web's event with the element's name; the form's value is dropped", () => {
  expect(body(`<input type="checkbox" bind:checked={on} value="yes" name="n" id="i" disabled onchange={(e) => seen(e.currentTarget.checked)}>`))
    .toBe(`<SvelteNativeSwitch  bind:value={on}  name="n" id="i" disabled onValueChange={(__value) => ((e) => seen(e.currentTarget.checked))?.(__svelteNativeInputEvent("change", __value, { type: "checkbox", name: "n", id: "i" }))} />`);
  expect(body(`<input type="checkbox" checked />`)).toBe(`<SvelteNativeSwitch  value={true} />`);
  expect(body(`<input type="checkbox" checked={on} bind:this={box} />`)).toBe(`<SvelteNativeSwitch  value={on} ref={__svelteNativeBind((__k, __v) => (box = __v), (__k) => box, [])} />`);
  expect(body(`<input type="checkbox" bind:checked />`)).toBe(`<SvelteNativeSwitch  bind:value={checked} />`);
});

test("a <dialog> is a Modal that takes open as it takes visible, bind:open too (the Modal closes it when the platform does); onclose is onRequestClose; no open is closed", () => {
  expect(body(`<dialog open={shown} onclose={closed}>x</dialog>`)).toBe(`<SvelteNativeModal open={shown} onRequestClose={closed}>x</SvelteNativeModal>`);
  expect(body(`<dialog open>x</dialog>`)).toBe(`<SvelteNativeModal open>x</SvelteNativeModal>`);
  expect(body(`<dialog><div>x</div></dialog>`)).toBe(`<SvelteNativeModal open={false}><native-view>x</native-view></SvelteNativeModal>`);
  expect(body(`<dialog bind:open={shown} on:close={closed}></dialog>`)).toBe(`<SvelteNativeModal bind:open={shown} onRequestClose={closed}></SvelteNativeModal>`);
});

test("the components the elements need are imported under names of their own, from the package's core entry", () => {
  const out = html(`<script lang="ts">\n  import { TextInput } from "@rasheed/svelte-native";\n  let v = $state("");\n</script>\n<input bind:value={v} /><input type="checkbox" /><dialog></dialog>`);
  expect(out.startsWith(`<script lang="ts"> import { Modal as SvelteNativeModal, Switch as SvelteNativeSwitch, TextInput as SvelteNativeTextInput } from "@rasheed/svelte-native/core";\n`)).toBe(true);
  // The file's own `TextInput` is the author's: it stays a component.
  const own = html(`<script>\n  import { TextInput } from "@rasheed/svelte-native";\n</script>\n<TextInput bind:value={v} /><input bind:value={v} />`);
  expect(plainHtml(markup(own))).toBe(`<TextInput bind:value={v} /><SvelteNativeTextInput bind:value={v} />`);
});

test("text in an HTML element is left where it is for the host to draw (it also comes from children and snippets); only the elements that make a run a line are told apart", () => {
  expect(body(`<div>Hello</div>`)).toBe(`<native-view>Hello</native-view>`);
  expect(body(`<div>\n  Hello {name}!\n</div>`)).toBe(`<native-view>\n  Hello {name}!\n</native-view>`);
  expect(body(`<li>{item.name}</li>`)).toBe(`<native-view>{item.name}</native-view>`);
  expect(body(`<div>{#if on}Shown{:else}Hidden{/if}</div>`)).toBe(`<native-view>{#if on}Shown{:else}Hidden{/if}</native-view>`);
  expect(body(`<p>one {two} <em>three</em></p>`)).toBe(`<native-text>one {two} <native-text>three</native-text></native-text>`);
  // A link in a run that has text is a press on the text; one in a run of nothing but elements is a pressable.
  expect(body(`<div>See <a href="/x">x</a></div>`)).toContain("<native-text accessibilityRole=\"link\"");
  expect(body(`<div><a href="/x">x</a> <a href="/y">y</a></div>`)).toContain("<native-pressable accessibilityRole=\"link\"");
  // A component's children, a snippet and the document root are not a view's: nothing there is told apart.
  expect(body(`<script>import { Screen } from "@rasheed/svelte-native";</script>text {x}\n<Screen>inside {y}<div>z</div></Screen>{#snippet s()}bare{/snippet}`))
    .toBe(`text {x}\n<Screen>inside {y}<native-view>z</native-view></Screen>{#snippet s()}bare{/snippet}`);
  // A host tag written by hand is the author's; the elements inside it are still lowered.
  expect(body(`<native-view>text<div>x</div></native-view>`)).toBe(`<native-view>text<native-view>x</native-view></native-view>`);
});

test("<svelte:head> is taken out (it means nothing on a device and Svelte's custom renderer refuses it), and the other special elements of the document are errors that say why", () => {
  const source = `<script>\n  let { go } = $props();\n</script>\n<svelte:head>\n  <title>T</title>\n  <meta name="a" content="b">\n</svelte:head>\n<div>x</div>\n`;
  const out = html(source);
  expect(out).not.toContain("svelte:head");
  expect(out.split("\n")).toHaveLength(source.split("\n").length);
  expect(compiled(out)).toContain("native-view");
  for (const element of ["window", "document", "body"]) {
    expect(() => html(`<svelte:${element} onkeydown={f} /><div />`), element).toThrow(new RegExp(`page\\.svelte:1:1 <svelte:${element}> is not supported on native`));
  }
});

test("<svelte:element this={tag}> gets the host tag of the tag when the app runs, or at once for a tag written out, and is marked inline when it is a text that flows; its attributes are not adapted, which is a warning, but bind:this and on: are", () => {
  const warnings: string[] = [];
  const out = html(`<svelte:element this={tag} class="c" onclick={go}>x</svelte:element><svelte:element this="h2">y</svelte:element><svelte:element this="span">z</svelte:element><svelte:element this={pick()}>w</svelte:element>`, { warn: (message) => warnings.push(message) });
  // A tap is a touch, which the host makes `onPress` of: `onclick` is that, as on a lowered `div`.
  expect(out).toContain(`<svelte:element nativeHtml={__svelteNativeInline(tag)} this={__svelteNativeTag(tag)} class="c" onPress={go}>`);
  expect(out).toContain(`<svelte:element nativeHtml={true} this="native-text">y`);
  expect(out).toContain(`<svelte:element nativeHtml="inline" this="native-text">z`);
  // A tag that is a call is not read twice: it is marked a block.
  expect(out).toContain(`<svelte:element nativeHtml={true} this={__svelteNativeTag(pick())}>w`);
  expect(out).toContain("hostTag as __svelteNativeTag");
  expect(warnings).toHaveLength(1);
  expect(warnings[0]).toContain("class on <svelte:element> is not adapted on native");
  expect(html(`<svelte:element this="div" onmouseover={go} {onclick} />`, { warn: (message) => warnings.push(message) })).toContain("onPress={onclick}");
  expect(warnings).toHaveLength(2);
  expect(warnings[1]).toContain("onmouseover on <svelte:element> is not adapted on native");
  // Svelte refuses `bind:` and `on:` on it as it does anywhere under the custom renderer: `bind:this` is the host handle, `on:` the attribute of the event, a modifier an error.
  const bound = html(`<script>let el, rest = {};</script><svelte:element this="div" bind:this={el} on:click={go}>x</svelte:element><svelte:element this="div" bind:this={el} {...rest} />`);
  // Svelte sends every attribute of a dynamic element through `set_attributes`, which drops a function: the ref is boxed, with a spread or without.
  expect(bound.match(/ref=\{__svelteNativeValue\(__svelteNativeBind\(\(__k, __v\) => \(el = __v\), \(__k\) => el, \[\]\)\)\}/g)).toHaveLength(2);
  expect(bound).toContain("onPress={go}");
  expect(html(`<svelte:element this="div" on:keydown={go} />`)).toContain("onkeydown={go}");
  expect(bound).toMatch(/import \{[^}]*hostBind as __svelteNativeBind[^}]*\} from/);
  expect(bound).toMatch(/import \{[^}]*hostValue as __svelteNativeValue[^}]*\} from/);
  expect(compiled(bound)).toContain("__svelteNativeBind");
  expect(() => html(`<svelte:element this="div" on:click|preventDefault={go} />`)).toThrow("on:click|preventDefault on <svelte:element> is not supported on native");
  expect(() => html(`<svelte:element this="div" bind:value={v} />`)).toThrow("bind:value on <svelte:element> is not supported on native");
  expect(() => html(`<svelte:element this="table" />`)).toThrow('<svelte:element this="table"> has no native equivalent');
  expect(() => html(`<svelte:element this="input" />`)).toThrow("has no native equivalent");
  expect(compiled(html(`<script>let { tag } = $props();</script><svelte:element this={tag}>x</svelte:element>`))).toContain("__svelteNativeTag");
});

test("an element that is not an HTML element of the table, a host tag or a component is an error: <center>, <font>, custom elements, <title> outside the head", () => {
  const failure = (source: string): string => { try { html(source); } catch (error) { return (error as Error).message; } return ""; };
  expect(failure(`<center>x</center>`)).toMatch(/^page\.svelte:1:1 <center> is not supported on native/);
  expect(failure(`<div>\n  <font color="red">x</font>\n</div>`)).toMatch(/^page\.svelte:2:3 <font> is not supported on native/);
  expect(failure(`<my-widget />`)).toContain("<my-widget> is a custom element, which is not supported on native: write a component, or a host tag");
  expect(failure(`<title>x</title>`)).toContain("<title> is not supported on native");
  // Components, host tags and the elements inside them are fine.
  expect(failure(`<script>import Card from "./Card.svelte";</script><Card><native-view><div /></native-view></Card>`)).toBe("");
});

test("class, class:, style, spreads and ref carry over as on a lowered View; a button's and a link's spread keeps its press, and bind:this is a ref", () => {
  expect(body(`<div class="a {b}" class:on style={s} {...rest} id="x" aria-label="l">t</div>`))
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the expected output is the source of a template literal
    .toBe("<native-view nativeClass={__svelteNativeClass([`a ${(b) ?? \"\"}`, { \"on\": on }])}  nativeStyle={s} {...__svelteNativeWebSpread(rest, { \"on\": on })} id=\"x\" aria-label=\"l\">t</native-view>");
  // An HTML element's class does not get its own style along: the host knows the font size the element inherits, which a `leading-6` is made from.
  expect(body(`<p class="t" style={{ fontSize: 20 }} {onclick} hidden>x</p>`)).toBe("<native-text nativeClass={__svelteNativeClass(`t`)} nativeStyle={{ fontSize: 20 }} onPress={onclick} hidden={true}>x</native-text>");
  // A press that does something by itself (a button submits, a link follows) is not replaced by the `onclick` of a spread: that runs with it.
  expect(body(`<button {...rest}>x</button>`)).toContain("{...__svelteNativeWebClickSpread(rest)}");
  expect(body(`<div {...rest}>x</div>`)).toContain("{...__svelteNativeWebSpread(rest)}");
  expect(html(`<button {...rest}>x</button>`)).toContain("hostWebClickSpread as __svelteNativeWebClickSpread");
  // The View a file imports from the package takes the same paths beside the HTML.
  const mixed = html(`<script>\n  import { View } from "@rasheed/svelte-native";\n</script>\n<View class="v"><div class="d">x</div></View>`);
  expect(markup(mixed)).toBe("<native-view nativeClass={__svelteNativeClass(`v`)}><native-view nativeHtml={true} nativeClass={__svelteNativeHtmlClass(`d`)}>x</native-view></native-view>");
  // A `<View>`'s class gets the style the view has, which sets the font size it is made from: written a second time, on one line, and only if it is a plain read (a call would run twice).
  const view = (style: string) => markup(html(`<script>\n  import { View } from "@rasheed/svelte-native";\n</script>\n<View class="v" style=${style}>x</View>`));
  expect(view("{{\n  fontSize: 20,\n  color: c,\n}}")).toBe("<native-view nativeClass={__svelteNativeClass(`v`, { fontSize: 20, color: c, })} nativeStyle={{\n  fontSize: 20,\n  color: c,\n}}>x</native-view>");
  expect(view("{styles.box}")).toBe("<native-view nativeClass={__svelteNativeClass(`v`, styles.box)} nativeStyle={styles.box}>x</native-view>");
  expect(view("{mk(c)}")).toBe("<native-view nativeClass={__svelteNativeClass(`v`)} nativeStyle={mk(c)}>x</native-view>");
  expect(view("{{ ...mk(c) }}")).toBe("<native-view nativeClass={__svelteNativeClass(`v`)} nativeStyle={{ ...mk(c) }}>x</native-view>");
  // A `//` in a string is not a comment: the copy is on one line.
  expect(view('{{\n  backgroundImage: "url(http://x)",\n  color: c,\n}}')).toBe('<native-view nativeClass={__svelteNativeClass(`v`, { backgroundImage: "url(http://x)", color: c, })} nativeStyle={{\n  backgroundImage: "url(http://x)",\n  color: c,\n}}>x</native-view>');
  expect(view("{{\n  // the font\n  fontSize: 20,\n}}")).toBe("<native-view nativeClass={__svelteNativeClass(`v`)} nativeStyle={{\n  // the font\n  fontSize: 20,\n}}>x</native-view>");
});

test("bind:this is a ref that follows its target: keys that are computed are read where the attribute is, and the variable is written with the keys it had", () => {
  const ref = (source: string) => /ref=\{.*\}(?=[ >])/.exec(body(source))?.[0];
  expect(ref(`<div bind:this={el} id="a"></div>`)).toBe(`ref={__svelteNativeBind((__k, __v) => (el = __v), (__k) => el, [])}`);
  expect(ref(`<div bind:this={els[i]}></div>`)).toBe(`ref={__svelteNativeBind((__k, __v) => (els[__k[0]] = __v), (__k) => els[__k[0]], [i])}`);
  expect(ref(`<div bind:this={rows[item.id].cells[col + 1].el}></div>`)).toBe(`ref={__svelteNativeBind((__k, __v) => (rows[__k[0]].cells[__k[1]].el = __v), (__k) => rows[__k[0]].cells[__k[1]].el, [item.id, col + 1])}`);
  // A literal key is not computed from anything; a spread boxes the function.
  expect(ref(`<div bind:this={els[0]}></div>`)).toBe(`ref={__svelteNativeBind((__k, __v) => (els[0] = __v), (__k) => els[0], [])}`);
  expect(body(`<div {...rest} bind:this={el}></div>`)).toBe(`<native-view {...__svelteNativeWebSpread(rest)} ref={__svelteNativeValue(__svelteNativeBind((__k, __v) => (el = __v), (__k) => el, []))}></native-view>`);
  expect(html(`<div bind:this={el}></div>`)).toContain("hostBind as __svelteNativeBind");
  // A binding with a getter and a setter has no target to follow: it is left for the compiler to refuse.
  expect(body(`<div bind:this={() => el, (v) => (el = v)}></div>`)).toContain("bind:this");
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

test("what an input, a div or a button cannot do on native is an error too: the types, bind: and class: on a component", () => {
  const failure = (source: string): string => { try { html(source); } catch (error) { return (error as Error).message; } return ""; };
  expect(failure(`<input type="radio" name="r">`)).toMatch(/^page\.svelte:1:1 <input type="radio"> is not supported on native: there is no native radio/);
  expect(failure(`<input type="range" />`)).toContain("<input type=\"range\"> is not supported");
  expect(failure(`<input type="date" />`)).toContain("DateTimePicker");
  expect(failure(`<input type="file" />`)).toContain("expo-document-picker");
  expect(failure(`<input type="checkbox" bind:group={g} />`)).toContain("bind:group on <input> is not supported on native");
  expect(failure(`<div bind:clientWidth={w}></div>`)).toBe("page.svelte:1:6 bind:clientWidth on <div> is not supported on native: measure with `onLayout`");
  expect(failure(`<input class:big={on} />`)).toContain("class:big on <input> is not supported on native");
  // A type the browser does not know is a text input there, and here; style: directives work (they are one call).
  expect(failure(`<input type="whatever" />`)).toBe("");
  expect(failure(`<p style:color={c}>x</p>`)).toBe("");
});

test("a <br> is a newline of the text it is in, and an error anywhere else; an <hr> is a view with a hairline default under its class and style", () => {
  expect(body(`<p>a<br>b<br />c</p>`)).toBe(`<native-text>a{"\\n"}b{"\\n"}c</native-text>`);
  // Text beside a break in a view is one line, and the break is in it.
  expect(body(`<div>a<br>b</div>`)).toBe(`<native-view>a{"\\n"}b</native-view>`);
  expect(() => html(`<div><br></div>`)).toThrow(/page\.svelte:1:6 <br> is not supported on native outside text/);
  expect(html(`<hr class="my-2" />`)).toContain(`nativeBase="hairline"`);
  expect(body(`<hr style={{ height: 3 }}>`)).toBe(`<native-view nativeStyle={{ height: 3 }}></native-view>`);
  expect(html(`<hr />`)).not.toContain("renderer");
});

test("a <pre> is a text whose whitespace is its own: the text is a template literal, so Svelte does not trim it, and no line moves", () => {
  const source = `<pre>\n  one\n    <b>two</b>  three \`x\` \\ $&#123;y}\n</pre>\n<div>after</div>`;
  const out = html(source);
  expect(out.split("\n")).toHaveLength(source.split("\n").length);
  // The newline after `<pre>` stays in the source, outside the literal (the first newline of a pre is not text); the others are in the text.
  // biome-ignore lint/suspicious/noTemplateCurlyInString: the expected output is the source of a template literal
  expect(body(source)).toBe("<native-text>\n{`  one\n    `}<native-text>{`two`}</native-text>{`  three \\`x\\` \\\\ \\${y}\n`}</native-text>\n<native-view>after</native-view>");
  // Compiled, the text is the literal: nothing of it is trimmed or collapsed by the compiler (the mounted text is in html-elements.test.ts).
  const code = compiled(out);
  expect(code).toContain("'  one\\n    '");
  expect(code).toContain("three `x` ");
});

test("onkeydown and onkeyup are the component's to work out; a web handler that can never run on a device is a warning naming the file and line; the handlers that do run are not", () => {
  expect(body(`<input onkeydown={down} onkeyup={up} />`)).toBe(`<SvelteNativeTextInput onkeydown={down} onkeyup={up} />`);
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

test("in:, out:, transition: and animate: pass through an HTML element untouched, whatever else is done to it, and are not warned about (the host plays them); an action is", () => {
  const warnings: string[] = [];
  const out = body(`<div in:fly={{ y: 8 }} out:fade={{ duration: 100 }} animate:flip class="a" onclick={go}>x</div><p transition:slide|local>y</p><button in:scale>z</button>`);
  expect(out).toContain("in:fly={{ y: 8 }} out:fade={{ duration: 100 }} animate:flip");
  expect(out).toContain("<native-text transition:slide|local>y</native-text>");
  expect(out).toContain("in:scale>");
  // They are the author's, and the native element plays them (`fabric/transitions.ts`): no error and no notice. An action nothing runs against a DOM is told about, as it was written.
  html(`<div in:fly out:fade transition:slide animate:flip use:tap />`, { warn: (message) => warnings.push(message) });
  expect(warnings.map((message) => /: (\S+) on <div>/.exec(message)?.[1])).toEqual(["use:tap"]);
});

test("style as a string is converted by the class converter when the file is built: units and colors mean what they mean in a class", () => {
  expect(body(`<div style="padding: 4px 8px; color: red; background-color: #fff; font-size: 1rem">a</div>`))
    .toBe(`<native-view nativeStyle={{"paddingTop":4,"paddingRight":8,"paddingBottom":4,"paddingLeft":8,"color":"#ff0000","backgroundColor":"#ffffff","fontSize":16}}>a</native-view>`);
  // A unitless line height waits for the font size the element ends up with.
  expect(body(`<p style="line-height: 1.5; letter-spacing: 0.1em">a</p>`)).toBe(`<native-text nativeStyle={{"fontRelative":{"lineHeight":1.5,"letterSpacing":0.1}}}>a</native-text>`);
  // On a component (an input), the style is the `style` prop; an empty one is nothing.
  expect(body(`<input style="margin: 2px" />`)).toContain(`style={{"marginTop":2,"marginRight":2,"marginBottom":2,"marginLeft":2}}`);
  expect(body(`<div style="">a</div>`)).toBe(`<native-view >a</native-view>`);
  // A declaration the converter cannot express, or a value only the device knows, is an error that names it; so is a string with an expression in it.
  expect(() => html(`<div style="display: flex; float: left">a</div>`)).toThrow(/^page\.svelte:1:6 style="display: flex; float: left" on <div> cannot be converted: float: no React Native style for float/);
  expect(() => html(`<div style="width: 50vw">a</div>`)).toThrow(/cannot be converted: width: a viewport or safe-area unit is only for classes/);
  expect(() => html(`<div style="color: {c}">a</div>`)).toThrow(/^page\.svelte:1:6 style="\.\.\." with \{\.\.\.\} in it is not supported on native: write the style as an object/);
  // An expression stays as it was written (it is parsed when it is text when the app runs).
  expect(body(`<div style={s}>a</div>`)).toBe(`<native-view nativeStyle={s}>a</native-view>`);
});

test("style:property directives are one call that works them out when they change, joined with the style written beside them", () => {
  expect(body(`<div style:color={c} style:font-size="12px" style:width>a</div>`))
    .toBe(`<native-view nativeStyle={__svelteNativeStyleProps({ "color": c, "font-size": "12px", "width": width })}   >a</native-view>`);
  expect(body(`<div style={s} style:color={c}>a</div>`)).toBe(`<native-view nativeStyle={[s, __svelteNativeStyleProps({ "color": c })]} >a</native-view>`);
  expect(body(`<div style="margin: 2px" style:opacity="0.5">a</div>`)).toBe(`<native-view nativeStyle={[{"marginTop":2,"marginRight":2,"marginBottom":2,"marginLeft":2}, __svelteNativeStyleProps({ "opacity": "0.5" })]} >a</native-view>`);
  expect(body(`<input style:color={c} />`)).toContain(`style={__svelteNativeStyleProps({ "color": c })}`);
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

test("a piece of source that is written twice is put on one line, unless that changes what it says: a comment that runs to the end of the line, a template literal with a line break in it", () => {
  expect(oneLine("els[\n    i\n  ]")).toBe("els[ i ]");
  expect(oneLine("a ===\n  \"x\"")).toBe('a === "x"');
  // A `//` or a quote inside a string is not a comment, and a block comment is closed on the line it is flattened to.
  expect(oneLine('els[\n  "a//b"\n]')).toBe('els[ "a//b" ]');
  expect(oneLine("els[\n  'it\\'s // here'\n]")).toBe("els[ 'it\\'s // here' ]");
  expect(oneLine("a /* one\n two */ + b")).toBe("a /* one two */ + b");
  // biome-ignore lint/suspicious/noTemplateCurlyInString: the source of a template literal
  expect(oneLine("`one ${a}`\n+ b")).toBe("`one ${a}` + b");
  // biome-ignore lint/suspicious/noTemplateCurlyInString: the source of a template literal
  for (const source of ["a // note\n + b", "a\n/* x */ // y\n+ b", "`one\ntwo`\n+ b", "x\n+ `a ${b}\n`"]) expect(oneLine(source), source).toBe(source);
  // A target that cannot be flattened is written as it is, and what it adds is the file's to know (the docs say so).
  const source = `<script>let els = [], i = 0;</script>\n<div bind:this={els[\n  // the row\n  i\n]}>x</div>`;
  expect(html(source).split("\n").length).toBeGreaterThan(source.split("\n").length);
});
