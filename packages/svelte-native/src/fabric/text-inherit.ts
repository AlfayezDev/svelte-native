/**
 * Text style that inherits, for the elements the lowering made from HTML (`lower-html.ts` marks them with `nativeHtml`). On the web `class="text-lg"` or
 * `style="color: white"` on a `<div>` or a `<button>` styles the text inside it; in React Native a `View` has no text style, and a `Text` takes none from it. So the host
 * gives each text of a marked element (a `native-text` that is not inside another, and a `native-input`) the text style of the marked elements above it, under its own
 * (`host.ts`, `build`).
 *
 * Only marked elements take part: a `<View>` a file imports from the package keeps React Native's semantics. It neither gives text style nor stops it, so a marked
 * element above it still reaches the marked text below it. What inherits is what CSS inherits for text (`TEXT_KEYS`).
 *
 * A unitless `line-height` and an `em` `letter-spacing` are relative to the font size of the element they are used on, which may be inherited. The class resolver and the
 * conversion of an inline style leave them under a `fontRelative` key (`{ lineHeight: 1.5 }`), they inherit as the factor, and `resolveRelative` makes the dp from the font
 * size the element ends up with (its own, else the inherited one, else React Native's 14).
 */

/** The style keys that inherit: the ones of a CSS text that an element's descendants get from it. */
export const TEXT_KEYS: ReadonlySet<string> = new Set([
  "color", "fontSize", "fontWeight", "fontFamily", "fontStyle", "lineHeight", "letterSpacing", "textAlign", "textTransform",
  "textDecorationLine", "textDecorationColor", "textDecorationStyle", "fontVariant",
]);

/** The text style of an element and its ancestors: plain values, and the factors a font size is still to be multiplied by under `fontRelative`. */
export type TextStyle = Record<string, unknown> & { fontRelative?: Record<string, number> };

/** The font size a text is drawn at when nothing sets one: React Native's own default, as in the class resolver. */
export const DEFAULT_FONT_SIZE = 14;

const RELATIVE_KEYS = new Set(["lineHeight", "letterSpacing"]);

function isStyleObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Whether a style (an object, or arrays of them) has a key that inherits, or a relative value. */
export function hasTextKeys(style: unknown): boolean {
  if (Array.isArray(style)) {
    for (const item of style) if (hasTextKeys(item)) return true;
    return false;
  }
  if (!isStyleObject(style)) return false;
  for (const key in style) if (TEXT_KEYS.has(key) || key === "fontRelative") return true;
  return false;
}

/**
 * Lays the text keys of a style over `into`, in order (the last one wins: an array's items are in the order React Native flattens them). A value of `fontRelative` takes the
 * plain key it is the factor of out of `into`, and the other way round: whichever came later is the one that is set.
 */
function lay(into: TextStyle, style: unknown): void {
  if (Array.isArray(style)) {
    for (const item of style) lay(into, item);
    return;
  }
  if (!isStyleObject(style)) return;
  for (const key in style) {
    const value = style[key];
    if (key === "fontRelative") {
      if (!isStyleObject(value)) continue;
      for (const name in value) {
        const factor = value[name];
        if (typeof factor !== "number") continue;
        delete into[name];
        into.fontRelative = { ...into.fontRelative, [name]: factor };
      }
      continue;
    }
    if (!TEXT_KEYS.has(key)) continue;
    if (value === undefined || value === null) continue;
    into[key] = value;
    if (RELATIVE_KEYS.has(key) && into.fontRelative !== undefined && key in into.fontRelative) {
      const rest = { ...into.fontRelative };
      delete rest[key];
      if (Object.keys(rest).length > 0) into.fontRelative = rest;
      else delete into.fontRelative;
    }
  }
}

function sameRelative(a: Record<string, number> | undefined, b: Record<string, number> | undefined): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined) return false;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => a[key] === b[key]);
}

function sameText(a: TextStyle | undefined, b: TextStyle | undefined): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined) return false;
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  for (const key of keys) {
    if (key === "fontRelative" ? !sameRelative(a.fontRelative, b.fontRelative) : !Object.is(a[key], b[key]) && JSON.stringify(a[key]) !== JSON.stringify(b[key])) return false;
  }
  return true;
}

/**
 * The text style of an element: what it inherits with its own style over it. The same object as `inherited` when the style has nothing to add, and `previous` (the one
 * the element had) when nothing changed, so an unchanged style is the same object and its descendants are not touched.
 */
export function textStyleOf(inherited: TextStyle | undefined, style: unknown, previous?: TextStyle): TextStyle | undefined {
  if (!hasTextKeys(style)) return sameText(inherited, previous) ? previous : inherited;
  const next: TextStyle = { ...inherited };
  lay(next, style);
  if (Object.keys(next).length === 0) return undefined;
  return sameText(next, previous) ? previous : next;
}

/** The font size a text with this inherited style and own style is drawn at. */
export function fontSizeOf(inherited: TextStyle | undefined, style: unknown): number {
  const text: TextStyle = {};
  lay(text, [inherited, style]);
  return typeof text.fontSize === "number" ? text.fontSize : DEFAULT_FONT_SIZE;
}

/** The style with each `fontRelative` made into dp for `fontSize`, in the place it was written (so a later item still overrides it). The same object when there is none. */
export function resolveRelative(style: unknown, fontSize: number): unknown {
  if (Array.isArray(style)) {
    let changed = false;
    const next = style.map((item) => {
      const resolved = resolveRelative(item, fontSize);
      if (resolved !== item) changed = true;
      return resolved;
    });
    return changed ? next : style;
  }
  if (!isStyleObject(style) || !("fontRelative" in style)) return style;
  const { fontRelative, ...rest } = style as Record<string, unknown> & { fontRelative?: Record<string, number> };
  for (const key in fontRelative) rest[key] = Math.round((fontRelative[key] as number) * fontSize * 10_000) / 10_000;
  return rest;
}

/**
 * What a marked element is drawn with: its own style with the relative values made into dp, and, for a text, the text style it inherits under it. `inherited` is the text
 * style of the marked elements above (`textStyleOf`), `receives` whether this element is one that takes it (a text that is not inside another, an input).
 */
export function inheritedStyle(inherited: TextStyle | undefined, style: unknown, receives: boolean): unknown {
  const hasRelative = inherited?.fontRelative !== undefined || hasRelativeKey(style);
  if (!receives || inherited === undefined) return hasRelative ? resolveRelative(style, fontSizeOf(inherited, style)) : style;
  const size = hasRelative ? fontSizeOf(inherited, style) : 0;
  const base = hasRelative ? resolveRelative(inherited, size) : inherited;
  const own = hasRelative ? resolveRelative(style, size) : style;
  return own === undefined || own === null ? base : [base, own];
}

function hasRelativeKey(style: unknown): boolean {
  if (Array.isArray(style)) {
    for (const item of style) if (hasRelativeKey(item)) return true;
    return false;
  }
  return isStyleObject(style) && "fontRelative" in style;
}
