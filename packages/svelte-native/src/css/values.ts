/**
 * CSS values: `var()` substitution and `calc()` over numbers, lengths and percentages. A value evaluates to a `Quantity`, a sum of terms
 * by unit, which `toLength` then reads as dp, a percentage string or a `DynamicValue` (the safe-area insets and the window size are known
 * only on the device, so they stay symbolic).
 */
import type { DynamicValue } from "./table.ts";
import { indexOfTop, splitTop } from "./parse.ts";

// --- var() -------------------------------------------------------------------------------------------------------------------

/** Where a custom property's value came from: the class itself, a theme variable on `:root`, or an `@property` initial value / `@layer properties` default. */
export type VarSource = "own" | "theme" | "default";
export type VarLookup = (name: string) => { value: string; source: VarSource } | undefined;
export type Substituted = { text: string } | { error: string };

/** The index of the `)` that closes the `(` at `open`, or -1. */
function closingParen(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const c = text[i] as string;
    if (c === "\\") i++;
    else if (c === '"' || c === "'") {
      i++;
      while (i < text.length && text[i] !== c) i += text[i] === "\\" ? 2 : 1;
    } else if (c === "(") depth++;
    else if (c === ")" && --depth === 0) return i;
  }
  return -1;
}

/** The index of the next `var(` at or after `from` that is a function call (not the end of another name), outside strings. */
function nextVar(text: string, from: number): number {
  for (let i = from; i < text.length; i++) {
    const c = text[i] as string;
    if (c === '"' || c === "'") {
      i++;
      while (i < text.length && text[i] !== c) i += text[i] === "\\" ? 2 : 1;
    } else if (c === "v" && text.startsWith("var(", i) && !/[\w-]/.test(text[i - 1] ?? " ")) return i;
  }
  return -1;
}

/** Replaces every `var(--name, fallback)` with the variable's value (itself substituted) or the fallback. */
export function substituteVars(text: string, lookup: VarLookup, depth = 0): Substituted {
  if (depth > 32) return { error: "var() references itself" };
  let out = "";
  let i = 0;
  while (i < text.length) {
    const at = nextVar(text, i);
    if (at < 0) {
      out += text.slice(i);
      break;
    }
    out += text.slice(i, at);
    const close = closingParen(text, at + 3);
    if (close < 0) return { error: `unbalanced var() in ${text}` };
    const inner = text.slice(at + 4, close);
    const comma = indexOfTop(inner, ",");
    const name = (comma < 0 ? inner : inner.slice(0, comma)).trim();
    const fallback = comma < 0 ? undefined : inner.slice(comma + 1).trim();
    const found = lookup(name);
    const source = found !== undefined ? found.value : fallback;
    if (source === undefined) return { error: `${name} is not defined` };
    const resolved = substituteVars(source, lookup, depth + 1);
    if ("error" in resolved) return resolved;
    out += resolved.text;
    i = close + 1;
  }
  return { text: out };
}

/** When `text` is exactly `var(--name)` (no fallback), the name. */
export function soleVar(text: string): string | null {
  const match = /^var\(\s*(--[^\s,()]+)\s*\)$/.exec(text.trim());
  return match ? (match[1] as string) : null;
}

// --- Quantities --------------------------------------------------------------------------------------------------------------

/** Terms by unit: `""` a plain number, `px`, `%`, `vw`, `vh`, `em` (of the font size), `deg`, and the safe-area insets `top`, `right`, `bottom`, `left`. */
export type Quantity = Record<string, number>;
export type Evaluated = { q: Quantity } | { error: string };

const INSETS = ["top", "right", "bottom", "left"] as const;
const ABSOLUTE_PX: Record<string, number> = { px: 1, pt: 96 / 72, pc: 16, in: 96, cm: 96 / 2.54, mm: 96 / 25.4, q: 96 / 101.6 };
const WINDOW_WIDTH_UNITS = new Set(["vw", "svw", "lvw", "dvw"]);
const WINDOW_HEIGHT_UNITS = new Set(["vh", "svh", "lvh", "dvh"]);

/** Float noise (`0.30000000000000004`) off, real fractions (`1.75 / 1.125`) kept. */
export function clean(x: number): number {
  const rounded = Math.round(x * 1e6) / 1e6;
  return Math.abs(rounded - x) < 1e-9 ? rounded : x;
}

const isNumber = (q: Quantity) => Object.keys(q).every((k) => k === "");
const merge = (a: Quantity, b: Quantity, sign: 1 | -1): Quantity | null => {
  const hasPlain = (q: Quantity) => "" in q;
  if (hasPlain(a) !== hasPlain(b)) return null;
  const out: Quantity = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = (out[k] ?? 0) + sign * v;
  return out;
};
const scale = (q: Quantity, factor: number): Quantity => Object.fromEntries(Object.entries(q).map(([k, v]) => [k, v * factor]));

class Evaluator {
  private pos = 0;
  // Fields, not parameter properties: Node strips the types of a file it loads itself (the transformer from the sources) and does not do those.
  private readonly text: string;
  private readonly remPx: number;

  constructor(text: string, remPx: number) {
    this.text = text;
    this.remPx = remPx;
  }

  run(): Evaluated {
    try {
      const q = this.sum();
      this.blank();
      if (this.pos < this.text.length) throw new Error(`unexpected ${this.text.slice(this.pos, this.pos + 12)} in ${this.text}`);
      return { q };
    } catch (error) {
      if (error instanceof Error) return { error: error.message };
      throw error;
    }
  }

  private blank(): void {
    while (this.pos < this.text.length && /\s/.test(this.text[this.pos] as string)) this.pos++;
  }

  private sum(): Quantity {
    let left = this.product();
    while (true) {
      this.blank();
      const op = this.text[this.pos];
      if (op !== "+" && op !== "-") return left;
      this.pos++;
      const right = this.product();
      const next = merge(left, right, op === "+" ? 1 : -1);
      if (next === null) throw new Error(`cannot add a number and a length in ${this.text}`);
      left = next;
    }
  }

  private product(): Quantity {
    let left = this.unary();
    while (true) {
      this.blank();
      const op = this.text[this.pos];
      if (op !== "*" && op !== "/") return left;
      this.pos++;
      const right = this.unary();
      if (op === "*") {
        if (isNumber(right)) left = scale(left, right[""] ?? 0);
        else if (isNumber(left)) left = scale(right, left[""] ?? 0);
        else throw new Error(`cannot multiply two lengths in ${this.text}`);
      } else {
        if (!isNumber(right)) throw new Error(`cannot divide by a length in ${this.text}`);
        // Divided, not multiplied by the reciprocal: `1.75 / 1.125` is exactly what a browser computes.
        const divisor = right[""] ?? 1;
        left = Object.fromEntries(Object.entries(left).map(([k, v]) => [k, v / divisor]));
      }
    }
  }

  private unary(): Quantity {
    this.blank();
    const sign = this.text[this.pos];
    if ((sign === "+" || sign === "-") && !/[\d.]/.test(this.text[this.pos + 1] ?? "")) {
      this.pos++;
      const value = this.unary();
      return sign === "-" ? scale(value, -1) : value;
    }
    return this.primary();
  }

  private primary(): Quantity {
    this.blank();
    const rest = this.text.slice(this.pos);
    const number = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/i.exec(rest);
    if (number) {
      this.pos += number[0].length;
      const n = Number(number[0]);
      const unit = /^(%|[a-z]+)/i.exec(this.text.slice(this.pos));
      if (!unit) return { "": n };
      this.pos += unit[0].length;
      return this.dimension(n, unit[0].toLowerCase());
    }
    if (rest[0] === "(") {
      this.pos++;
      const inner = this.sum();
      this.blank();
      if (this.text[this.pos] !== ")") throw new Error(`missing ) in ${this.text}`);
      this.pos++;
      return inner;
    }
    const ident = /^[a-z][\w-]*/i.exec(rest);
    if (!ident) throw new Error(`unexpected ${rest.slice(0, 12)} in ${this.text}`);
    const name = ident[0].toLowerCase();
    this.pos += ident[0].length;
    if (this.text[this.pos] === "(") {
      const close = closingParen(this.text, this.pos);
      if (close < 0) throw new Error(`missing ) in ${this.text}`);
      const inner = this.text.slice(this.pos + 1, close);
      this.pos = close + 1;
      return this.call(name, inner);
    }
    if (name === "infinity") return { "": Number.POSITIVE_INFINITY };
    if (name === "pi") return { "": Math.PI };
    if (name === "e") return { "": Math.E };
    throw new Error(`${ident[0]} is not a number or a length`);
  }

  private dimension(n: number, unit: string): Quantity {
    if (unit === "%") return { "%": n };
    if (unit === "rem") return { px: n * this.remPx };
    if (unit === "em") return { em: n };
    const absolute = Object.hasOwn(ABSOLUTE_PX, unit) ? ABSOLUTE_PX[unit] : undefined;
    if (absolute !== undefined) return { px: n * absolute };
    if (WINDOW_WIDTH_UNITS.has(unit)) return { vw: n };
    if (WINDOW_HEIGHT_UNITS.has(unit)) return { vh: n };
    if (unit === "deg") return { deg: n };
    if (unit === "grad") return { deg: n * 0.9 };
    if (unit === "rad") return { deg: (n * 180) / Math.PI };
    if (unit === "turn") return { deg: n * 360 };
    throw new Error(`the unit ${unit} is not supported`);
  }

  private sub(text: string): Quantity {
    const result = new Evaluator(text, this.remPx).run();
    if ("error" in result) throw new Error(result.error);
    return result.q;
  }

  private call(name: string, inner: string): Quantity {
    if (name === "calc") return this.sub(inner);
    if (name === "env") {
      const [first] = splitTop(inner, ",");
      const match = /^safe-area-inset-(top|right|bottom|left)$/.exec((first ?? "").trim());
      if (!match) throw new Error(`env(${first ?? ""}) is not supported (only the safe-area insets are)`);
      return { [match[1] as string]: 1 };
    }
    if (name === "min" || name === "max" || name === "clamp") {
      const args = splitTop(inner, ",").map((arg) => this.sub(arg));
      const unit = singleUnit(args);
      if (unit === null || INSETS.some((side) => side === unit) || unit === "vw" || unit === "vh") {
        throw new Error(`${name}() over different units, or over the device's insets or window, cannot be resolved at build time`);
      }
      const values = args.map((arg) => arg[unit] ?? 0);
      let result: number;
      if (name === "min") result = Math.min(...values);
      else if (name === "max") result = Math.max(...values);
      else {
        if (values.length !== 3) throw new Error("clamp() takes three arguments");
        result = Math.max(values[0] as number, Math.min(values[1] as number, values[2] as number));
      }
      return { [unit]: result };
    }
    throw new Error(`${name}() is not supported`);
  }
}

/** The one unit every quantity is made of (`""` for plain numbers), or null. */
function singleUnit(args: Quantity[]): string | null {
  let unit: string | null = null;
  for (const arg of args) {
    const keys = Object.keys(arg);
    if (keys.length !== 1) return null;
    if (unit !== null && unit !== keys[0]) return null;
    unit = keys[0] as string;
  }
  return unit;
}

export function evaluate(text: string, remPx: number): Evaluated {
  return new Evaluator(text.trim(), remPx).run();
}

// --- Quantity to values ------------------------------------------------------------------------------------------------------

export type Length = { value: number | string } | { dynamic: DynamicValue } | { error: string };

/** dp, a percentage string, or a dynamic value, for a property that takes a length. */
export function toLength(q: Quantity, options: { percent: boolean }): Length {
  const dims = Object.keys(q).filter((k) => q[k] !== 0);
  if (dims.includes("")) return { error: "a number without a unit is not a length" };
  if (dims.includes("deg")) return { error: "an angle is not a length" };
  if (dims.includes("em")) return { error: "em is relative to the font size and is not supported here" };
  for (const k of dims) if (!Number.isFinite(q[k])) return { error: "an infinite length" };
  if (dims.length === 0) return { value: 0 };
  const px = q.px ?? 0;
  const others = dims.filter((k) => k !== "px");
  if (others.length === 0) return { value: clean(px) };
  if (others.length > 1) return { error: `mixes ${others.join(" and ")}${px !== 0 ? " and px" : ""}, which cannot be one value` };
  const unit = others[0] as string;
  const amount = q[unit] as number;
  if (unit === "%") {
    if (px !== 0) return { error: "mixes a percentage and a length, which needs the parent's size" };
    return options.percent ? { value: `${Number(amount.toFixed(6))}%` } : { error: "a percentage is not supported here" };
  }
  const add = px !== 0 ? { add: clean(px) } : {};
  if (unit === "vw" || unit === "vh") return { dynamic: { window: unit === "vw" ? "width" : "height", scale: clean(amount / 100), ...add } };
  const inset = unit as "top" | "right" | "bottom" | "left";
  return { dynamic: { inset, ...(amount !== 1 ? { scale: clean(amount) } : {}), ...add } };
}

/** A plain number (`z-index`, `flex-grow`, `opacity: 0.5`), with a percentage read as a share of 1 when `percent` is set. */
export function toNumber(q: Quantity, options: { percent?: boolean } = {}): { value: number } | { error: string } {
  const dims = Object.keys(q).filter((k) => q[k] !== 0);
  let value: number;
  if (dims.length === 0) value = 0;
  else if (dims.length === 1 && dims[0] === "") value = q[""] as number;
  else if (dims.length === 1 && dims[0] === "%" && options.percent) value = (q["%"] as number) / 100;
  else return { error: "not a number" };
  return Number.isFinite(value) ? { value: clean(value) } : { error: "an infinite number" };
}

/** An angle as a CSS string (`45deg`); a plain `0` is `0deg`. */
export function toAngle(q: Quantity): { value: string } | { error: string } {
  const dims = Object.keys(q).filter((k) => q[k] !== 0);
  if (dims.length === 0) return { value: "0deg" };
  if (dims.length === 1 && dims[0] === "deg") return { value: `${clean(q.deg as number)}deg` };
  return { error: "not an angle" };
}
