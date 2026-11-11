/**
 * The CSS side of the DOM-like surface a node offers Svelte's transitions and `animate:` (`renderer.ts`, `NativeNode.style`, `getComputedStyle`),
 * and of the keyframes they hand to `element.animate` (`keyframes.ts`): CSS lengths and transform lists read into React Native's values, and back.
 * Pure: no React Native, no Reanimated.
 */
import { mergeHostProps } from "../native-props.ts";

/** What a CSS value has turned into: a number of dp (a length, a plain number), a percentage, or an angle in degrees. */
export type Unit = "" | "%" | "deg";
/** One function of a transform list: React Native's name for it, the unit its value has, and the value. `translate(10px, 5px)` is two of them. */
export type TransformOp = { name: string; unit: Unit; value: number };
export type NativeTransform = Record<string, number | string>;
export type Rect = { x: number; y: number; width: number; height: number };

const NUMBER = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)([a-z%]*)$/i;

/** A CSS number with its unit, or null. `1e-7px` is read as a number with the unit `px`, not as `1e` and `-7px`. */
export function parseQuantity(text: string): { value: number; unit: string } | null {
  const match = NUMBER.exec(text.trim());
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? { value, unit: (match[2] as string).toLowerCase() } : null;
}

/** A length in dp (`12px`, `12`) or a percentage (`50%`), as the number and its unit; null for anything else (`em`, `calc()`, `auto`). */
export function parseLength(text: string | number): { value: number; unit: "" | "%" } | null {
  if (typeof text === "number") return Number.isFinite(text) ? { value: text, unit: "" } : null;
  const quantity = parseQuantity(text);
  if (!quantity) return null;
  if (quantity.unit === "" || quantity.unit === "px") return { value: quantity.value, unit: "" };
  if (quantity.unit === "%") return { value: quantity.value, unit: "%" };
  return null;
}

const ANGLE_TO_DEGREES: Record<string, number> = { deg: 1, rad: 180 / Math.PI, turn: 360, grad: 0.9 };
function parseAngle(text: string): number | null {
  const quantity = parseQuantity(text);
  if (!quantity) return null;
  if (quantity.unit === "") return quantity.value === 0 ? 0 : null;
  const factor = ANGLE_TO_DEGREES[quantity.unit];
  return factor === undefined ? null : quantity.value * factor;
}

function parseNumber(text: string): number | null {
  const quantity = parseQuantity(text);
  return quantity !== null && quantity.unit === "" ? quantity.value : null;
}

const length = (text: string | undefined, fallback: number | null = null): { value: number; unit: Unit } | null => {
  if (text === undefined) return fallback === null ? null : { value: fallback, unit: "" };
  const parsed = parseLength(text);
  return parsed;
};

/** The operations a CSS transform function stands for, or null when it is not one that React Native has (`matrix()`, `translateZ()`). */
function operations(name: string, args: string[]): TransformOp[] | null {
  const op = (opName: string, unit: Unit, value: number): TransformOp => ({ name: opName, unit, value });
  switch (name) {
    case "translate": case "translate3d": {
      const x = length(args[0]);
      const y = length(args[1], 0);
      if (!x || !y || args.length > 3 || (args.length === 3 && parseLength(args[2] as string)?.value !== 0)) return null;
      return [op("translateX", x.unit, x.value), op("translateY", y.unit, y.value)];
    }
    case "translatex": { const x = length(args[0]); return x && args.length === 1 ? [op("translateX", x.unit, x.value)] : null; }
    case "translatey": { const y = length(args[0]); return y && args.length === 1 ? [op("translateY", y.unit, y.value)] : null; }
    case "scale": case "scale3d": {
      const x = parseNumber(args[0] ?? "");
      const y = args[1] === undefined ? x : parseNumber(args[1]);
      if (x === null || y === null || args.length > 3 || (args.length === 3 && parseNumber(args[2] as string) !== 1)) return null;
      return args.length === 1 ? [op("scale", "", x)] : [op("scaleX", "", x), op("scaleY", "", y)];
    }
    case "scalex": { const x = parseNumber(args[0] ?? ""); return x !== null && args.length === 1 ? [op("scaleX", "", x)] : null; }
    case "scaley": { const y = parseNumber(args[0] ?? ""); return y !== null && args.length === 1 ? [op("scaleY", "", y)] : null; }
    case "rotate": case "rotatez": { const a = parseAngle(args[0] ?? ""); return a !== null && args.length === 1 ? [op("rotate", "deg", a)] : null; }
    case "rotatex": { const a = parseAngle(args[0] ?? ""); return a !== null && args.length === 1 ? [op("rotateX", "deg", a)] : null; }
    case "rotatey": { const a = parseAngle(args[0] ?? ""); return a !== null && args.length === 1 ? [op("rotateY", "deg", a)] : null; }
    case "skewx": { const a = parseAngle(args[0] ?? ""); return a !== null && args.length === 1 ? [op("skewX", "deg", a)] : null; }
    case "skewy": { const a = parseAngle(args[0] ?? ""); return a !== null && args.length === 1 ? [op("skewY", "deg", a)] : null; }
    case "skew": {
      const x = parseAngle(args[0] ?? "");
      const y = args[1] === undefined ? 0 : parseAngle(args[1]);
      return x !== null && y !== null && args.length <= 2 ? [op("skewX", "deg", x), op("skewY", "deg", y)] : null;
    }
    case "perspective": { const d = parseLength(args[0] ?? ""); return d && d.unit === "" && args.length === 1 ? [op("perspective", "", d.value)] : null; }
    default: return null;
  }
}

/** `text` cut at every `separator` outside parentheses, each part trimmed, empty parts dropped when cutting at spaces. */
function splitOutside(text: string, separator: " " | ","): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let at = 0; at <= text.length; at++) {
    const char = text[at];
    if (char === "(") depth++;
    else if (char === ")") depth--;
    else if (at === text.length || (depth === 0 && char === separator)) {
      const part = text.slice(start, at).trim();
      if (part !== "" || separator === ",") parts.push(part);
      start = at + 1;
    }
  }
  return parts;
}

export type ParsedTransform = { ops: TransformOp[]; unsupported: string[] };

/** A CSS transform list (`translate(0px, 20px) scale(0.5)`, or `none`) as React Native's operations, and the functions it could not read (they are left out). */
export function parseTransform(text: string): ParsedTransform {
  const result: ParsedTransform = { ops: [], unsupported: [] };
  const value = text.trim();
  if (value === "" || value === "none") return result;
  for (const call of splitOutside(value, " ")) {
    const open = call.indexOf("(");
    if (open < 1 || !call.endsWith(")")) { result.unsupported.push(call); continue; }
    const name = call.slice(0, open).trim();
    const found = operations(name.toLowerCase(), splitOutside(call.slice(open + 1, -1), ","));
    if (found === null) result.unsupported.push(name);
    else result.ops.push(...found);
  }
  return result;
}

/** One operation as an entry of React Native's `transform` array: `{ translateX: 10 }`, `{ translateX: "50%" }`, `{ rotate: "45deg" }`. */
export function nativeEntry(op: TransformOp): NativeTransform {
  return { [op.name]: op.unit === "" ? op.value : op.unit === "%" ? `${op.value}%` : `${op.value}deg` };
}

export const nativeTransform = (ops: readonly TransformOp[]): NativeTransform[] => ops.map(nativeEntry);

// --- React Native's values as CSS ---------------------------------------------------------------------------------------------

/** React Native's `transform` (an array of entries, or a CSS string) as the CSS function list that `getComputedStyle(node).transform` gives: `translateX(10px) scale(2)`, or `none`. */
export function transformToCss(transform: unknown): string {
  if (typeof transform === "string") return transform.trim() === "" ? "none" : transform;
  if (!Array.isArray(transform) || transform.length === 0) return "none";
  const parts: string[] = [];
  for (const entry of transform as Record<string, unknown>[]) {
    for (const name in entry) {
      const value = entry[name];
      if (name === "matrix" && Array.isArray(value)) parts.push(`matrix3d(${value.join(", ")})`);
      else if (typeof value === "number") parts.push(`${name}(${name.startsWith("rotate") || name.startsWith("skew") ? `${value}deg` : name.startsWith("scale") ? value : `${value}px`})`);
      else if (typeof value === "string") parts.push(`${name}(${value})`);
    }
  }
  return parts.length === 0 ? "none" : parts.join(" ");
}

/** The entries of a node's `transform` as operations (what a keyframe's list is made of), from the array or the string React Native accepts. */
export function transformOps(transform: unknown): TransformOp[] {
  if (typeof transform === "string") return parseTransform(transform).ops;
  if (!Array.isArray(transform)) return [];
  return parseTransform(transformToCss(transform)).ops;
}

// --- Styles -------------------------------------------------------------------------------------------------------------------

/** A style (an object, or arrays of them, with falsy entries) as one object, later entries winning; a shared value or any other object that is not a plain record is skipped. */
export function flattenStyle(style: unknown, into: Record<string, unknown> = {}): Record<string, unknown> {
  if (Array.isArray(style)) for (const item of style) flattenStyle(item, into);
  else if (style !== null && typeof style === "object") for (const key in style as Record<string, unknown>) {
    const value = (style as Record<string, unknown>)[key];
    if (value !== undefined) into[key] = value;
  }
  return into;
}

/** The style a node's own attributes give it (`style`, `nativeStyle`, the style of `class`), flattened. */
export function naturalStyle(props: Readonly<Record<string, unknown>>): Record<string, unknown> {
  return flattenStyle(mergeHostProps(props).style);
}

/** The inline-style property names a node's `style` has accessors for (`NativeNode.style`): the ones Svelte's transitions and `animate:` write. */
export const inlineProperties: readonly string[] = ["overflow", "position", "width", "height", "transform"];
const STRING_PROPERTIES = new Set(["overflow", "position", "pointerEvents"]);

/** A CSS length or keyword written to `node.style` as a React Native value: `123px` is 123, `50%` stays, `auto` is nothing. */
function nativeSize(text: string): number | string | undefined {
  const parsed = parseLength(text);
  if (!parsed) return undefined;
  return parsed.unit === "%" ? `${parsed.value}%` : parsed.value;
}

/**
 * Puts what was written to a node's inline `style` (CSS strings by property) over the style the node has: `position`, `overflow` and `pointerEvents` (`element.inert`), a `width` and
 * `height` in px, and a `transform` that is added to the node's own (Svelte's `animate:` keeps a leaving item where it was with `position: absolute` and a translation, and the item
 * may be scaled itself). Any other property written is kept on the node and not applied.
 */
export function applyInlineStyle(props: Record<string, unknown>, inline: Readonly<Record<string, string>>): void {
  const over: Record<string, unknown> = {};
  for (const key in inline) {
    const text = inline[key] as string;
    if (key === "width" || key === "height") { const size = nativeSize(text); if (size !== undefined) over[key] = size; }
    else if (key === "transform") {
      const own = flattenStyle(props.style).transform;
      over.transform = [...transformOps(own).map(nativeEntry), ...nativeTransform(parseTransform(text).ops)];
    } else if (STRING_PROPERTIES.has(key)) over[key] = text;
  }
  props.style = props.style === undefined || props.style === null ? over : [props.style, over];
}

/** The style a node has now, flattened: its own (`naturalStyle`) with what was written to its inline `style` over it. */
export function effectiveStyle(props: Readonly<Record<string, unknown>>, inline: Readonly<Record<string, string>> | null): Record<string, unknown> {
  const holder: Record<string, unknown> = { style: naturalStyle(props) };
  if (inline) applyInlineStyle(holder, inline);
  return flattenStyle(holder.style);
}

// --- getComputedStyle ---------------------------------------------------------------------------------------------------------

const px = (value: unknown): string => (typeof value === "number" && Number.isFinite(value) ? `${value}px` : "0px");
/** An edge of a box: its own key, else the pair's (`paddingVertical`), else the shorthand (`padding`), as React Native resolves them. */
function edge(style: Record<string, unknown>, shorthand: string, axis: string, key: string): number {
  for (const name of [key, `${shorthand}${axis}`, shorthand]) {
    const value = style[name];
    if (typeof value === "number") return value;
  }
  return 0;
}

export type ComputedStyle = Record<string, string> & { opacity: string; transform: string; transformOrigin: string; width: string; height: string };

/**
 * What `getComputedStyle(node)` gives Svelte's transitions and `flip`: the values they read, as the strings the DOM gives, from the node's own style (and its inline `style`) and its
 * layout. The layout is read when `width` or `height` is: it asks the host to commit what is pending first, which a transition that reads neither (`fade`, `fly`) never costs.
 */
export function computedStyleOf(props: Readonly<Record<string, unknown>>, inline: Readonly<Record<string, string>> | null, layout: () => Rect | null): ComputedStyle {
  const style = effectiveStyle(props, inline);
  const opacity = typeof style.opacity === "number" ? style.opacity : 1;
  const result: Record<string, string> = {
    opacity: String(opacity),
    transform: transformToCss(style.transform),
    zoom: "1",
    display: style.display === "none" ? "none" : "flex",
    position: typeof style.position === "string" ? style.position : "relative",
    overflow: typeof style.overflow === "string" ? style.overflow : "visible",
    filter: "none",
  };
  for (const [name, shorthand, axis, side] of [
    ["paddingTop", "padding", "Vertical", "Top"], ["paddingBottom", "padding", "Vertical", "Bottom"], ["paddingLeft", "padding", "Horizontal", "Left"], ["paddingRight", "padding", "Horizontal", "Right"],
    ["marginTop", "margin", "Vertical", "Top"], ["marginBottom", "margin", "Vertical", "Bottom"], ["marginLeft", "margin", "Horizontal", "Left"], ["marginRight", "margin", "Horizontal", "Right"],
  ] as const) result[name] = px(edge(style, shorthand, axis, `${shorthand}${side}`));
  for (const side of ["Top", "Bottom", "Left", "Right"]) result[`border${side}Width`] = px(edge(style, "borderWidth", "", `border${side}Width`));
  Object.defineProperties(result, {
    width: { get: () => px(layout()?.width ?? 0), enumerable: true },
    height: { get: () => px(layout()?.height ?? 0), enumerable: true },
    transformOrigin: { get: () => { const box = layout(); return `${(box?.width ?? 0) / 2}px ${(box?.height ?? 0) / 2}px`; }, enumerable: true },
  });
  return result as ComputedStyle;
}

/** A `DOMRect` as far as Svelte's `flip` and `crossfade` read it (`left`, `top`, `right`, `bottom`, `width`, `height`). */
export function domRect({ x, y, width, height }: Rect): DOMRectReadOnly {
  return { x, y, width, height, left: x, top: y, right: x + width, bottom: y + height, toJSON() { return { x, y, width, height }; } } as DOMRectReadOnly;
}
