import { expect, test } from "bun:test";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { LEGACY, NAMED } from "../../src/html-entities.ts";
import { decodeEntities, htmlText } from "../../src/html-text.ts";

/**
 * The plain text the clipboard writes for HTML alone (`src/html-text.ts`): character references decode as in HTML's tokenizer (#97). The table of named references is
 * the spec's (`src/html-entities.ts`); Svelte's compiler has its own copy of the spec's file, which keeps the first code point of each name, and every name of it decodes here to that.
 */
const require = createRequire(import.meta.url);
const svelte = dirname(require.resolve("svelte/package.json"));

test("every named reference of Svelte's copy of the spec's table decodes to its character, with and without the semicolon as HTML allows", async () => {
  const { default: svelteEntities } = (await import(pathToFileURL(resolve(svelte, "src/compiler/phases/1-parse/utils/entities.js")).href)) as { default: Record<string, number> };
  const names = Object.keys(svelteEntities);
  expect(names.length).toBe(2231);
  expect(NAMED.split(",").length + LEGACY.split(" ").length).toBe(names.length);
  for (const name of names) expect(decodeEntities(`&${name}`).codePointAt(0), name).toBe(svelteEntities[name]);
  // A name of two code points has both (Svelte's copy keeps the first).
  expect(decodeEntities("&NotEqualTilde;")).toBe("≂̸");
  expect(decodeEntities("&fjlig;")).toBe("fj");
});

test("numeric references, names without their semicolon, and references HTML does not know", () => {
  expect(decodeEntities("Caf&#233; &copy; 2026")).toBe("Café © 2026");
  expect(decodeEntities("Caf&#xE9;&#XE9;&eacute;")).toBe("Caféée");
  expect(decodeEntities("&#1593;&#1585;&#1576;&#1610;")).toBe("عربي");
  expect(decodeEntities("&#128512;&#x1F600;")).toBe("😀😀");
  expect(decodeEntities("&#233 &copy 2026")).toBe("é © 2026");
  expect(decodeEntities("&notit; &notin;")).toBe("¬it; ∉");
  expect(decodeEntities("&amp;lt; &AMP; &lt;b&gt;")).toBe("&lt; & <b>");
  // The C1 controls are Windows-1252's characters, and no character, a surrogate or a number past Unicode is U+FFFD.
  expect(decodeEntities("&#150;&#x80;&#x81;")).toBe("–€\u0081");
  expect(decodeEntities("&#0;&#xD800;&#x110000;&#99999999999;")).toBe("����");
  for (const text of ["&unknown;", "& amp;", "&#;", "&#x;", "a & b", "&;"]) expect(decodeEntities(text)).toBe(text);
});

test("the text of HTML: tags go, blocks end lines, references decode after the tags have gone", () => {
  expect(htmlText("<p>Caf&#233; &copy; 2026</p>")).toBe("Café © 2026");
  expect(htmlText("<p>One &amp; two</p><p>three<br>four</p><script>x()</script>")).toBe("One & two\nthree\nfour");
  expect(htmlText("<p>&lt;b&gt;not bold&lt;/b&gt;</p>")).toBe("<b>not bold</b>");
  expect(htmlText("<b>a&nbsp;b</b>")).toBe("a b");
});
