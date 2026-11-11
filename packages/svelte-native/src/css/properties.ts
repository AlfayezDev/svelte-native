/**
 * CSS declarations to React Native style keys. Every shorthand is written as its longhand keys (`padding: 16px` is the four sides,
 * `inset`, `gap`, `border-radius`, `border-width` and `border-color` likewise): a style is merged key by key in cascade order, and
 * React Native itself would rank `paddingLeft` above `paddingHorizontal` above `padding` whatever the order of the CSS, so only
 * longhands keep `p-4 px-2` and `px-2 p-4` the way the cascade says.
 */
import { colorAlpha, convertColor } from "./color.ts";
import { splitTop } from "./parse.ts";
import { type DynamicValue, type StyleValue, TRANSFORM_KEYS } from "./table.ts";
import { clean, evaluate, type Quantity, soleVar, substituteVars, toAngle, toLength, toNumber, type VarLookup } from "./values.ts";

export type Env = { remPx: number; lookup: VarLookup };
export type Result = {
  /** `null` is a reset: the key a declaration of the property's initial value (`shadow-none`, `translate-none`) takes away from earlier rules. */
  style: Record<string, StyleValue | null>;
  dynamic: Record<string, DynamicValue>;
  fontRelative: Partial<Record<"lineHeight" | "letterSpacing", number>>;
};
export type Report = (property: string, reason: string) => void;

export const emptyResult = (): Result => ({ style: {}, dynamic: {}, fontRelative: {} });
export const isEmptyResult = (result: Result) => Object.keys(result.style).length + Object.keys(result.dynamic).length + Object.keys(result.fontRelative).length === 0;

/** An entry of a lookup table the CSS did not name by accident: a property called `constructor` is not `Object`'s. */
function own<T>(table: Record<string, T>, key: string): T | undefined {
  return Object.hasOwn(table, key) ? table[key] : undefined;
}

type LengthOptions = { percent?: boolean; keywords?: Record<string, number | string | null> };

/** What a handler works with: the declaration's property (for reports), the environment and the result it writes to. */
class Declaration {
  constructor(
    readonly property: string,
    readonly env: Env,
    readonly out: Result,
    private readonly report: Report,
  ) {}

  fail(reason: string): void {
    this.report(this.property, reason);
  }

  // A later declaration of the same key replaces an earlier one, whichever of the three places the earlier one put it in.
  set(key: string, value: StyleValue | null): void {
    delete this.out.dynamic[key];
    if (key === "lineHeight" || key === "letterSpacing") delete this.out.fontRelative[key];
    this.out.style[key] = value;
  }

  setDynamic(key: string, value: DynamicValue): void {
    delete this.out.style[key];
    this.out.dynamic[key] = value;
  }

  setRelative(key: "lineHeight" | "letterSpacing", value: number): void {
    delete this.out.style[key];
    this.out.fontRelative[key] = value;
  }

  /** Writes a length to `key`: dp, a percentage string, a keyword (`null` for one that resets the key), or a dynamic value. Returns false (after reporting) when it is none of them. */
  length(key: string, text: string, options: LengthOptions = {}): boolean {
    const keyword = options.keywords === undefined ? undefined : own(options.keywords, text.trim().toLowerCase());
    if (keyword !== undefined) {
      this.set(key, keyword);
      return true;
    }
    // A word that is not a keyword of this property (`fit-content`, `none`, `max-content`) has no React Native equivalent.
    if (/^[a-z][a-z-]*$/i.test(text.trim()) && !/^(infinity|pi|e)$/i.test(text.trim())) return this.bad(`${text} has no React Native equivalent`);
    const evaluated = evaluate(text, this.env.remPx);
    if ("error" in evaluated) return this.bad(evaluated.error);
    const length = toLength(evaluated.q, { percent: options.percent === true });
    if ("error" in length) return this.bad(`${text}: ${length.error}`);
    if ("dynamic" in length) this.setDynamic(key, length.dynamic);
    else this.set(key, length.value);
    return true;
  }

  number(key: string, text: string, options: { percent?: boolean } = {}): boolean {
    const evaluated = evaluate(text, this.env.remPx);
    if ("error" in evaluated) return this.bad(evaluated.error);
    const number = toNumber(evaluated.q, options);
    if ("error" in number) return this.bad(`${text} is not a number`);
    this.set(key, number.value);
    return true;
  }

  color(keys: string[], text: string): boolean {
    const color = convertColor(text);
    if ("error" in color) return this.bad(color.error);
    for (const key of keys) this.set(key, color.color);
    return true;
  }

  keyword(key: string, text: string, map: Record<string, string>): boolean {
    const value = own(map, text.trim().toLowerCase());
    if (value === undefined) return this.bad(`${text} has no React Native equivalent`);
    this.set(key, value);
    return true;
  }

  quantity(text: string): Quantity | null {
    const evaluated = evaluate(text, this.env.remPx);
    if ("error" in evaluated) {
      this.bad(evaluated.error);
      return null;
    }
    return evaluated.q;
  }

  private bad(reason: string): false {
    this.fail(reason);
    return false;
  }
}

type Handler = (d: Declaration, text: string) => void;

/** A keyword map where each word is its own value. */
const same = (...words: string[]): Record<string, string> => Object.fromEntries(words.map((word) => [word, word]));

// --- Shorthand helpers -------------------------------------------------------------------------------------------------------

/** One to four values around a box: `[top, right, bottom, left]`. */
function around(parts: string[]): [string, string, string, string] | null {
  const [a, b, c, d] = parts;
  if (a === undefined || parts.length > 4) return null;
  if (b === undefined) return [a, a, a, a];
  if (c === undefined) return [a, b, a, b];
  if (d === undefined) return [a, b, c, b];
  return [a, b, c, d];
}

function pair(parts: string[]): [string, string] | null {
  const [a, b] = parts;
  if (a === undefined || parts.length > 2) return null;
  return [a, b ?? a];
}

/** A handler that writes one to four values to `keys` (top, right, bottom, left) through `write`. */
function edges(keys: readonly [string, string, string, string], write: (d: Declaration, key: string, text: string) => void): Handler {
  return (d, text) => {
    const values = around(splitTop(text, " "));
    if (values === null) return d.fail(`${text} is not one to four values`);
    for (const [i, key] of keys.entries()) write(d, key, values[i] as string);
  };
}

function twoEdges(keys: readonly [string, string], write: (d: Declaration, key: string, text: string) => void): Handler {
  return (d, text) => {
    const values = pair(splitTop(text, " "));
    if (values === null) return d.fail(`${text} is not one or two values`);
    for (const [i, key] of keys.entries()) write(d, key, values[i] as string);
  };
}

function one(key: string, write: (d: Declaration, key: string, text: string) => void): Handler {
  return (d, text) => write(d, key, text);
}

const spacing = (d: Declaration, key: string, text: string) => d.length(key, text, { percent: true });
const margin = (d: Declaration, key: string, text: string) => d.length(key, text, { percent: true, keywords: { auto: "auto" } });
const sizing = (d: Declaration, key: string, text: string) => d.length(key, text, { percent: true, keywords: { auto: "auto" } });
const maxSizing = (d: Declaration, key: string, text: string) => d.length(key, text, { percent: true, keywords: { auto: "auto", none: null } });
const borderWidth = (d: Declaration, key: string, text: string) => d.length(key, text, { keywords: { thin: 1, medium: 3, thick: 5 } });
const borderColor = (d: Declaration, key: string, text: string) => void d.color([key], text);
const radius = (d: Declaration, key: string, text: string) => {
  // `rounded-full` is `calc(infinity * 1px)` (or a huge px count): the usual React Native answer is a radius larger than any view.
  const q = d.quantity(text);
  if (q === null) return;
  const px = q.px ?? 0;
  if (Object.keys(q).length === 1 && "px" in q && px > 1e6) d.set(key, 9999);
  else d.length(key, text, { percent: true });
};

const SIDE_KEYS = (prefix: string, suffix = "") => [`${prefix}Top${suffix}`, `${prefix}Right${suffix}`, `${prefix}Bottom${suffix}`, `${prefix}Left${suffix}`] as const;

/** `padding`, `margin`, `border-width`, `border-color`, `inset` families: the physical sides, plus the logical ones React Native has (`Start`/`End`). */
function boxFamily(
  prefix: string,
  cssPrefix: string,
  suffix: string,
  cssSuffix: string,
  write: (d: Declaration, key: string, text: string) => void,
  handlers: Record<string, Handler>,
): void {
  const [top, right, bottom, left] = SIDE_KEYS(prefix, suffix);
  const sides = [top, right, bottom, left] as const;
  handlers[`${cssPrefix}${cssSuffix}`] = edges(sides, write);
  for (const [name, key] of [["top", top], ["right", right], ["bottom", bottom], ["left", left]] as const) handlers[`${cssPrefix}-${name}${cssSuffix}`] = one(key, write);
  handlers[`${cssPrefix}-inline${cssSuffix}`] = twoEdges([left, right], write);
  handlers[`${cssPrefix}-block${cssSuffix}`] = twoEdges([top, bottom], write);
  handlers[`${cssPrefix}-inline-start${cssSuffix}`] = one(`${prefix}Start${suffix}`, write);
  handlers[`${cssPrefix}-inline-end${cssSuffix}`] = one(`${prefix}End${suffix}`, write);
  handlers[`${cssPrefix}-block-start${cssSuffix}`] = one(top, write);
  handlers[`${cssPrefix}-block-end${cssSuffix}`] = one(bottom, write);
}

// --- Handlers ----------------------------------------------------------------------------------------------------------------

const handlers: Record<string, Handler> = {};
boxFamily("padding", "padding", "", "", spacing, handlers);
boxFamily("margin", "margin", "", "", margin, handlers);
boxFamily("border", "border", "Width", "-width", borderWidth, handlers);
boxFamily("border", "border", "Color", "-color", borderColor, handlers);

// `inset` and `top`/`right`/`bottom`/`left` write the position keys, which have no prefix.
{
  const keys = ["top", "right", "bottom", "left"] as const;
  handlers.inset = edges(keys, sizing);
  for (const key of keys) handlers[key] = one(key, sizing);
  handlers["inset-inline"] = twoEdges(["left", "right"], sizing);
  handlers["inset-block"] = twoEdges(["top", "bottom"], sizing);
  handlers["inset-inline-start"] = one("start", sizing);
  handlers["inset-inline-end"] = one("end", sizing);
  handlers["inset-block-start"] = one("top", sizing);
  handlers["inset-block-end"] = one("bottom", sizing);
}

for (const [property, key] of [["width", "width"], ["height", "height"], ["min-width", "minWidth"], ["min-height", "minHeight"]] as const) {
  handlers[property] = one(key, sizing);
}
// `max-w-none` is the initial value: it takes a max width away.
handlers["max-width"] = one("maxWidth", maxSizing);
handlers["max-height"] = one("maxHeight", maxSizing);

// Corners, in `border-radius` order: top-left, top-right, bottom-right, bottom-left.
handlers["border-radius"] = (d, text) => {
  if (text.includes("/")) return d.fail("elliptical radii (a / b) are not supported");
  const values = around(splitTop(text, " "));
  if (values === null) return d.fail(`${text} is not one to four values`);
  const keys = ["borderTopLeftRadius", "borderTopRightRadius", "borderBottomRightRadius", "borderBottomLeftRadius"];
  // `around` returns the values by position (top, right, bottom, left), which for corners are top-left, top-right, bottom-right, bottom-left.
  for (const [i, key] of keys.entries()) radius(d, key, values[i] as string);
};
for (const [property, key] of [
  ["border-top-left-radius", "borderTopLeftRadius"],
  ["border-top-right-radius", "borderTopRightRadius"],
  ["border-bottom-right-radius", "borderBottomRightRadius"],
  ["border-bottom-left-radius", "borderBottomLeftRadius"],
  ["border-start-start-radius", "borderStartStartRadius"],
  ["border-start-end-radius", "borderStartEndRadius"],
  ["border-end-start-radius", "borderEndStartRadius"],
  ["border-end-end-radius", "borderEndEndRadius"],
] as const) {
  handlers[property] = (d, text) => {
    if (splitTop(text, " ").length > 1) return d.fail("elliptical radii (two values) are not supported");
    radius(d, key, text);
  };
}

/** `border-style: none`: no border is drawn, which is no style and a width of 0 on every side (what the style does to the width in CSS). */
function noBorder(d: Declaration): void {
  d.set("borderStyle", null);
  for (const key of SIDE_KEYS("border", "Width")) d.set(key, 0);
}

handlers["border-style"] = (d, text) => {
  const values = splitTop(text, " ");
  if (values.some((value) => value !== values[0])) return d.fail("a different border style per side is not supported");
  if (values[0] === "none" || values[0] === "hidden") return noBorder(d);
  d.keyword("borderStyle", values[0] ?? "", same("solid", "dashed", "dotted"));
};
for (const side of ["top", "right", "bottom", "left", "inline", "block", "inline-start", "inline-end", "block-start", "block-end"]) {
  handlers[`border-${side}-style`] = (d) => d.fail("a border style per side is not supported (React Native has one borderStyle)");
}

/** `border`, `border-top`...: width, style and color in any order. */
function borderShorthand(widthKeys: readonly string[], colorKeys: readonly string[]): Handler {
  return (d, text) => {
    for (const part of splitTop(text, " ")) {
      const word = part.toLowerCase();
      if (word === "solid" || word === "dashed" || word === "dotted") d.set("borderStyle", word);
      else if (word === "none" || word === "hidden") {
        d.set("borderStyle", null);
        for (const key of widthKeys) d.set(key, 0);
      }
      else if (["double", "groove", "ridge", "inset", "outset"].includes(word)) d.fail(`border style ${word} is not supported`);
      else if (["thin", "medium", "thick"].includes(word) || "q" in evaluate(part, d.env.remPx)) for (const key of widthKeys) borderWidth(d, key, part);
      else d.color([...colorKeys], part);
    }
  };
}
handlers.border = borderShorthand(SIDE_KEYS("border", "Width"), SIDE_KEYS("border", "Color"));
for (const side of ["Top", "Right", "Bottom", "Left"]) handlers[`border-${side.toLowerCase()}`] = borderShorthand([`border${side}Width`], [`border${side}Color`]);
handlers["border-inline"] = borderShorthand(["borderLeftWidth", "borderRightWidth"], ["borderLeftColor", "borderRightColor"]);
handlers["border-block"] = borderShorthand(["borderTopWidth", "borderBottomWidth"], ["borderTopColor", "borderBottomColor"]);

// Colors.
handlers["background-color"] = (d, text) => void d.color(["backgroundColor"], text);
handlers.color = (d, text) => void d.color(["color"], text);
handlers.background = (d, text) => {
  // Only a plain color: images, gradients and positions have no style key.
  if (splitTop(text, " ").length > 1 || /^(url|linear-gradient|radial-gradient|conic-gradient)\(/i.test(text)) return d.fail("only a background color is supported");
  d.color(["backgroundColor"], text);
};

// Layout.
handlers.display = (d, text) => {
  // React Native lays everything out as flex, so `block`, `inline` and `inline-block` are `flex` (what `md:block` needs to undo `hidden`); there is no grid or table.
  d.keyword("display", text, { flex: "flex", "inline-flex": "flex", block: "flex", "inline-block": "flex", inline: "flex", "flow-root": "flex", none: "none", contents: "contents" });
};
handlers.position = (d, text) => void d.keyword("position", text, same("absolute", "relative", "static"));
handlers["z-index"] = (d, text) => (text.trim() === "auto" ? d.set("zIndex", null) : void d.number("zIndex", text));
handlers.overflow = (d, text) => {
  const values = splitTop(text, " ");
  if (values.length > 1 && values[0] !== values[1]) return d.fail("a different overflow per axis is not supported");
  d.keyword("overflow", values[0] ?? "", { visible: "visible", hidden: "hidden", clip: "hidden", scroll: "scroll", auto: "scroll" });
};
handlers.opacity = (d, text) => void d.number("opacity", text, { percent: true });
handlers["flex-direction"] = (d, text) => void d.keyword("flexDirection", text, same("row", "row-reverse", "column", "column-reverse"));
handlers["flex-wrap"] = (d, text) => void d.keyword("flexWrap", text, same("wrap", "nowrap", "wrap-reverse"));
handlers["flex-grow"] = (d, text) => void d.number("flexGrow", text);
handlers["flex-shrink"] = (d, text) => void d.number("flexShrink", text);
handlers["flex-basis"] = (d, text) => void d.length("flexBasis", text, { percent: true, keywords: { auto: "auto" } });
handlers.flex = (d, text) => {
  const word = text.trim().toLowerCase();
  const presets: Record<string, [number, number, string]> = { none: [0, 0, "auto"], auto: [1, 1, "auto"], initial: [0, 1, "auto"] };
  const preset = own(presets, word);
  if (preset !== undefined) {
    d.set("flexGrow", preset[0]);
    d.set("flexShrink", preset[1]);
    d.set("flexBasis", preset[2]);
    return;
  }
  // `flex: <grow> [<shrink>] [<basis>]`: numbers first, then the basis; a lone length or percentage is a basis (`flex: 50%`), and the basis defaults to 0.
  const parts = splitTop(text, " ");
  const isFactor = (part: string) => /^[+-]?(\d+\.?\d*|\.\d+)$/.test(part) || /^calc\(\s*[\d.\s*/+-]+\)$/.test(part);
  const factors: string[] = [];
  while (parts.length > 0 && factors.length < 2 && isFactor(parts[0] as string)) factors.push(parts.shift() as string);
  if (parts.length > 1) return d.fail(`${text} is not a flex shorthand`);
  d.number("flexGrow", factors[0] ?? "1");
  d.number("flexShrink", factors[1] ?? "1");
  if (parts[0] === undefined) return d.set("flexBasis", 0);
  d.length("flexBasis", parts[0], { percent: true, keywords: { auto: "auto" } });
  // `flex: 1` is basis `0%`, which in React Native's own `flex: 1` is a basis of 0.
  if (d.out.style.flexBasis === "0%") d.set("flexBasis", 0);
};

handlers["align-items"] = (d, text) => void d.keyword("alignItems", text, { "flex-start": "flex-start", start: "flex-start", "flex-end": "flex-end", end: "flex-end", center: "center", stretch: "stretch", normal: "stretch", baseline: "baseline" });
handlers["align-self"] = (d, text) => void d.keyword("alignSelf", text, { auto: "auto", "flex-start": "flex-start", start: "flex-start", "flex-end": "flex-end", end: "flex-end", center: "center", stretch: "stretch", baseline: "baseline" });
handlers["align-content"] = (d, text) => {
  d.keyword("alignContent", text, { "flex-start": "flex-start", start: "flex-start", "flex-end": "flex-end", end: "flex-end", center: "center", stretch: "stretch", normal: "stretch", "space-between": "space-between", "space-around": "space-around", "space-evenly": "space-evenly" });
};
handlers["justify-content"] = (d, text) => {
  d.keyword("justifyContent", text, { "flex-start": "flex-start", start: "flex-start", normal: "flex-start", "flex-end": "flex-end", end: "flex-end", center: "center", "space-between": "space-between", "space-around": "space-around", "space-evenly": "space-evenly" });
};
handlers.gap = (d, text) => {
  const values = pair(splitTop(text, " "));
  if (values === null) return d.fail(`${text} is not one or two values`);
  d.length("rowGap", values[0]);
  d.length("columnGap", values[1]);
};
handlers["row-gap"] = (d, text) => void d.length("rowGap", text);
handlers["column-gap"] = (d, text) => void d.length("columnGap", text);
handlers["aspect-ratio"] = (d, text) => {
  if (text.trim() === "auto") return d.set("aspectRatio", null);
  const [a, b, extra] = text.split("/");
  if (extra !== undefined || a?.trim() === "auto") return d.fail(`${text} has no React Native equivalent`);
  const ratio = (part: string) => {
    const q = d.quantity(part);
    const n = q === null ? null : toNumber(q);
    return n === null || "error" in n ? null : n.value;
  };
  const numerator = ratio(a ?? "");
  const denominator = b === undefined ? 1 : ratio(b);
  if (numerator === null || denominator === null || denominator === 0) return d.fail(`${text} is not a ratio`);
  d.set("aspectRatio", numerator / denominator);
};

// Text.
handlers["font-size"] = (d, text) => void d.length("fontSize", text);
handlers["font-weight"] = (d, text) => {
  const word = text.trim().toLowerCase();
  if (word === "normal") return d.set("fontWeight", "400");
  if (word === "bold") return d.set("fontWeight", "700");
  const q = d.quantity(text);
  const n = q === null ? null : toNumber(q);
  if (n === null || "error" in n) return d.fail(`font-weight ${text} is not a number`);
  d.set("fontWeight", String(n.value));
};
handlers["font-style"] = (d, text) => void d.keyword("fontStyle", text, { normal: "normal", italic: "italic", oblique: "italic" });
handlers["font-family"] = (d, text) => {
  const first = (splitTop(text, ",")[0] ?? "").replace(/^["']|["']$/g, "").trim();
  if (first === "") return d.fail("empty font-family");
  // The generic and system keywords have no font of that name in React Native; they become the names it does know.
  const alias: Record<string, string> = { "ui-monospace": "monospace", "ui-serif": "serif", "ui-sans-serif": "System", "ui-rounded": "System", "system-ui": "System", "-apple-system": "System", blinkmacsystemfont: "System" };
  d.set("fontFamily", own(alias, first.toLowerCase()) ?? first);
};
handlers["line-height"] = (d, text) => {
  // `normal` is the font's own spacing: React Native's default, so the key is taken away.
  if (text.trim().toLowerCase() === "normal") return d.set("lineHeight", null);
  const q = d.quantity(text);
  if (q === null) return;
  const dims = Object.keys(q).filter((k) => q[k] !== 0);
  // A factor of the font size (`1.5`, `1.5em`, `150%`) is resolved at run time against the merged fontSize; a length is dp.
  if (dims.length === 1 && dims[0] === "") d.setRelative("lineHeight", clean(q[""] as number));
  else if (dims.length === 1 && dims[0] === "em") d.setRelative("lineHeight", clean(q.em as number));
  else if (dims.length === 1 && dims[0] === "%") d.setRelative("lineHeight", clean((q["%"] as number) / 100));
  else d.length("lineHeight", text);
};
handlers["letter-spacing"] = (d, text) => {
  if (text.trim().toLowerCase() === "normal") return d.set("letterSpacing", 0);
  const q = d.quantity(text);
  if (q === null) return;
  const dims = Object.keys(q).filter((k) => q[k] !== 0);
  if (dims.length === 1 && dims[0] === "em") d.setRelative("letterSpacing", clean(q.em as number));
  else d.length("letterSpacing", text);
};
handlers["text-align"] = (d, text) => void d.keyword("textAlign", text, { left: "left", right: "right", center: "center", justify: "justify", start: "auto" });
handlers["text-transform"] = (d, text) => void d.keyword("textTransform", text, same("none", "uppercase", "lowercase", "capitalize"));
const decorationLine: Handler = (d, text) => {
  const words = splitTop(text.toLowerCase(), " ");
  if (words.some((word) => !["underline", "line-through", "none"].includes(word))) return d.fail(`${text} is not supported (underline, line-through and none are)`);
  d.set("textDecorationLine", words.join(" "));
};
handlers["text-decoration-line"] = decorationLine;
handlers["text-decoration"] = (d, text) => {
  if (splitTop(text, " ").length > 1) return d.fail("only the decoration line is supported in text-decoration");
  decorationLine(d, text);
};

// Transforms: the individual properties, as the `transform:*` keys the runtime composes.
/** A transform component: its length, from a `var(--tw-translate-x)` that is still the default `0` meaning "this class does not set it". */
function components(d: Declaration, text: string): (string | null)[] | null {
  const out: (string | null)[] = [];
  for (const part of splitTop(text, " ")) {
    const name = soleVar(part);
    if (name !== null && d.env.lookup(name)?.source === "default") {
      out.push(null);
      continue;
    }
    const resolved = substituteVars(part, d.env.lookup);
    if ("error" in resolved) {
      d.fail(resolved.error);
      return null;
    }
    out.push(resolved.text);
  }
  return out;
}

const rawHandlers: Record<string, Handler> = {
  translate(d, text) {
    if (text.trim() === "none") {
      d.set("transform:translateX", null);
      d.set("transform:translateY", null);
      return;
    }
    const resolved = components(d, text);
    if (resolved === null) return;
    const [x, y, z] = resolved;
    for (const [key, part] of [["transform:translateX", x], ["transform:translateY", y]] as const) {
      if (part === null || part === undefined) continue;
      const q = d.quantity(part);
      if (q === null) continue;
      if ((q["%"] ?? 0) !== 0) {
        d.fail("a percentage translation depends on the element's own size, which a style cannot express");
        continue;
      }
      const length = toLength(q, { percent: false });
      if ("error" in length) d.fail(`${part}: ${length.error}`);
      else if ("dynamic" in length) d.setDynamic(key, length.dynamic);
      else d.set(key, length.value);
    }
    if (z !== null && z !== undefined && z !== "0" && z !== "0px") d.fail("translateZ has no React Native equivalent");
  },
  scale(d, text) {
    if (text.trim() === "none") {
      d.set("transform:scaleX", null);
      d.set("transform:scaleY", null);
      return;
    }
    const resolved = components(d, text);
    if (resolved === null) return;
    const [x, y] = resolved;
    const factor = (part: string): number | null => {
      const q = d.quantity(part);
      const n = q === null ? null : toNumber(q, { percent: true });
      if (n === null || "error" in n) {
        d.fail(`${part} is not a scale factor`);
        return null;
      }
      return n.value;
    };
    // One value scales both axes; Tailwind's `scale-x-*` leaves the other at its default, which this class does not set.
    if (x !== null && x !== undefined) {
      const value = factor(x);
      if (value !== null) {
        d.set("transform:scaleX", value);
        if (resolved.length === 1) d.set("transform:scaleY", value);
      }
    }
    if (y !== null && y !== undefined) {
      const value = factor(y);
      if (value !== null) d.set("transform:scaleY", value);
    }
  },
  rotate(d, text) {
    if (text.trim() === "none") {
      for (const key of ["transform:rotate", "transform:rotateX", "transform:rotateY"]) d.set(key, null);
      return;
    }
    const resolved = components(d, text);
    if (resolved === null) return;
    const words = resolved.filter((part): part is string => part !== null).join(" ").split(/\s+/);
    const axis = /^[xyz]$/i.test(words[0] ?? "") ? (words.shift() as string).toLowerCase() : "z";
    const q = d.quantity(words.join(" "));
    if (q === null) return;
    const angle = toAngle(q);
    if ("error" in angle) return d.fail(`${words.join(" ")} is not an angle`);
    d.set(axis === "x" ? "transform:rotateX" : axis === "y" ? "transform:rotateY" : "transform:rotate", angle.value);
  },
};

handlers["box-shadow"] = (d, text) => {
  if (text.trim().toLowerCase() === "none") return d.set("boxShadow", null);
  const layers: string[] = [];
  for (const layer of splitTop(text, ",")) {
    if (layer === "") continue;
    const tokens = splitTop(layer, " ");
    let inset = false;
    let colorText: string | undefined;
    const lengths: number[] = [];
    for (const token of tokens) {
      if (token.toLowerCase() === "inset") {
        inset = true;
        continue;
      }
      const q = evaluate(token, d.env.remPx);
      if ("q" in q) {
        const length = toLength(q.q, { percent: false });
        if ("error" in length || "dynamic" in length) return d.fail(`box-shadow length ${token} cannot be resolved at build time`);
        lengths.push(length.value as number);
      } else colorText = token;
    }
    if (lengths.length < 2 || lengths.length > 4) return d.fail(`box-shadow layer ${layer} needs two to four lengths`);
    if (colorText === undefined) return d.fail("a box-shadow layer without a color takes the text color (currentColor), which is not supported");
    const color = convertColor(colorText);
    if ("error" in color) return d.fail(`box-shadow color: ${color.error}`);
    if (colorAlpha(color.color) === 0) continue;
    const [x, y, blur = 0, spread = 0] = lengths as [number, number, number?, number?];
    layers.push(`${inset ? "inset " : ""}${x}px ${y}px ${blur}px ${spread}px ${color.color}`);
  }
  // Every layer transparent (`shadow-none` is `0 0 #0000` all the way) is no shadow: the key is taken away.
  d.set("boxShadow", layers.length > 0 ? layers.join(", ") : null);
};

// `transform: none` is Tailwind's `transform-none`; the transform functions themselves are written with `translate`, `rotate` and `scale`.
handlers.transform = (d, text) => {
  if (text.trim().toLowerCase() !== "none") return d.fail(`transform: ${text} is not supported (the translate, rotate and scale properties are)`);
  for (const key of TRANSFORM_KEYS) d.set(key, null);
};

const GLOBAL_KEYWORDS = new Set(["inherit", "initial", "unset", "revert", "revert-layer"]);

/**
 * Converts one declaration into `out`, or reports why it cannot be: its value is resolved against `env` first (`var()` with its
 * fallbacks), except for the transform properties, which look at each component so a default `0` ("not set by this class") is dropped.
 */
export function convertDeclaration(property: string, value: string, env: Env, out: Result, report: Report): void {
  const raw = own(rawHandlers, property);
  const handler = raw ?? own(handlers, property);
  const declaration = new Declaration(property, env, out, report);
  if (handler === undefined) {
    declaration.fail(`no React Native style for ${property}`);
    return;
  }
  if (raw !== undefined) {
    raw(declaration, value);
    return;
  }
  // A value that is only a variable still at its default (`border-style: var(--tw-border-style)`) is Tailwind's slot for another class: this one sets nothing.
  const sole = soleVar(value);
  if (sole !== null && env.lookup(sole)?.source === "default") return;
  const resolved = substituteVars(value, env.lookup);
  if ("error" in resolved) {
    declaration.fail(resolved.error);
    return;
  }
  const text = resolved.text.trim();
  if (GLOBAL_KEYWORDS.has(text.toLowerCase())) declaration.fail(`${text} has no meaning in a class table`);
  else if (text === "") declaration.fail("empty value");
  else handler(declaration, text);
}
