import { expect, test } from "bun:test";
import { compile } from "svelte/compiler";
import { lowerPrimitives } from "../src/lower.ts";

/**
 * What the lowering of HTML (`lower-html.ts`) writes is compiled by the real Svelte compiler, with the custom renderer, and its lines are counted: a file that lowers into text that does not
 * compile, or into text whose line numbers moved (a compiler error then points at the wrong line), is a bug, whatever the markup. A property test writes many random files (elements nested
 * in elements, blocks, attributes, expressions that span lines), and the cases below are the ones it found and the ones a review did.
 */
const compiled = (lowered: string) => compile(lowered, { filename: "/app/page.svelte", generate: "client", runes: true, experimental: { customRenderer: "@example/svelte-native/renderer" } }).js.code;
const lower = (source: string) => lowerPrimitives(source, { filename: "page.svelte", html: true, warn: () => {} });
const prelude = `<script lang="ts">
  import { View, Text } from "@example/svelte-native";
  let a = $state(""); let b = $state(true); let n = $state(1); let c = $state("red"); let w = $state("10px");
  let el = $state<unknown>(null); let els = $state<unknown[]>([]); let i = 0; let show = $state(false); let list = $state([1, 2]);
  let { rest = {}, children }: { rest?: Record<string, unknown>; children?: () => unknown } = $props();
  const go = (event?: unknown) => {};
  const act = (node: unknown) => {};
  const mk = (value: unknown) => value;
  const styles = { box: { padding: 2 } };
</script>
`;

/** The lowered file compiles, has as many lines as the source, and the line at the end of it is the same one. */
function exact(source: string): string {
  const out = lower(source);
  expect(out.split("\n")).toHaveLength(source.split("\n").length);
  const marker = source.split("\n").findIndex((line) => line.includes("id=\"end\""));
  if (marker >= 0) expect(out.split("\n")[marker]).toContain('id="end"');
  compiled(out);
  return out;
}

test("an expression that spans lines is where it was, whichever way the lowering uses it: moved into a handler, a style call, an attribute of another name, a ref", () => {
  const end = `\n<p id="end">end</p>`;
  const cases: Record<string, string> = {
    link: `<a\n  href={\n    b\n      ? "/a"\n      : "/b"\n  }\n  class="x"\n>text</a>`,
    "link with a handler": `<a\n  onclick={(event) => {\n    go(event);\n  }}\n  href={\n    a\n  }\n>text</a>`,
    "button disabled": `<button\n  disabled={\n    a === "" &&\n    b\n  }\n  onclick={go}\n>x</button>`,
    "button handler": `<button onclick={() => {\n  go();\n  go();\n}}>x</button>`,
    "input type": `<input\n  type={\n    b\n      ? "text"\n      : "password"\n  }\n  bind:value={a}\n/>`,
    "input handlers": `<input\n  oninput={(event) => {\n    go(event);\n  }}\n  onchange={\n    go\n  }\n  on:keyup={\n    go\n  }\n  onkeydown={(event) => {\n    go(event);\n  }}\n/>`,
    "style directives": `<div\n  style:color={\n    c\n  }\n  style:width={\n    w\n  }\n  style:opacity="0.5"\n>x</div>`,
    "style with directives": `<div\n  style={{\n    padding: 4,\n  }}\n  style:color={\n    c\n  }\n>x</div>`,
    "style string": `<div style="\n  padding: 4px;\n  color: red;\n">x</div>`,
    "dialog": `<dialog\n  bind:open={\n    show\n  }\n  onclose={\n    () => {}\n  }\n>x</dialog>`,
    "dialog handlers": `<dialog\n  open={\n    show\n  }\n  on:close={\n    go\n  }\n>x</dialog>`,
    "bind this": `<div\n  bind:this={\n    els[\n      i\n    ]\n  }\n>x</div>`,
    "checkbox": `<input\n  type="checkbox"\n  bind:checked={\n    b\n  }\n  onchange={\n    (event) => go(event)\n  }\n/>`,
    "textarea": `<textarea>\n  line {\n    n\n  }\n  more\n</textarea>`,
    "textarea with value": `<textarea\n  bind:value={\n    a\n  }\n>\n  ignored\n</textarea>`,
    "image": `<img\n  src={\n    a\n  }\n  alt="x"\n  width="10"\n/>`,
    "pre": `<pre>\n  a\n    <b>\n      c\n    </b>\n  d\n</pre>`,
    "pre with a button": `<pre><button>\n a\n</button></pre>`,
    "head": `<svelte:head>\n  <title>T</title>\n  <meta\n    name="a"\n  >\n</svelte:head>`,
    "br": `<div><br>text</div><p>a<br>\nb</p>`,
    "element": `<svelte:element\n  this={\n    a || "div"\n  }\n>x</svelte:element>`,
    "class": `<div\n  class={[\n    "a",\n    b && "c",\n  ]}\n  class:on={\n    b\n  }\n>x</div>`,
  };
  for (const [name, markup] of Object.entries(cases)) {
    try {
      exact(`${prelude}${markup}${end}`);
    } catch (error) {
      throw new Error(`${name}: ${(error as Error).message}`, { cause: error });
    }
  }
});

test("edits that start at the same place apply the longer one first: an insertion lands in front of what replaces the text it is in front of", () => {
  // `class:loud` is the first attribute of a View with a spread: the `nativeClass` written there and the directive that is taken out start at the same place.
  const source = `<script>\n  import { View } from "@example/svelte-native";\n  let { rest } = $props();\n  let on = $state(true);\n</script>\n<View class:loud={on} {...rest} />`;
  const out = lowerPrimitives(source, { warn: () => {} });
  expect(out).toContain(`<native-view nativeClass={__svelteNativeClass({ "loud": on })}  {...__svelteNativeSpread(rest, { "loud": on })} ></native-view>`);
  compiled(out);
  // A break and the text beside it, a pre with an element in it: the texts that were garbage when the order was by start only.
  for (const markup of [`<div><br>text</div>`, `<pre><button>\n a\n</button></pre>`, `<p><br><br>x</p>`, `<div>a<br>b<span>c</span></div>`]) exact(`${prelude}${markup}`);
});

// --- A property test: random files ---

/** A small deterministic generator (mulberry32): the same seed is the same files. */
function random(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A random file: elements nested in elements (what Svelte allows in what), blocks, snippets, `{#await}`, `<svelte:element>`, spreads, and attributes whose values span lines. Each
 * top-level piece is followed by a comment that says which piece it is (`<!--@@3-->`), on a line of its own, so the test can tell where a line went and not only how many there are.
 */
function generate(next: () => number): string {
  let marks = 0;
  const marker = (): string => `\n<!--@@${marks++}-->\n`;
  const pick = <T,>(items: readonly T[]): T => items[Math.floor(next() * items.length)] as T;
  const chance = (p: number): boolean => next() < p;
  // A gap between the pieces of a tag, which may be a line break.
  const gap = (): string => pick([" ", " ", "\n  ", "\n"]);
  const wrap = (text: string): string => (chance(0.3) ? text.replace(/ /g, () => pick([" ", "\n    "])) : text);
  const expression = (): string => wrap(pick(["a", "b", "n", "a + 1", "b ? 1 : 2", "list.length", "go"]));
  const handler = (): string => pick(["go", "() => go()", "(event) => { go(event); }", "() => { go(); go(); }", "(event) => {\n    go(event);\n  }"]);
  const attributes = (kind: string): string => {
    const found: string[] = [];
    if (chance(0.5)) found.push(pick([`class="a b"`, `class={[ "a", b && "c" ]}`, `class={[\n "a",\n b && "c",\n]}`, `class="x {a}"`, `class="x\n  {a}\n  y"`]));
    if (chance(0.25)) found.push(pick([`class:on={b}`, `class:on`, `class:on={\n b\n}`, `class:on={a ===\n "x"}`]));
    // A `<View>` and a `<Text>` take the paths of a lowered tag, but a style string and `style:` are HTML's: what they take is an object.
    const component = kind === "View" || kind === "Text";
    if (chance(0.35)) {
      found.push(pick(component ? [`style={{ color: c }}`, `style={{\n  color: c,\n  padding: 4,\n}}`, `style={mk(\n c\n)}`, `style={styles.box}`, `style={{ ...mk(\n c\n) }}`, `style={{\n  // lead\n  color: c,\n}}`, `style={{ backgroundImage: "url(http://x)",\n  color: c }}`] : [
        `style="color: red; padding: 4px"`, `style="\n  color: red;\n  padding: 4px\n"`, `style={{ color: c }}`, `style={{\n  color: c,\n  padding: 4,\n}}`, `style={mk(\n c\n)}`, `style={[{ margin: 2 },\n {\n padding: 4 }]}`,
        `style:color={c}`, `style:color={\n c\n}`, `style:width={\n w\n}`, `style:opacity="0.5"`,
      ]));
    }
    if (chance(0.3)) found.push(`id="i${Math.floor(next() * 5)}"`);
    if (chance(0.2)) found.push(pick([`bind:this={el}`, `bind:this={els[i]}`, `bind:this={\n  el\n}`, `bind:this={els[\n  i\n]}`, `bind:this={els[\n  i +\n 1\n]}`]));
    if (chance(0.15)) found.push(pick(["{...rest}", "{...\n  rest\n}"]));
    if (chance(0.1)) found.push("use:act");
    if (kind === "button" || kind === "div" || kind === "span" || kind === "p" || kind === "a") {
      if (chance(0.4)) found.push(pick([`onclick={${handler()}}`, `on:click={${handler()}}`, "onclick={go}", "on:mouseover={go}"]));
    }
    if (kind === "a" && chance(0.7)) found.push(pick([`href="/x"`, `href={\n    a\n  }`, `href="/p/{n}"`, `href="/p/{\n n\n}/x"`]));
    if (kind === "button" && chance(0.4)) found.push(pick([`type="button"`, `type={a}`, `type={\n a\n}`, "disabled", `disabled={${expression()}}`, `disabled={\n a === "" &&\n b\n}`]));
    if (kind === "form" && chance(0.5)) found.push(`onsubmit={${handler()}}`);
    return found.length === 0 ? "" : found.map((item) => `${gap()}${item}`).join("");
  };
  const text = (): string => pick(["plain text", "two words", "text\n  across lines", " spaced ", "&nbsp;", "a &amp; b", "{a}", "x {n} y", "{#if b}shown{/if}", "{expression}"]).replace("{expression}", `{${expression()}}`);
  // What may be inside what: Svelte refuses `<ul>` in a `<p>` and a button in a button, so text-like elements hold text-like ones, as HTML says.
  const PHRASING = ["Text", "span", "b", "em", "code", "small", "a", "button", "img", "input", "checkbox", "textarea", "br", "label"] as const;
  const FLOW = [...PHRASING, "View", "View", "div", "p", "ul", "li", "h1", "form", "section", "pre", "dialog", "hr"] as const;
  const element = (depth: number, phrasing: boolean, inside: string): string => {
    const kinds = (phrasing ? PHRASING : FLOW).filter((kind) => !(kind === inside && (kind === "a" || kind === "button" || kind === "label" || kind === "p" || kind === "li")));
    const kind = pick(kinds);
    const holdsPhrasing = ["Text", "span", "b", "em", "code", "small", "a", "button", "label", "p", "h1", "pre"].includes(kind);
    const children = (count = 3): string => Array.from({ length: Math.floor(next() * (count + 1)) }, () => node(depth + 1, phrasing || holdsPhrasing, kind)).join(pick(["", marker(), " "]));
    switch (kind) {
      case "img": return `<img${attributes("img")} src={a}${chance(0.5) ? " />" : ">"}`;
      case "hr": return pick(["<hr>", "<hr />"]);
      case "br": return pick(["<br>", "<br />"]);
      case "input": return `<input${attributes("input")}${pick([" bind:value={a}", ` type="email"`, ` type={a}`, " disabled", ` maxlength="3"`, ` oninput={${handler()}}`, " on:keyup={go}"])}${pick([" />", ">"])}`;
      case "checkbox": return `<input type="checkbox"${pick([" bind:checked={b}", " checked", ` onchange={${handler()}}`])}${chance(0.3) ? attributes("x") : ""}${pick([" />", ">"])}`;
      case "textarea": return `<textarea${attributes("x")}${pick([" bind:value={a}", ""])}>${chance(0.5) ? pick(["plain", "line\n  two {n}", "{a}"]) : ""}</textarea>`;
      case "dialog": return `<dialog${pick([" open", " open={b}", " bind:open={show}", ""])}${chance(0.3) ? ` onclose={${handler()}}` : ""}>${children(2)}</dialog>`;
      default: return `<${kind}${attributes(kind)}>${children()}</${kind}>`;
    }
  };
  const node = (depth: number, phrasing = false, inside = ""): string => {
    if (depth > 3) return text();
    const roll = next();
    if (roll < 0.28) return text();
    if (roll < 0.34) return `{#if b}${node(depth + 1, phrasing, inside)}${chance(0.5) ? `{:else}${node(depth + 1, phrasing, inside)}` : ""}{/if}`;
    if (roll < 0.39) return `{#each list as item (item)}${node(depth + 1, phrasing, inside)}{/each}`;
    if (roll < 0.42) return "{@render children?.()}";
    if (roll < 0.44) return "<!-- note -->";
    if (roll < 0.46) return `{#key n}${node(depth + 1, phrasing, inside)}{/key}`;
    if (roll < 0.47) return `{#snippet s${marks}(v)}${node(depth + 1, phrasing, inside)}{/snippet}{@render s${marks++}(n)}`;
    if (roll < 0.48) return `{#await Promise.resolve(1) then v}${node(depth + 1, phrasing, inside)}{:catch}x{/await}`;
    if (roll < 0.49) return `{#if b}{@const q${marks} = n + 1}{q${marks++}}{/if}`;
    if (roll < 0.51 && !phrasing) return `<svelte:element this={pick([a, "div", "span"])}${attributes("div")}>${node(depth + 1, phrasing, "div")}</svelte:element>`;
    if (roll < 0.52 && !phrasing) return `<svelte:element this="${pick(["div", "span", "p", "b"])}"${attributes("div")}>${node(depth + 1, phrasing, "div")}</svelte:element>`;
    return element(depth, phrasing, inside);
  };
  const lines: string[] = [];
  for (let index = 0; index < 1 + Math.floor(next() * 3); index++) lines.push(node(0));
  return `${prelude}${chance(0.1) ? "<svelte:head><title>T</title></svelte:head>\n" : ""}${lines.join(marker())}\n<p id="end">end</p>`;
}

/** What is wrong with a lowered file, or nothing: it keeps every line where it was (by the markers, and by how many there are), it calls only helpers it imports, and the compiler takes it. */
function problems(source: string, out: string): string | undefined {
  const before = source.split("\n");
  const after = out.split("\n");
  for (const [index, line] of before.entries()) {
    const marked = /<!--@@(\d+)-->/.exec(line);
    if (marked && !(after[index] ?? "").includes(marked[0])) return `marker ${marked[1]} moved from line ${index + 1}`;
  }
  if (before.length !== after.length) return `${before.length} lines became ${after.length}`;
  // The helpers the generated code calls are imported (or declared) by the file: a name that is not would be a ReferenceError when the app runs, which no compiler sees.
  const known = new Set([...out.matchAll(/ as (__svelteNative\w+)/g), ...out.matchAll(/const (__svelteNative\w+)/g)].map((match) => match[1]));
  for (const name of new Set(out.match(/__svelteNative\w+/g))) if (!known.has(name)) return `${name} is used and not imported`;
  try {
    compiled(out);
  } catch (error) {
    return (error as Error).message.split("\n")[0];
  }
  return undefined;
}

test("random files of nested HTML, blocks, snippets, attributes and expressions that span lines lower into text that compiles, keeps every line where it was and imports what it calls", () => {
  const failures: string[] = [];
  let lowered = 0;
  const seeds = Number(process.env.SEEDS ?? 1500);
  for (let seed = 1; seed <= seeds; seed++) {
    const source = generate(random(seed));
    let out: string;
    try {
      out = lower(source);
    } catch (error) {
      // A file the lowering refuses on purpose (a `<br>` outside text) is not a failure of it.
      if (/is not supported on native/.test((error as Error).message)) continue;
      failures.push(`seed ${seed}: lowering threw ${(error as Error).message.split("\n")[0]}`);
      continue;
    }
    lowered++;
    const wrong = problems(source, out);
    if (wrong !== undefined) failures.push(`seed ${seed}: ${wrong}\n${source}`);
  }
  expect(failures.slice(0, 3)).toEqual([]);
  // Most files lower (the ones that do not hold a `<br>` outside text, which is an error on purpose).
  expect(lowered).toBeGreaterThan(seeds * 0.6);
}, 120_000);
