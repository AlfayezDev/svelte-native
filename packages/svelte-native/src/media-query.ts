/**
 * CSS media queries, evaluated for a device: the parser and the evaluator behind `window.matchMedia` (`match-media.ts`). Pure: a query and the device's state in, a boolean out; it reads
 * nothing from React Native, so the table of queries in `tests/media-query.test.ts` runs against plain objects.
 *
 * What is understood is Media Queries 4's grammar: a comma-separated list (`or`), `not`, `only`, a media type (`all` and `screen` are true; `print` and every other type is false), `and`, `or` and
 * `not` between conditions, nested parentheses, and a feature as `(name)`, `(name: value)`, `(min-name: value)` or in the range syntax (`(width >= 600px)`, `(400px <= width < 700px)`).
 * The features are those of `FEATURES` below, each read from `MediaState`. A query a browser would reject, a feature this table does not have and a value a feature does not take
 * (`(hover: sideways)`, `(min-width: red)`) all make their comma-separated query `not all`, as browsers do, and nothing here throws.
 */

/** The device's state a query reads: the window in points (dp, the px of CSS), the pixel ratio, the system's appearance and accessibility settings. A device reads each field when it is asked. */
export interface MediaState {
  readonly width: number;
  readonly height: number;
  /** Device pixels per point: CSS's `dppx`. */
  readonly scale: number;
  readonly colorScheme: "light" | "dark";
  readonly reducedMotion: boolean;
  readonly highContrast: boolean;
}

/** The system sources a query depends on, which a device listens to for as long as a query has listeners: the window's size and ratio, the appearance, and the two accessibility settings. */
export type MediaSource = "window" | "appearance" | "motion" | "contrast";

/** A parsed media query list. */
export interface ParsedMediaQuery {
  /** What `MediaQueryList.media` is: the query as a browser serialises it (lower case, `(min-width: 600px)`, a query it rejects as `not all`). */
  readonly media: string;
  /** The sources whose change can change `matches`. */
  readonly sources: ReadonlySet<MediaSource>;
  matches(state: MediaState): boolean;
}

type Op = "<" | "<=" | ">" | ">=" | "=";

type Token =
  | { readonly kind: "ident"; readonly name: string }
  | { readonly kind: "number"; readonly value: number }
  | { readonly kind: "dimension"; readonly value: number; readonly unit: string }
  | { readonly kind: "function" }
  | { readonly kind: "open" | "close" | "comma" | "colon" | "slash" | "other" }
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
        tokens.push({ kind: "other" });
      } else tokens.push({ kind: "number", value });
      continue;
    }
    IDENT.lastIndex = at;
    const ident = IDENT.exec(text);
    if (ident) {
      at = IDENT.lastIndex;
      if (text[at] === "(") {
        at++;
        tokens.push({ kind: "function" });
      } else tokens.push({ kind: "ident", name: ident[0].toLowerCase() });
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
    } else tokens.push({ kind: "other" });
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

/** A value as the feature takes it (`number`, in the feature's own unit: px, a ratio, dppx) and as it is written back. */
interface Value {
  readonly value: number;
  readonly text: string;
}

const LENGTH = new Map([["px", 1], ["em", 16], ["rem", 16], ["pt", 96 / 72], ["pc", 16], ["in", 96], ["cm", 96 / 2.54], ["mm", 96 / 25.4], ["q", 96 / 101.6]]);
const RESOLUTION = new Map([["dppx", 1], ["x", 1], ["dpi", 1 / 96], ["dpcm", 2.54 / 96]]);

/** A length is `px`, `em` or `rem` (16px each: a device has no root font size to ask), the other absolute units, or a unitless 0. */
function length(tokens: readonly Token[]): Value | undefined {
  const [token] = tokens;
  if (tokens.length !== 1) return undefined;
  if (token?.kind === "dimension") {
    const factor = LENGTH.get(token.unit);
    return factor === undefined || token.value < 0 ? undefined : { value: token.value * factor, text: `${token.value}${token.unit}` };
  }
  return token?.kind === "number" && token.value === 0 ? { value: 0, text: "0px" } : undefined;
}

/** `16/9`, `16 / 9`, or a number alone (`2` is `2 / 1`). */
function ratio(tokens: readonly Token[]): Value | undefined {
  const [first, slash, second] = tokens;
  if (tokens.length === 1) return first?.kind === "number" && first.value >= 0 ? { value: first.value, text: `${first.value}` } : undefined;
  if (tokens.length !== 3 || first?.kind !== "number" || slash?.kind !== "slash" || second?.kind !== "number") return undefined;
  if (first.value < 0 || second.value < 0 || (first.value === 0 && second.value === 0)) return undefined;
  return { value: first.value / second.value, text: `${first.value} / ${second.value}` };
}

/** `2dppx`, `2x`, `192dpi`, `75.6dpcm`, or `infinite`. */
function resolution(tokens: readonly Token[]): Value | undefined {
  const [token] = tokens;
  if (tokens.length !== 1) return undefined;
  if (token?.kind === "ident") return token.name === "infinite" ? { value: Number.POSITIVE_INFINITY, text: "infinite" } : undefined;
  if (token?.kind !== "dimension") return undefined;
  const factor = RESOLUTION.get(token.unit);
  return factor === undefined || token.value < 0 ? undefined : { value: token.value * factor, text: `${token.value}${token.unit}` };
}

/** A plain non-negative number (`-webkit-min-device-pixel-ratio: 2`). */
function number(tokens: readonly Token[]): Value | undefined {
  const [token] = tokens;
  return tokens.length === 1 && token?.kind === "number" && token.value >= 0 ? { value: token.value, text: `${token.value}` } : undefined;
}

/** A non-negative integer (`color: 8`). */
function integer(tokens: readonly Token[]): Value | undefined {
  const value = number(tokens);
  return value !== undefined && Number.isInteger(value.value) ? value : undefined;
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
  read(state: MediaState): string;
}

type Feature = RangeFeature | KeywordFeature;

const range = (source: MediaSource | undefined, read: (state: MediaState) => number, parse: RangeFeature["parse"], legacy = false): RangeFeature => ({ kind: "range", source, read, parse, ...(legacy ? { legacy: true as const } : {}) });
const keyword = (source: MediaSource | undefined, read: (state: MediaState) => string, values: readonly string[], off: readonly string[] = []): KeywordFeature => ({ kind: "keyword", source, read, values, off });

const hover = keyword(undefined, () => "none", ["none", "hover"], ["none"]);
const pointer = keyword(undefined, () => "coarse", ["none", "coarse", "fine"], ["none"]);

/** What the features read on a device: the window's size and ratio, `Appearance`, `AccessibilityInfo`, and what a phone is (a touch screen with no hover, an app that is not in a browser). */
const FEATURES = new Map<string, Feature>([
  ["width", range("window", (state) => state.width, length)],
  ["height", range("window", (state) => state.height, length)],
  ["aspect-ratio", range("window", (state) => state.width / state.height, ratio)],
  ["resolution", range("window", (state) => state.scale, resolution)],
  ["color", range(undefined, () => 8, integer)],
  ["orientation", keyword("window", (state) => (state.height >= state.width ? "portrait" : "landscape"), ["portrait", "landscape"])],
  ["prefers-color-scheme", keyword("appearance", (state) => state.colorScheme, ["light", "dark"])],
  ["prefers-reduced-motion", keyword("motion", (state) => (state.reducedMotion ? "reduce" : "no-preference"), ["no-preference", "reduce"], ["no-preference"])],
  ["prefers-contrast", keyword("contrast", (state) => (state.highContrast ? "more" : "no-preference"), ["no-preference", "more", "less", "custom"], ["no-preference"])],
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

/** A condition: its serialisation and its test. */
interface Node {
  readonly text: string;
  test(state: MediaState): boolean;
}

const MAX_DEPTH = 32;

function booleanNode(name: string, feature: Feature): Node {
  return { text: `(${name})`, test: feature.kind === "range" ? (state) => feature.read(state) !== 0 : (state) => !feature.off.includes(feature.read(state)) };
}

/** `(name: value)`, `(min-name: value)`. */
function plainNode(name: string, found: NonNullable<ReturnType<typeof lookup>>, tokens: readonly Token[], sources: Set<MediaSource>): Node | undefined {
  const { feature, bound } = found;
  if (feature.kind === "keyword") {
    const [token] = tokens;
    if (tokens.length !== 1 || token?.kind !== "ident" || !feature.values.includes(token.name)) return undefined;
    const wanted = token.name;
    if (feature.source) sources.add(feature.source);
    return { text: `(${name}: ${wanted})`, test: (state) => feature.read(state) === wanted };
  }
  const value = feature.parse(tokens);
  if (!value) return undefined;
  const op: Op = bound === "min" ? ">=" : bound === "max" ? "<=" : "=";
  if (feature.source) sources.add(feature.source);
  return { text: `(${name}: ${value.text})`, test: (state) => compare(feature.read(state), op, value.value) };
}

/** `(width >= 600px)`, `(600px <= width)`, `(400px <= width < 700px)`: a feature, and one or two comparisons with values. */
function rangeNode(tokens: readonly Token[], sources: Set<MediaSource>): Node | undefined {
  const segments: Token[][] = [[]];
  const ops: Op[] = [];
  for (const token of tokens) {
    if (token.kind === "op") {
      ops.push(token.op);
      segments.push([]);
    } else (segments[segments.length - 1] as Token[]).push(token);
  }
  if (ops.length > 2 || segments.some((segment) => segment.length === 0)) return undefined;
  const named = (segment: readonly Token[]): { name: string; feature: RangeFeature } | undefined => {
    const [token] = segment;
    const feature = segment.length === 1 && token?.kind === "ident" ? FEATURES.get(token.name) : undefined;
    return token?.kind === "ident" && feature?.kind === "range" ? { name: token.name, feature } : undefined;
  };
  const constraints: { op: Op; value: Value }[] = [];
  let text: string;
  let target: { name: string; feature: RangeFeature } | undefined;
  const [first, second, third] = segments as [Token[], Token[], Token[] | undefined];
  const [op1, op2] = ops as [Op, Op | undefined];
  if (op2 === undefined) {
    // `width >= 600px` or `600px <= width`.
    const left = named(first);
    target = left ?? named(second);
    if (!target) return undefined;
    const value = target.feature.parse(left ? second : first);
    if (!value) return undefined;
    constraints.push({ op: left ? op1 : flip[op1], value });
    text = left ? `${target.name} ${op1} ${value.text}` : `${value.text} ${op1} ${target.name}`;
  } else {
    // `400px <= width < 700px`: both comparisons point the same way, and neither is `=`.
    target = named(second);
    const down = (op: Op) => op === "<" || op === "<=";
    const up = (op: Op) => op === ">" || op === ">=";
    if (!target || !third || !((down(op1) && down(op2)) || (up(op1) && up(op2)))) return undefined;
    const low = target.feature.parse(first);
    const high = target.feature.parse(third);
    if (!low || !high) return undefined;
    constraints.push({ op: flip[op1], value: low }, { op: op2, value: high });
    text = `${low.text} ${op1} ${target.name} ${op2} ${high.text}`;
  }
  const { feature } = target;
  if (feature.source) sources.add(feature.source);
  return { text: `(${text})`, test: (state) => constraints.every((constraint) => compare(feature.read(state), constraint.op, constraint.value.value)) };
}

/** What is inside a pair of parentheses that is not a condition: a feature, in one of its three forms. */
function featureNode(tokens: readonly Token[], sources: Set<MediaSource>): Node | undefined {
  if (tokens.some((token) => token.kind === "open" || token.kind === "close" || token.kind === "function" || token.kind === "comma" || token.kind === "other")) return undefined;
  if (tokens.some((token) => token.kind === "op")) return rangeNode(tokens, sources);
  const [token, colon] = tokens;
  if (token?.kind !== "ident") return undefined;
  const found = lookup(token.name);
  if (!found) return undefined;
  if (tokens.length === 1) {
    if (found.bound) return undefined;
    if (found.feature.source) sources.add(found.feature.source);
    return booleanNode(token.name, found.feature);
  }
  return colon?.kind === "colon" ? plainNode(token.name, found, tokens.slice(2), sources) : undefined;
}

/** Whether a condition starts here: a parenthesis, a function token (a general-enclosed, which is not understood), or `not` and one of those. */
function conditionStarts(tokens: readonly Token[], at: number): boolean {
  const token = tokens[at];
  if (opens(token)) return true;
  const next = tokens[at + 1];
  return token?.kind === "ident" && token.name === "not" && opens(next);
}

/** `( ... )`: a condition of its own, or a feature. */
function inParens(tokens: readonly Token[], at: number, depth: number, sources: Set<MediaSource>): { node: Node; end: number } | undefined {
  const token = tokens[at];
  if (token?.kind !== "open" || depth > MAX_DEPTH) return undefined;
  const close = closing(tokens, at);
  if (close < 0) return undefined;
  const inner = tokens.slice(at + 1, close);
  if (inner.length === 0) return undefined;
  if (conditionStarts(inner, 0)) {
    const condition = parseCondition(inner, 0, true, depth + 1, sources);
    return condition && condition.end === inner.length ? { node: { text: `(${condition.node.text})`, test: condition.node.test }, end: close + 1 } : undefined;
  }
  const node = featureNode(inner, sources);
  return node ? { node, end: close + 1 } : undefined;
}

/** `not (a)`, or `(a) and (b) and ...`, or `(a) or (b) or ...`; `and` and `or` are not mixed, and `or` is not allowed after a media type. */
function parseCondition(tokens: readonly Token[], from: number, allowOr: boolean, depth: number, sources: Set<MediaSource>): { node: Node; end: number } | undefined {
  const head = tokens[from];
  if (head?.kind === "ident" && head.name === "not") {
    const operand = inParens(tokens, from + 1, depth, sources);
    return operand && { node: { text: `not ${operand.node.text}`, test: (state) => !operand.node.test(state) }, end: operand.end };
  }
  const first = inParens(tokens, from, depth, sources);
  if (!first) return undefined;
  const nodes = [first.node];
  let end = first.end;
  let joiner: "and" | "or" | undefined;
  for (;;) {
    const token = tokens[end];
    if (token?.kind !== "ident" || (token.name !== "and" && token.name !== "or")) break;
    if ((joiner !== undefined && joiner !== token.name) || (token.name === "or" && !allowOr)) return undefined;
    joiner = token.name;
    const next = inParens(tokens, end + 1, depth, sources);
    if (!next) return undefined;
    nodes.push(next.node);
    end = next.end;
  }
  if (joiner === undefined) return { node: first.node, end };
  const text = nodes.map((node) => node.text).join(` ${joiner} `);
  return { node: { text, test: joiner === "and" ? (state) => nodes.every((node) => node.test(state)) : (state) => nodes.some((node) => node.test(state)) }, end };
}

const RESERVED = new Set(["not", "only", "and", "or", "layout"]);

/** One query of the list: a condition, or `[not | only] type [and condition]`. */
function parseQuery(tokens: readonly Token[], sources: Set<MediaSource>): Node | undefined {
  if (conditionStarts(tokens, 0)) {
    const condition = parseCondition(tokens, 0, true, 0, sources);
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
    const condition = parseCondition(tokens, at, false, 0, sources);
    if (!condition || condition.end !== tokens.length) return undefined;
    text = `${text} and ${condition.node.text}`;
    test = (state) => typeMatches && condition.node.test(state);
  }
  if (qualifier === "not") return { text: `not ${text}`, test: (state) => !test(state) };
  return { text: qualifier ? `${qualifier} ${text}` : text, test };
}

/** Parses a media query list once; the result evaluates against any state. Never throws: a query it does not understand is `not all`. */
export function parseMediaQuery(query: string): ParsedMediaQuery {
  const queries = split(tokenize(query));
  const sources = new Set<MediaSource>();
  const nodes: Node[] = [];
  const written: string[] = [];
  for (const tokens of queries) {
    const own = new Set<MediaSource>();
    const node = tokens.length > 0 ? parseQuery(tokens, own) : undefined;
    if (node) {
      nodes.push(node);
      written.push(node.text);
      for (const source of own) sources.add(source);
    } else written.push("not all");
  }
  return {
    media: written.join(", "),
    sources,
    // An empty list is `all`.
    matches: queries.length === 0 ? () => true : (state) => nodes.some((node) => node.test(state)),
  };
}

/** Whether `query` matches `state`. */
export function evaluateMediaQuery(query: string, state: MediaState): boolean {
  return parseMediaQuery(query).matches(state);
}
