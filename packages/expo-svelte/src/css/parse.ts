/**
 * A small CSS parser for what Tailwind 4 compiles to (and the hand-written CSS next to it): rules, at-rules, declarations, and rules and
 * at-rules nested inside rules. It keeps the source order and nothing else: no specificity, no validation, no value parsing. Comments are
 * dropped, whitespace runs collapse to one space (outside strings), strings and escapes (`\:`, `\/`, `\(`, `\31 0`) stay as written.
 */

export type Declaration = { kind: "decl"; property: string; value: string; important: boolean };
export type Rule = { kind: "rule"; selector: string; body: Item[] };
/** `body` is `null` for a statement (`@layer a, b;`, `@import "x";`). */
export type AtRule = { kind: "at"; name: string; prelude: string; body: Item[] | null };
export type Item = Declaration | Rule | AtRule;

/** Reads from `from` to the first `;`, `{` or `}` outside strings, parentheses, brackets and escapes and returns the text before it (`end` is that character's index). Stops at `;`, `{` or `}` outside strings, parentheses, brackets and escapes, and returns the text before it. */
function readChunk(css: string, from: number): { text: string; end: number } {
  let text = "";
  let depth = 0;
  let i = from;
  let space = false;
  while (i < css.length) {
    const c = css[i] as string;
    if (c === "/" && css[i + 1] === "*") {
      const close = css.indexOf("*/", i + 2);
      i = close < 0 ? css.length : close + 2;
      space = true;
      continue;
    }
    if (c === "\\") {
      // An escape: the next character is part of the text whatever it is.
      if (space && text !== "") text += " ";
      space = false;
      text += c + (css[i + 1] ?? "");
      i += 2;
      continue;
    }
    if (c === '"' || c === "'") {
      if (space && text !== "") text += " ";
      space = false;
      let j = i + 1;
      while (j < css.length && css[j] !== c) j += css[j] === "\\" ? 2 : 1;
      text += css.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    if (depth === 0 && (c === ";" || c === "{" || c === "}")) break;
    if (c === "(" || c === "[") depth++;
    else if (c === ")" || c === "]") depth = Math.max(0, depth - 1);
    if (c === " " || c === "\n" || c === "\t" || c === "\r" || c === "\f") {
      space = true;
      i++;
      continue;
    }
    if (space && text !== "") text += " ";
    space = false;
    text += c;
    i++;
  }
  return { text, end: i };
}

function skipBlank(css: string, from: number): number {
  let i = from;
  while (i < css.length) {
    const c = css[i] as string;
    if (c === " " || c === "\n" || c === "\t" || c === "\r" || c === "\f") i++;
    else if (c === "/" && css[i + 1] === "*") {
      const close = css.indexOf("*/", i + 2);
      i = close < 0 ? css.length : close + 2;
    } else break;
  }
  return i;
}

function parseBody(css: string, from: number, nested: boolean): { items: Item[]; end: number } {
  const items: Item[] = [];
  let i = from;
  while (true) {
    i = skipBlank(css, i);
    if (i >= css.length) return { items, end: i };
    const c = css[i] as string;
    if (c === "}" && nested) return { items, end: i + 1 };
    if (c === ";" || c === "}") {
      i++;
      continue;
    }
    if (c === "@") {
      const { text, end } = readChunk(css, i + 1);
      const space = text.search(/[\s(]/);
      const name = (space < 0 ? text : text.slice(0, space)).toLowerCase();
      const prelude = space < 0 ? "" : text.slice(space).trim();
      if (css[end] === "{") {
        const inner = parseBody(css, end + 1, true);
        items.push({ kind: "at", name, prelude, body: inner.items });
        i = inner.end;
      } else {
        items.push({ kind: "at", name, prelude, body: null });
        i = end + 1;
      }
      continue;
    }
    const { text, end } = readChunk(css, i);
    if (css[end] === "{") {
      const inner = parseBody(css, end + 1, true);
      items.push({ kind: "rule", selector: text, body: inner.items });
      i = inner.end;
      continue;
    }
    i = css[end] === ";" ? end + 1 : end;
    const colon = indexOfTop(text, ":");
    if (colon <= 0) continue;
    const property = text.slice(0, colon).trim();
    let value = text.slice(colon + 1).trim();
    let important = false;
    const bang = /\s*!\s*important\s*$/i.exec(value);
    if (bang) {
      important = true;
      value = value.slice(0, bang.index);
    }
    items.push({ kind: "decl", property: property.startsWith("--") ? property : property.toLowerCase(), value, important });
  }
}

export function parseCss(css: string): Item[] {
  return parseBody(css, 0, false).items;
}

/** The index of the first `char` outside strings, parentheses, brackets and escapes, or -1. */
export function indexOfTop(text: string, char: string): number {
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i] as string;
    if (c === "\\") i++;
    else if (c === '"' || c === "'") {
      i++;
      while (i < text.length && text[i] !== c) i += text[i] === "\\" ? 2 : 1;
    } else if (c === "(" || c === "[") depth++;
    else if (c === ")" || c === "]") depth--;
    else if (depth === 0 && c === char) return i;
  }
  return -1;
}

/** Splits at every `separator` (a comma, a space) outside strings, parentheses, brackets and escapes; empty parts are kept for commas, dropped for spaces. */
export function splitTop(text: string, separator: "," | " "): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  const push = (end: number) => {
    const part = text.slice(start, end).trim();
    if (part !== "" || separator === ",") parts.push(part);
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i] as string;
    if (c === "\\") i++;
    else if (c === '"' || c === "'") {
      i++;
      while (i < text.length && text[i] !== c) i += text[i] === "\\" ? 2 : 1;
    } else if (c === "(" || c === "[") depth++;
    else if (c === ")" || c === "]") depth--;
    else if (depth === 0 && (separator === "," ? c === "," : c === " ")) {
      push(i);
      start = i + 1;
    }
  }
  push(text.length);
  return parts;
}

/** An identifier with its CSS escapes resolved: `md\:p-10` is `md:p-10`, `\32 xl` is `2xl`. Reads from `from` while characters are identifier characters or escapes. */
export function readIdent(text: string, from: number): { name: string; end: number } {
  let name = "";
  let i = from;
  while (i < text.length) {
    const c = text[i] as string;
    if (c === "\\") {
      const hex = /^[0-9a-fA-F]{1,6}/.exec(text.slice(i + 1, i + 7));
      if (hex) {
        const code = Number.parseInt(hex[0], 16);
        name += String.fromCodePoint(code === 0 || code > 0x10ffff ? 0xfffd : code);
        i += 1 + hex[0].length;
        if (/\s/.test(text[i] ?? "")) i++;
      } else {
        name += text[i + 1] ?? "";
        i += 2;
      }
    } else if (/[\w-]/.test(c) || c.charCodeAt(0) > 0x7f) {
      name += c;
      i++;
    } else break;
  }
  return { name, end: i };
}

export type SelectorKind =
  | { kind: "class"; className: string }
  /** A selector the class table cannot express; `className` is the first class in it (what a markup `class` would name), if any. */
  | { kind: "unsupported"; className: string | null; reason: string }
  /** `:root`, `:host`, `html`: where theme variables live. */
  | { kind: "root" };

const ROOT_SELECTORS = new Set([":root", ":host", "html"]);

/** What one selector (no commas) is: a single class, the document root, or something else. */
export function classifySelector(selector: string): SelectorKind {
  const text = selector.trim();
  if (ROOT_SELECTORS.has(text)) return { kind: "root" };
  if (text[0] === "." && text.length > 1) {
    const { name, end } = readIdent(text, 1);
    if (end === text.length && name !== "") return { kind: "class", className: name };
  }
  return { kind: "unsupported", className: firstClass(text), reason: describeSelector(text) };
}

/** The first `.class` in a selector, outside attribute brackets and strings (`:where(.space-x-4 > :not(:last-child))` is `space-x-4`). */
function firstClass(text: string): string | null {
  for (let i = 0; i < text.length; i++) {
    const c = text[i] as string;
    if (c === "\\") i++;
    else if (c === '"' || c === "'") {
      i++;
      while (i < text.length && text[i] !== c) i += text[i] === "\\" ? 2 : 1;
    } else if (c === "[") {
      const close = text.indexOf("]", i);
      i = close < 0 ? text.length : close;
    } else if (c === ".") {
      const { name, end } = readIdent(text, i + 1);
      if (name !== "") return name;
      i = end;
    }
  }
  return null;
}

/** Why a selector is not a single class: the pseudo-element or the first pseudo-class that is not just a wrapper (`:is`, `:where`, `:not`), else the combinator. */
function describeSelector(text: string): string {
  const pseudo: { element: boolean; name: string }[] = [];
  for (let i = 0; i < text.length; i++) {
    const c = text[i] as string;
    if (c === "\\") i++;
    else if (c === ":") {
      const element = text[i + 1] === ":";
      const { name, end } = readIdent(text, i + (element ? 2 : 1));
      pseudo.push({ element, name });
      i = end - 1;
    }
  }
  const element = pseudo.find((p) => p.element);
  if (element) return `pseudo-element ::${element.name} (selector ${text})`;
  if (/[>~]|\s\+\s/.test(text)) return `combinator in selector ${text}`;
  const wrappers = new Set(["is", "where", "not", "has", "matches"]);
  const named = pseudo.find((p) => !wrappers.has(p.name));
  if (named) return `pseudo-class :${named.name} (selector ${text})`;
  if (pseudo.length > 0) return `functional pseudo-class :${(pseudo[0] as { name: string }).name}() depends on other elements (selector ${text})`;
  if (splitTop(text, " ").length > 1) return `combinator in selector ${text}`;
  if (text.startsWith(".") && text.indexOf(".", 1) > 0) return `several classes in selector ${text}`;
  if (text[0] !== ".") return `not a class selector (${text})`;
  return `selector ${text} is not a single class`;
}
