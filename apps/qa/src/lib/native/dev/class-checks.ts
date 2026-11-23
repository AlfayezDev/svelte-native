/**
 * What the class checks of the native checks lab expect (`/__dev`, "Run all checks": `class-lab.ts` runs them on the views of `ClassProbe.svelte`). No React Native import, so the harness's tests load it
 * (`qa/test/class-checks.test.ts` holds every expectation against the class table the build writes from `src/global.css`).
 *
 * `class` on a lowered tag is resolved in the page's template (`hostClass`, `classes.ts`): the host node, which `{@attach}` hands out, holds the style of the classes as `nativeClass` and its own style as
 * `nativeStyle`. What the host sends to the native view is `mergeHostProps(node.peekProps())` (`native-props.ts`, exported from the library's `./renderer` entry: the host calls the same function), whose
 * `style` is the class under the element's own style. The checks read that, not a merge of their own, so a host that put the class over the inline style would fail them. They cover what the build wrote into
 * the bundle (the class table), the resolver running on Hermes (the color scheme, the window width, the font size) and the template that applied it. One of them also reads the layout the native side made of
 * a class, because a style that never reached Yoga would pass all the others.
 *
 * The expected values are Tailwind 4.3.5's: its spacing scale is 0.25 rem (4 dp) a step, its colours oklch converted to sRGB by the build.
 */

export type Style = Record<string, unknown>;
/** The part of the renderer's `NativeNode` the checks read: its attributes, from which the host builds the props it sends (`mergeHostProps`). */
export type HostNode = { getProp(key: string): unknown; peekProps(): Readonly<Record<string, unknown>> };
export type Outcome = { passed: boolean; detail: string };

/** The names of the class checks, in the order the lab runs them: `qa/test/class-checks.test.ts` pins their number (the lab's count of functional checks is 28, these and the HTML checks) and their length (logcat cuts the lab's result line near 4 KB). */
export const classCheckNames = [
  "p-4: padding 16 on four sides",
  "p-4 reaches the layout (16 dp in)",
  "bg-sky-500/50: half-opacity sky",
  "md: and max-md: follow the width",
  "dark:bg-zinc-900 follows the scheme",
  "own class: layer + dark override",
  "a utility beats a components class",
  "inline style wins over classes",
  "class arrays/objects follow state",
  "text-lg: size 18, line height",
] as const;

/** A style value (an object, or arrays and falsy values of them) as one object: the later entry wins a key, `false`, `null` and `undefined` are skipped, as React Native flattens it. */
export function flattenStyle(style: unknown): Style {
  if (Array.isArray(style)) return Object.assign({}, ...style.map(flattenStyle));
  return style !== null && typeof style === "object" ? { ...(style as Style) } : {};
}

/** The style of a host node's `class` alone (what the resolver made of it, before the element's own style goes over it). */
export const classStyle = (node: HostNode): Style => flattenStyle(node.getProp("nativeClass"));

/** The style of what the host sends to the native view ([sent] is `mergeHostProps(node.peekProps())`): the class under the element's own style, flattened. */
export const sentStyle = (sent: Readonly<Record<string, unknown>>): Style => flattenStyle(sent.style);

/** The four sides of `padding` or `margin` as a style gives them: the shorthand, the horizontal and vertical pairs and the sides, the later and the more specific winning, as React Native reads them. Null when a side has no number. */
export function sides(style: Style, property: "padding" | "margin"): [top: number, right: number, bottom: number, left: number] | null {
  const number = (key: string): number | undefined => (typeof style[key] === "number" ? (style[key] as number) : undefined);
  const all = number(property);
  const vertical = number(`${property}Vertical`) ?? all;
  const horizontal = number(`${property}Horizontal`) ?? all;
  const found = [number(`${property}Top`) ?? vertical, number(`${property}Right`) ?? horizontal, number(`${property}Bottom`) ?? vertical, number(`${property}Left`) ?? horizontal];
  return found.every((side) => side !== undefined) ? (found as [number, number, number, number]) : null;
}

/** All four sides are [expected]. */
export const allSides = (style: Style, property: "padding" | "margin", expected: number): boolean => {
  const found = sides(style, property);
  return found !== null && found.every((side) => side === expected);
};

export type Rgba = { r: number; g: number; b: number; a: number };

/** A colour string as the build writes it (`#rrggbb`, `#rrggbbaa`, `rgb(...)`, `rgba(0, 166, 244, 0.5)`, the slash form of CSS Color 4), or null for anything else. */
export function parseColor(value: unknown): Rgba | null {
  if (typeof value !== "string") return null;
  const hex = /^#([0-9a-f]{3,8})$/i.exec(value.trim());
  if (hex?.[1]) {
    const digits = hex[1].length === 3 || hex[1].length === 4 ? [...hex[1]].map((digit) => digit + digit).join("") : hex[1];
    if (digits.length !== 6 && digits.length !== 8) return null;
    return { r: parseInt(digits.slice(0, 2), 16), g: parseInt(digits.slice(2, 4), 16), b: parseInt(digits.slice(4, 6), 16), a: digits.length === 8 ? Math.round((parseInt(digits.slice(6, 8), 16) / 255) * 1000) / 1000 : 1 };
  }
  const functional = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/i.exec(value.trim());
  if (!functional) return null;
  const alpha = functional[4] === undefined ? 1 : functional[4].endsWith("%") ? Number(functional[4].slice(0, -1)) / 100 : Number(functional[4]);
  return { r: Number(functional[1]), g: Number(functional[2]), b: Number(functional[3]), a: alpha };
}

/** Whether [value] is the colour [expected] (`#rrggbb` or channels), each channel within [tolerance] and the opacity within a hundredth. */
export function isColor(value: unknown, expected: string | Omit<Rgba, "a"> & { a?: number }, tolerance = 1): boolean {
  const found = parseColor(value);
  const wanted = typeof expected === "string" ? parseColor(expected) : { a: 1, ...expected };
  return !!found && !!wanted && Math.abs(found.r - wanted.r) <= tolerance && Math.abs(found.g - wanted.g) <= tolerance && Math.abs(found.b - wanted.b) <= tolerance && Math.abs(found.a - wanted.a) <= 0.01;
}

const show = (style: Style, ...keys: string[]): string => keys.map((key) => `${key} ${JSON.stringify(style[key])}`).join(", ");
const verdict = (passed: boolean, detail: string): Outcome => ({ passed, detail: passed ? "" : detail });

/** Tailwind 4.3.5's sky-500 (`oklch(68.5% .169 237.323)`) as the build converts it to sRGB. */
export const sky500 = { r: 0, g: 166, b: 244 } as const;
/** `white` and zinc-900 (`oklch(21% .006 285.885)`), the light and dark backgrounds of the scheme classes. */
export const white = "#ffffff";
export const zinc900 = "#18181b";
/** zinc-400, which an inline style goes over; and the orange the inline style writes. */
export const zinc400 = "#9f9fa9";
export const orange = "#f97316";
/** The breakpoint of `md:` in dp (48 rem). */
export const mdBreakpoint = 768;

/** What each check asks of what it read. A function takes the style (or styles) the lab read and answers whether it is right, with a message for when it is not (empty when it is). */
export const expectations = {
  padding: (style: Style): Outcome => verdict(allSides(style, "padding", 16), show(style, "paddingTop", "paddingRight", "paddingBottom", "paddingLeft", "padding")),
  /** [parent] and [child] are the windows of the padded view and of the view inside it (x, y, width, height in dp); the child is 40 x 20. */
  layout: (parent: Rect | null, child: Rect | null): Outcome => {
    if (!parent || !child) return verdict(false, `no layout: ${JSON.stringify(parent)} ${JSON.stringify(child)}`);
    const found = { left: child.x - parent.x, top: child.y - parent.y, right: parent.x + parent.width - (child.x + child.width), bottom: parent.y + parent.height - (child.y + child.height) };
    return verdict(Object.values(found).every((side) => Math.abs(side - 16) <= 0.6), `the child sits ${JSON.stringify(found)} dp in; the parent is ${parent.width}x${parent.height}, the child ${child.width}x${child.height}`);
  },
  tint: (style: Style): Outcome => verdict(isColor(style.backgroundColor, { ...sky500, a: 0.5 }), show(style, "backgroundColor")),
  /**
   * [width] is the window's width in dp: `md:` applies from the breakpoint up and `max-md:` below it, so a phone has the second and a window at or over it (a tablet) the first, and the check is right on both.
   * A phone is what the second is for: `p-2 md:p-10` alone proves a class is absent, `p-2 max-md:p-10` that the same condition applies.
   */
  responsive: (md: Style, capped: Style, width: number): Outcome => {
    const wide = width >= mdBreakpoint;
    return verdict(allSides(md, "padding", wide ? 40 : 8) && allSides(capped, "padding", wide ? 8 : 40), `window ${width} dp: md: wanted ${wide ? 40 : 8}, max-md: wanted ${wide ? 8 : 40}; ${show(md, "paddingTop", "paddingLeft")} / ${show(capped, "paddingTop", "paddingLeft")}`);
  },
  /** The scheme classes under the light scheme and under the dark one: the background is white, then zinc-900. */
  scheme: (light: Style, dark: Style | null): Outcome =>
    verdict(isColor(light.backgroundColor, white, 0) && !!dark && isColor(dark.backgroundColor, zinc900, 1), `light ${JSON.stringify(light.backgroundColor)}, dark ${JSON.stringify(dark?.backgroundColor)}`),
  /** The class of our own, light and dark: 12 dp of padding, a 10 dp radius on every corner, and the background of the scheme. */
  custom: (light: Style, dark: Style | null): Outcome => {
    const corners = ["borderTopLeftRadius", "borderTopRightRadius", "borderBottomRightRadius", "borderBottomLeftRadius"].every((key) => light[key] === 10) || light.borderRadius === 10;
    return verdict(allSides(light, "padding", 12) && corners && isColor(light.backgroundColor, white, 0) && !!dark && allSides(dark, "padding", 12) && isColor(dark.backgroundColor, zinc900, 1),
      `${show(light, "paddingTop", "borderTopLeftRadius", "backgroundColor")}; dark ${JSON.stringify(dark?.backgroundColor)}`);
  },
  /** `qa-card p-6`: the utility's 24 over the class's 12, and the class's radius is still there. */
  beaten: (style: Style): Outcome => verdict(allSides(style, "padding", 24) && (style.borderTopLeftRadius === 10 || style.borderRadius === 10), show(style, "paddingTop", "paddingLeft", "borderTopLeftRadius")),
  /** What the host sends ([sent]) is the inline orange; what the class alone made ([classes]) is zinc-400, so the style went over it and did not replace it. */
  inline: (sent: Style, classes: Style): Outcome => verdict(isColor(sent.backgroundColor, orange, 0) && isColor(classes.backgroundColor, zinc400, 1), `sent ${JSON.stringify(sent.backgroundColor)}, classes ${JSON.stringify(classes.backgroundColor)}`),
  /** The array form and the object form of `class`, before and after the state is set: 16, then 32. */
  state: (before: { list: Style; object: Style }, after: { list: Style; object: Style } | null): Outcome =>
    verdict(allSides(before.list, "padding", 16) && allSides(before.object, "padding", 16) && !!after && allSides(after.list, "padding", 32) && allSides(after.object, "padding", 32),
      `before ${show(before.list, "paddingTop")} / ${show(before.object, "paddingTop")}; after ${after ? `${show(after.list, "paddingTop")} / ${show(after.object, "paddingTop")}` : "never changed"}`),
  /** `text-lg` is 18 dp and a line height of 1.5556 times it (28), made on the device from the element's font size. */
  text: (style: Style): Outcome => verdict(style.fontSize === 18 && typeof style.lineHeight === "number" && Math.abs(style.lineHeight - 28) < 0.01 && style.fontWeight === "600", show(style, "fontSize", "lineHeight", "fontWeight")),
};

export type Rect = { x: number; y: number; width: number; height: number };
