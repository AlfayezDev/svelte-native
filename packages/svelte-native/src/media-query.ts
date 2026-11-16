/**
 * CSS media queries, evaluated for a device: the parser and the evaluator behind `window.matchMedia` (`match-media.ts`). Pure: a query and the device's state in, a boolean out; it reads
 * nothing from React Native, so the table of queries in `tests/web-apis/media-query.test.ts` runs against plain objects.
 *
 * What is understood is Media Queries 4's grammar: a comma-separated list (`or`), `not`, `only`, a media type (`all` and `screen` are true; `print` and every other type is false), `and`, `or` and
 * `not` between conditions, nested parentheses, and a feature as `(name)`, `(name: value)`, `(min-name: value)` or in the range syntax (`(width >= 600px)`, `(400px <= width < 700px)`).
 * The features are those of `FEATURES` below, each read from `MediaState`.
 *
 * A condition is true, false or unknown, as in the specification. A parenthesis that starts with a name the table does not have, or has a value the feature does not take, and a function
 * (`foo(...)`), are `<general-enclosed>`: unknown. `not` leaves unknown as it is, `and` is false when any part is false and unknown when none is but one is, `or` is true when any part is
 * true and unknown when none is but one is. The query is true only when it is true, so `(foo: bar) or (min-width: 1px)` is true and `not (foo: bar)` is false. What is not a condition at
 * all (`()`, `(: 400px)`, a missing parenthesis, `screen and`) makes its comma-separated query `not all`, and nothing here throws.
 */

/** The device's state a query reads: the window and the screen in points (dp, the px of CSS), the pixel ratio, the system's appearance and accessibility settings. A device reads each field when it is asked. */
export interface MediaState {
  readonly width: number;
  readonly height: number;
  /** The screen: the window with the bars. */
  readonly screenWidth: number;
  readonly screenHeight: number;
  /** Device pixels per point: CSS's `dppx`. */
  readonly scale: number;
  readonly colorScheme: "light" | "dark";
  readonly reducedMotion: boolean;
  readonly highContrast: boolean;
  readonly invertedColors: boolean;
  readonly reducedTransparency: boolean;
}

/** The system sources a query depends on, which a device listens to for as long as a query has listeners: the window's and the screen's size and the ratio, the appearance, and the four accessibility settings. */
export type MediaSource = "window" | "appearance" | "motion" | "contrast" | "inverted" | "transparency";

/** A parsed media query list. */
export interface ParsedMediaQuery {
  /** What `MediaQueryList.media` is: the query as a browser serialises it (lower case, `(min-width: 600px)`, a query that can only be false as `not all`). */
  readonly media: string;
  /** The sources whose change can change `matches`. */
  readonly sources: ReadonlySet<MediaSource>;
  matches(state: MediaState): boolean;
}

type Op = "<" | "<=" | ">" | ">=" | "=";

type Token =
  | { readonly kind: "ident"; readonly name: string }
  | { readonly kind: "function"; readonly name: string }
  | { readonly kind: "number"; readonly value: number }
  | { readonly kind: "dimension"; readonly value: number; readonly unit: string }
  | { readonly kind: "other"; readonly text: string }
  | { readonly kind: "open" | "close" | "comma" | "colon" | "slash" }
  | { readonly kind: "op"; readonly op: Op };

const NUMBER = /[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?/y;
const IDENT = /(?:--|-?[A-Za-z_\u0080-￿])[\w\u0080-￿-]*/y;
const UNIT = /[A-Za-z_\u0080-￿][\w\u0080-￿-]*/y;
const SPACE = /\s/;

/** CSS's tokens, as far as a media query uses them. A function token (`name(`) is its own kind, since `and(` is not `and (`; whitespace and comments are dropped. */
function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  let at = 0;
  while (at < text.length) {
    const char = text[at] as string;
    if (SPACE.test(char)) {
      at++;
      continue;
    }
    if (char === "/" && text[at + 1] === "*") {
      const end = text.indexOf("*/", at + 2);
      at = end < 0 ? text.length : end + 2;
      continue;
    }
    NUMBER.lastIndex = at;
    const number = NUMBER.exec(text);
    if (number) {
      const value = Number(number[0]);
      at = NUMBER.lastIndex;
      UNIT.lastIndex = at;
      const unit = UNIT.exec(text);
      if (unit) {
        at = UNIT.lastIndex;
        tokens.push({ kind: "dimension", value, unit: unit[0].toLowerCase() });
      } else if (text[at] === "%") {
        at++;
        tokens.push({ kind: "other", text: `${value}%` });
      } else tokens.push({ kind: "number", value });
      continue;
    }
    IDENT.lastIndex = at;
    const ident = IDENT.exec(text);
    if (ident) {
      at = IDENT.lastIndex;
      const name = ident[0].toLowerCase();
      if (text[at] === "(") {
        at++;
        tokens.push({ kind: "function", name });
      } else tokens.push({ kind: "ident", name });
      continue;
    }
    at++;
    if (char === "(") tokens.push({ kind: "open" });
    else if (char === ")") tokens.push({ kind: "close" });
    else if (char === ",") tokens.push({ kind: "comma" });
    else if (char === ":") tokens.push({ kind: "colon" });
    else if (char === "/") tokens.push({ kind: "slash" });
    else if (char === "=") tokens.push({ kind: "op", op: "=" });
    else if (char === "<" || char === ">") {
      if (text[at] === "=") {
        at++;
        tokens.push({ kind: "op", op: `${char}=` });
      } else tokens.push({ kind: "op", op: char });
    } else tokens.push({ kind: "other", text: char });
  }
  return tokens;
}

const opens = (token: Token | undefined): boolean => token?.kind === "open" || token?.kind === "function";

/** The comma-separated queries, split where the parentheses are balanced (a comma inside parentheses belongs to a query that will not parse). */
function split(tokens: readonly Token[]): Token[][] {
  if (tokens.length === 0) return [];
  const list: Token[][] = [[]];
  let depth = 0;
  for (const token of tokens) {
    if (token.kind === "comma" && depth === 0) {
      list.push([]);
      continue;
    }
    if (opens(token)) depth++;
    else if (token.kind === "close" && depth > 0) depth--;
    (list[list.length - 1] as Token[]).push(token);
  }
  return list;
}

/** The index of the `)` that closes the parenthesis at `from`, or -1. */
function closing(tokens: readonly Token[], from: number): number {
  let depth = 0;
  for (let at = from; at < tokens.length; at++) {
    const token = tokens[at];
    if (opens(token)) depth++;
    else if (token?.kind === "close" && --depth === 0) return at;
  }
  return -1;
}

/** The tokens as text, as a browser writes a `<general-enclosed>`: lower case, one space between tokens, none inside the parentheses or before a colon or a comma. */
function written(tokens: readonly Token[]): string {
  let text = "";
  let previous: Token | undefined;
  for (const token of tokens) {
    const piece =
      token.kind === "ident" ? token.name
      : token.kind === "function" ? `${token.name}(`
      : token.kind === "number" ? `${token.value}`
      : token.kind === "dimension" ? `${token.value}${token.unit}`
      : token.kind === "other" ? token.text
      : token.kind === "op" ? token.op
      : { open: "(", close: ")", comma: ",", colon: ":", slash: "/" }[token.kind];
    const tight = previous === undefined || opens(previous) || token.kind === "close" || token.kind === "colon" || token.kind === "comma";
    text += tight ? piece : ` ${piece}`;
    previous = token;
  }
  return text;
}

/** Floats from the device (`411.42857142857144`) and from unit conversions (`192dpi`) compare with a margin far below anything a query means. */
function compare(actual: number, op: Op, wanted: number): boolean {
  const margin = Number.isFinite(wanted) ? 1e-9 * Math.max(1, Math.abs(wanted)) : 0;
  switch (op) {
    case "<": return actual < wanted - margin;
    case "<=": return actual <= wanted + margin;
    case ">": return actual > wanted + margin;
    case ">=": return actual >= wanted - margin;
    default: return Math.abs(actual - wanted) <= margin;
  }
}

const flip: Record<Op, Op> = { "<": ">", "<=": ">=", ">": "<", ">=": "<=", "=": "=" };

/** A value as the feature takes it (a number, in the feature's own unit: px, a ratio, dppx; a viewport unit reads the window) and as it is written back. */
interface Value {
  readonly value: (state: MediaState) => number;
  readonly text: string;
  /** What the value reads besides the feature's own source. */
  readonly source?: MediaSource;
}

const fixed = (value: number, text: string): Value => ({ value: () => value, text });

const LENGTH = new Map([["px", 1], ["em", 16], ["rem", 16], ["pt", 96 / 72], ["pc", 16], ["in", 96], ["cm", 96 / 2.54], ["mm", 96 / 25.4], ["q", 96 / 101.6]]);
/** A viewport unit in a media query is a percent of the initial viewport, which on a device is the window. */
const VIEWPORT = new Map<string, (state: MediaState) => number>([
  ["vw", (state) => state.width / 100],
  ["vh", (state) => state.height / 100],
  ["vmin", (state) => Math.min(state.width, state.height) / 100],
  ["vmax", (state) => Math.max(state.width, state.height) / 100],
]);
const RESOLUTION = new Map([["dppx", 1], ["x", 1], ["dpi", 1 / 96], ["dpcm", 2.54 / 96]]);

/** A length is `px`, `em` or `rem` (16px each: a device has no root font size to ask), the other absolute units, `vw`, `vh`, `vmin` or `vmax` (of the window), or a unitless 0. A negative length is a length. */
function length(tokens: readonly Token[]): Value | undefined {
  const [token] = tokens;
  if (tokens.length !== 1) return undefined;
  if (token?.kind === "dimension") {
    const text = `${token.value}${token.unit}`;
    const factor = LENGTH.get(token.unit);
    if (factor !== undefined) return fixed(token.value * factor, text);
    const viewport = VIEWPORT.get(token.unit);
    return viewport ? { value: (state) => token.value * viewport(state), text, source: "window" } : undefined;
  }
  return token?.kind === "number" && token.value === 0 ? fixed(0, "0px") : undefined;
}

/** `16/9`, `16 / 9`, or a number alone (`2` is `2 / 1`). */
function ratio(tokens: readonly Token[]): Value | undefined {
  const [first, slash, second] = tokens;
  if (tokens.length === 1) return first?.kind === "number" && first.value >= 0 ? fixed(first.value, `${first.value}`) : undefined;
  if (tokens.length !== 3 || first?.kind !== "number" || slash?.kind !== "slash" || second?.kind !== "number") return undefined;
  if (first.value < 0 || second.value < 0 || (first.value === 0 && second.value === 0)) return undefined;
  return fixed(first.value / second.value, `${first.value} / ${second.value}`);
}

/** `2dppx`, `2x`, `192dpi`, `75.6dpcm`, or `infinite`. */
function resolution(tokens: readonly Token[]): Value | undefined {
  const [token] = tokens;
  if (tokens.length !== 1) return undefined;
  if (token?.kind === "ident") return token.name === "infinite" ? fixed(Number.POSITIVE_INFINITY, "infinite") : undefined;
  if (token?.kind !== "dimension") return undefined;
  const factor = RESOLUTION.get(token.unit);
  return factor === undefined || token.value < 0 ? undefined : fixed(token.value * factor, `${token.value}${token.unit}`);
}

/** A plain non-negative number (`-webkit-min-device-pixel-ratio: 2`). */
function number(tokens: readonly Token[]): Value | undefined {
  const [token] = tokens;
  return tokens.length === 1 && token?.kind === "number" && token.value >= 0 ? fixed(token.value, `${token.value}`) : undefined;
}

/** A non-negative integer (`color: 8`). */
function integer(tokens: readonly Token[]): Value | undefined {
  const [token] = tokens;
  return token?.kind === "number" && Number.isInteger(token.value) ? number(tokens) : undefined;
}

/** A feature with a number (`width`, `aspect-ratio`, `resolution`, `color`): it takes `min-` and `max-`, comparisons and the range syntax. */
interface RangeFeature {
  readonly kind: "range";
  readonly source: MediaSource | undefined;
  /** `-webkit-device-pixel-ratio`: with the prefixes it has, and no range syntax. */
  readonly legacy?: true;
  read(state: MediaState): number;
  parse(tokens: readonly Token[]): Value | undefined;
}

/** A feature with a keyword (`orientation`, `hover`, `prefers-color-scheme`); `off` are the keywords that are false in `(name)` alone. */
interface KeywordFeature {
  readonly kind: "keyword";
  readonly source: MediaSource | undefined;
  readonly values: readonly string[];
  readonly off: readonly string[];
  /** The keywords from the narrowest to the widest, for a feature whose value includes the ones before it (`color-gamut`: a display of the `p3` gamut matches `srgb` too). */
  readonly order?: readonly string[];
  read(state: MediaState): string;
}

type Feature = RangeFeature | KeywordFeature;

const range = (source: MediaSource | undefined, read: (state: MediaState) => number, parse: RangeFeature["parse"], legacy = false): RangeFeature => ({ kind: "range", source, read, parse, ...(legacy ? { legacy: true as const } : {}) });
const keyword = (source: MediaSource | undefined, read: (state: MediaState) => string, values: readonly string[], off: readonly string[] = [], order?: readonly string[]): KeywordFeature => ({ kind: "keyword", source, read, values, off, order });

const hover = keyword(undefined, () => "none", ["none", "hover"], ["none"]);
const pointer = keyword(undefined, () => "coarse", ["none", "coarse", "fine"], ["none"]);
const GAMUTS = ["srgb", "p3", "rec2020"];

/**
 * What the features read on a device: the window's and the screen's size and the ratio (`Dimensions`), `Appearance`, `AccessibilityInfo`, and what a phone is (a touch screen with no hover, an
 * app that is not in a browser, a display that is not forced into colors and refreshes at once, scripts that run). The gamut is sRGB: React Native cannot say that a display shows more.
 */
const FEATURES = new Map<string, Feature>([
  ["width", range("window", (state) => state.width, length)],
  ["height", range("window", (state) => state.height, length)],
  ["aspect-ratio", range("window", (state) => state.width / state.height, ratio)],
  ["device-width", range("window", (state) => state.screenWidth, length)],
  ["device-height", range("window", (state) => state.screenHeight, length)],
  ["device-aspect-ratio", range("window", (state) => state.screenWidth / state.screenHeight, ratio)],
  ["resolution", range("window", (state) => state.scale, resolution)],
  ["color", range(undefined, () => 8, integer)],
  ["orientation", keyword("window", (state) => (state.height >= state.width ? "portrait" : "landscape"), ["portrait", "landscape"])],
  ["prefers-color-scheme", keyword("appearance", (state) => state.colorScheme, ["light", "dark"])],
  ["prefers-reduced-motion", keyword("motion", (state) => (state.reducedMotion ? "reduce" : "no-preference"), ["no-preference", "reduce"], ["no-preference"])],
  ["prefers-contrast", keyword("contrast", (state) => (state.highContrast ? "more" : "no-preference"), ["no-preference", "more", "less", "custom"], ["no-preference"])],
  ["prefers-reduced-transparency", keyword("transparency", (state) => (state.reducedTransparency ? "reduce" : "no-preference"), ["no-preference", "reduce"], ["no-preference"])],
  ["inverted-colors", keyword("inverted", (state) => (state.invertedColors ? "inverted" : "none"), ["none", "inverted"], ["none"])],
  ["forced-colors", keyword(undefined, () => "none", ["none", "active"], ["none"])],
  ["update", keyword(undefined, () => "fast", ["none", "slow", "fast"], ["none"])],
  ["scripting", keyword(undefined, () => "enabled", ["none", "initial-only", "enabled"], ["none"])],
  ["color-gamut", keyword(undefined, () => "srgb", GAMUTS, [], GAMUTS)],
  ["hover", hover],
  ["any-hover", hover],
  ["pointer", pointer],
  ["any-pointer", pointer],
  ["display-mode", keyword(undefined, () => "standalone", ["browser", "minimal-ui", "standalone", "fullscreen", "picture-in-picture", "window-controls-overlay"])],
]);
const PIXEL_RATIO = range("window", (state) => state.scale, number, true);

/** The feature a name stands for, and the bound its `min-` or `max-` puts on it. */
function lookup(name: string): { feature: Feature; bound: "min" | "max" | undefined } | undefined {
  const direct = FEATURES.get(name);
  if (direct) return { feature: direct, bound: undefined };
  const webkit = /^-webkit-(?:(min|max)-)?device-pixel-ratio$/.exec(name);
  if (webkit) return { feature: PIXEL_RATIO, bound: webkit[1] as "min" | "max" | undefined };
  const prefixed = /^(min|max)-(.+)$/.exec(name);
  const base = prefixed ? FEATURES.get(prefixed[2] as string) : undefined;
  return prefixed && base?.kind === "range" ? { feature: base, bound: prefixed[1] as "min" | "max" } : undefined;
}

/** A condition's value: true, false, or `null` for unknown. */
type Truth = boolean | null;

/** A condition: its serialisation and its test. */
interface Node {
  readonly text: string;
  test(state: MediaState): Truth;
}

/** What parsing one query learns: the sources of its features, and how many of its conditions are features that are known and how many are unknown. */
interface Context {
  readonly sources: Set<MediaSource>;
  known: number;
  unknown: number;
}

const MAX_DEPTH = 32;

const negate = (value: Truth): Truth => (value === null ? null : !value);

/** A `<general-enclosed>`: a parenthesis or a function the table does not understand. It is unknown. */
function unknownNode(text: string, context: Context): Node {
  context.unknown++;
  return { text, test: () => null };
}

function booleanNode(name: string, feature: Feature, context: Context): Node {
  context.known++;
  if (feature.source) context.sources.add(feature.source);
  return { text: `(${name})`, test: feature.kind === "range" ? (state) => feature.read(state) !== 0 : (state) => !feature.off.includes(feature.read(state)) };
}

/** `(name: value)`, `(min-name: value)`: a node, or `undefined` when the value is not understood. */
function plainNode(name: string, found: NonNullable<ReturnType<typeof lookup>>, tokens: readonly Token[], context: Context): Node | undefined {
  const { feature, bound } = found;
  if (feature.kind === "keyword") {
    const [token] = tokens;
    if (tokens.length !== 1 || token?.kind !== "ident" || !feature.values.includes(token.name)) return undefined;
    const wanted = token.name;
    const { order } = feature;
    context.known++;
    if (feature.source) context.sources.add(feature.source);
    return {
      text: `(${name}: ${wanted})`,
      test: order ? (state) => order.indexOf(wanted) <= order.indexOf(feature.read(state)) : (state) => feature.read(state) === wanted,
    };
  }
  const value = feature.parse(tokens);
  if (!value) return undefined;
  const op: Op = bound === "min" ? ">=" : bound === "max" ? "<=" : "=";
  context.known++;
  if (feature.source) context.sources.add(feature.source);
  if (value.source) context.sources.add(value.source);
  return { text: `(${name}: ${value.text})`, test: (state) => compare(feature.read(state), op, value.value(state)) };
}

const down = (op: Op) => op === "<" || op === "<=";
const up = (op: Op) => op === ">" || op === ">=";
const rangeFeature = (name: string): RangeFeature | undefined => {
  const feature = FEATURES.get(name);
  return feature?.kind === "range" ? feature : undefined;
};

/**
 * `(width >= 600px)`, `(600px <= width)`, `(400px <= width < 700px)`: a feature, and one or two comparisons with values. A node when it is understood, `null` when it has the shape of a range
 * and names no feature the table has or a value it does not take (unknown), `undefined` when it has not the shape.
 */
function rangeNode(tokens: readonly Token[], context: Context): Node | null | undefined {
  const segments: Token[][] = [[]];
  const ops: Op[] = [];
  for (const token of tokens) {
    if (token.kind === "op") {
      ops.push(token.op);
      segments.push([]);
    } else (segments[segments.length - 1] as Token[]).push(token);
  }
  if (ops.length > 2 || segments.some((segment) => segment.length === 0)) return undefined;
  const nameOf = (segment: readonly Token[]): string | undefined => {
    const [token] = segment;
    return segment.length === 1 && token?.kind === "ident" ? token.name : undefined;
  };
  const [first, second, third] = segments as [Token[], Token[], Token[] | undefined];
  const [op1, op2] = ops as [Op, Op | undefined];
  const constraints: { op: Op; value: Value }[] = [];
  let feature: RangeFeature | undefined;
  let text: string;
  if (op2 === undefined) {
    // `width >= 600px` or `600px <= width`.
    const left = nameOf(first);
    const right = nameOf(second);
    if (left === undefined && right === undefined) return undefined;
    const leftFeature = left === undefined ? undefined : rangeFeature(left);
    const rightFeature = right === undefined ? undefined : rangeFeature(right);
    const onLeft = leftFeature !== undefined;
    feature = leftFeature ?? rightFeature;
    const value = feature?.parse(onLeft ? second : first);
    if (!feature || !value) return null;
    constraints.push({ op: onLeft ? op1 : flip[op1], value });
    text = onLeft ? `${left} ${op1} ${value.text}` : `${value.text} ${op1} ${right}`;
  } else {
    // `400px <= width < 700px`: both comparisons point the same way, and neither is `=`.
    if (!((down(op1) && down(op2)) || (up(op1) && up(op2)))) return undefined;
    const name = nameOf(second);
    if (name === undefined || !third) return undefined;
    feature = rangeFeature(name);
    const low = feature?.parse(first);
    const high = feature?.parse(third);
    if (!feature || !low || !high) return null;
    constraints.push({ op: flip[op1], value: low }, { op: op2, value: high });
    text = `${low.text} ${op1} ${name} ${op2} ${high.text}`;
  }
  const own = feature;
  context.known++;
  if (own.source) context.sources.add(own.source);
  for (const { value } of constraints) if (value.source) context.sources.add(value.source);
  return { text: `(${text})`, test: (state) => constraints.every((constraint) => compare(own.read(state), constraint.op, constraint.value.value(state))) };
}

/**
 * What is inside a pair of parentheses that is not a condition: a feature in one of its three forms. What starts with a name is a `<general-enclosed>` when it is not a feature the table has
 * with a value it takes, so it is unknown; what has the shape of a range is too. Anything else is not a condition (`undefined`).
 */
function featureNode(tokens: readonly Token[], context: Context): Node | undefined {
  const [token, colon] = tokens;
  const unknown = () => unknownNode(`(${written(tokens)})`, context);
  const nested = tokens.some((entry) => entry.kind === "open" || entry.kind === "close" || entry.kind === "function" || entry.kind === "comma");
  if (tokens.some((entry) => entry.kind === "op")) {
    // Nested parentheses and commas are no part of a range.
    if (nested) return token?.kind === "ident" ? unknown() : undefined;
    const node = rangeNode(tokens, context);
    if (node) return node;
    return node === null || token?.kind === "ident" ? unknown() : undefined;
  }
  if (token?.kind !== "ident") return undefined;
  const found = lookup(token.name);
  if (!found || nested || tokens.some((entry) => entry.kind === "other")) return unknown();
  if (tokens.length === 1) return found.bound ? unknown() : booleanNode(token.name, found.feature, context);
  return (colon?.kind === "colon" ? plainNode(token.name, found, tokens.slice(2), context) : undefined) ?? unknown();
}

/** Whether a condition starts here: a parenthesis, a function token (a general-enclosed), or `not` and one of those. */
function conditionStarts(tokens: readonly Token[], at: number): boolean {
  const token = tokens[at];
  if (opens(token)) return true;
  const next = tokens[at + 1];
  return token?.kind === "ident" && token.name === "not" && opens(next);
}

/** `( ... )`: a condition of its own, or a feature; or a function, which is unknown. */
function inParens(tokens: readonly Token[], at: number, depth: number, context: Context): { node: Node; end: number } | undefined {
  const token = tokens[at];
  if ((token?.kind !== "open" && token?.kind !== "function") || depth > MAX_DEPTH) return undefined;
  const close = closing(tokens, at);
  if (close < 0) return undefined;
  const inner = tokens.slice(at + 1, close);
  if (token.kind === "function") return { node: unknownNode(`${token.name}(${written(inner)})`, context), end: close + 1 };
  if (inner.length === 0) return undefined;
  if (conditionStarts(inner, 0)) {
    const condition = parseCondition(inner, 0, true, depth + 1, context);
    return condition && condition.end === inner.length ? { node: { text: `(${condition.node.text})`, test: condition.node.test }, end: close + 1 } : undefined;
  }
  const node = featureNode(inner, context);
  return node ? { node, end: close + 1 } : undefined;
}

/** `not (a)`, or `(a) and (b) and ...`, or `(a) or (b) or ...`; `and` and `or` are not mixed, and `or` is not allowed after a media type. */
function parseCondition(tokens: readonly Token[], from: number, allowOr: boolean, depth: number, context: Context): { node: Node; end: number } | undefined {
  const head = tokens[from];
  if (head?.kind === "ident" && head.name === "not") {
    const operand = inParens(tokens, from + 1, depth, context);
    return operand && { node: { text: `not ${operand.node.text}`, test: (state) => negate(operand.node.test(state)) }, end: operand.end };
  }
  const first = inParens(tokens, from, depth, context);
  if (!first) return undefined;
  const nodes = [first.node];
  let end = first.end;
  let joiner: "and" | "or" | undefined;
  for (;;) {
    const token = tokens[end];
    if (token?.kind !== "ident" || (token.name !== "and" && token.name !== "or")) break;
    if ((joiner !== undefined && joiner !== token.name) || (token.name === "or" && !allowOr)) return undefined;
    joiner = token.name;
    const next = inParens(tokens, end + 1, depth, context);
    if (!next) return undefined;
    nodes.push(next.node);
    end = next.end;
  }
  if (joiner === undefined) return { node: first.node, end };
  const text = nodes.map((node) => node.text).join(` ${joiner} `);
  // The first part that decides ends the test (a false for `and`, a true for `or`), so a query reads only what it needs; an unknown part decides nothing.
  const decisive = joiner === "or";
  const test = (state: MediaState): Truth => {
    let result: Truth = !decisive;
    for (const node of nodes) {
      const value = node.test(state);
      if (value === decisive) return decisive;
      if (value === null) result = null;
    }
    return result;
  };
  return { node: { text, test }, end };
}

const RESERVED = new Set(["not", "only", "and", "or", "layout"]);

/** One query of the list: a condition, or `[not | only] type [and condition]`. */
function parseQuery(tokens: readonly Token[], context: Context): Node | undefined {
  if (conditionStarts(tokens, 0)) {
    const condition = parseCondition(tokens, 0, true, 0, context);
    return condition?.end === tokens.length ? condition.node : undefined;
  }
  let at = 0;
  const first = tokens[0];
  const qualifier = first?.kind === "ident" && (first.name === "not" || first.name === "only") ? first.name : undefined;
  if (qualifier) at++;
  const type = tokens[at++];
  if (type?.kind !== "ident" || RESERVED.has(type.name)) return undefined;
  const typeMatches = type.name === "all" || type.name === "screen";
  let text = type.name;
  let test: Node["test"] = () => typeMatches;
  if (at < tokens.length) {
    const joiner = tokens[at++];
    if (joiner?.kind !== "ident" || joiner.name !== "and") return undefined;
    const condition = parseCondition(tokens, at, false, 0, context);
    if (!condition || condition.end !== tokens.length) return undefined;
    text = `${text} and ${condition.node.text}`;
    test = (state) => (typeMatches ? condition.node.test(state) : false);
  }
  if (qualifier === "not") return { text: `not ${text}`, test: (state) => negate(test(state)) };
  return { text: qualifier ? `${qualifier} ${text}` : text, test };
}

/** Parses a media query list once; the result evaluates against any state. Never throws: what is not a media query is `not all`, and a feature the device does not know is unknown, which is false unless `or` or `not` decides. */
export function parseMediaQuery(query: string): ParsedMediaQuery {
  const queries = split(tokenize(query));
  const sources = new Set<MediaSource>();
  const nodes: Node[] = [];
  const text: string[] = [];
  for (const tokens of queries) {
    const context: Context = { sources: new Set(), known: 0, unknown: 0 };
    const node = tokens.length > 0 ? parseQuery(tokens, context) : undefined;
    // A query with an unknown condition and no feature the device knows has nothing that depends on the device: unless it is true (the specification's `not print and (foo)` is), it is `not all`.
    if (node && (context.unknown === 0 || context.known > 0 || node.test({} as MediaState) === true)) {
      nodes.push(node);
      text.push(node.text);
      for (const source of context.sources) sources.add(source);
    } else text.push("not all");
  }
  return {
    media: text.join(", "),
    sources,
    // An empty list is `all`.
    matches: queries.length === 0 ? () => true : (state) => nodes.some((node) => node.test(state) === true),
  };
}

/** Whether `query` matches `state`. */
export function evaluateMediaQuery(query: string, state: MediaState): boolean {
  return parseMediaQuery(query).matches(state);
}
