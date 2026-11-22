/**
 * The small run-time parser of the style an HTML element gets as `style:property={value}` directives (`hostStyleProps`) or as a string that is only known when the app runs
 * (`style={text}`, `styleText`): the name is camel-cased, `px` and a plain number are dp, `rem` is 16 dp, a percentage, a color or a keyword passes as it is, and a unitless
 * `line-height` and an `em` `line-height` or `letter-spacing` are a factor of the font size (`fontRelative`, `fabric/text-inherit.ts`). A string that is written in the source is
 * converted when the file is built, by the converter of the classes (`css/inline.ts`), which this module does not need and the app does not carry.
 */

import { NATIVE_DISPLAY } from "./fabric/html-flow.ts";

const LENGTH = /^(-?(?:\d+\.?\d*|\.\d+))(px|rem)?$/;
const EM = /^(-?(?:\d+\.?\d*|\.\d+))em$/;
const PLAIN = /^(?:-?(?:\d+\.?\d*|\.\d+)%|#[0-9a-f]{3,8}|(?:rgb|hsl)a?\([^)]*\)|[a-z][a-z-]*)$/i;
const IMPORTANT = /\s*!\s*important\s*$/i;
const dev = () => typeof __DEV__ !== "undefined" && __DEV__;

type StyleValue = { value: unknown } | { relative: number };

function styleValue(key: string, value: unknown): StyleValue | undefined {
  if (typeof value === "number") return key === "lineHeight" ? { relative: value } : { value };
  if (typeof value !== "string") return undefined;
  const text = value.replace(IMPORTANT, "").trim();
  const length = LENGTH.exec(text);
  if (length) {
    const unit = length[2];
    if (unit === undefined && key === "lineHeight") return { relative: Number(length[1]) };
    return { value: unit === "rem" ? Number(length[1]) * 16 : Number(length[1]) };
  }
  const em = EM.exec(text);
  if (em) return key === "lineHeight" || key === "letterSpacing" ? { relative: Number(em[1]) } : undefined;
  return PLAIN.test(text) ? { value: text } : undefined;
}

/** Development says when a name is not a style React Native knows. The list of the ones it knows is loaded only then: `__DEV__` is a constant of the build, and a release build leaves the branch, and the module, out. */
function warnUnknown(key: string, where: string): void {
  if (typeof __DEV__ !== "undefined" && __DEV__) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { KNOWN_STYLE_KEYS } = require("./html-style-known.ts") as typeof import("./html-style-known.ts");
    if (!KNOWN_STYLE_KEYS.has(key)) console.warn(`expo-svelte: ${where}: ${key} is not a style React Native knows`);
  }
}

function setProperty(style: Record<string, unknown>, name: string, value: unknown, where: string): void {
  if (value === undefined || value === null || value === false || value === "") return;
  if (name.startsWith("--")) {
    if (dev()) console.warn(`expo-svelte: ${where} is a custom property, which a native style does not have, so it is left out`);
    return;
  }
  const key = name.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
  const parsed = styleValue(key, value);
  if (parsed === undefined) {
    if (dev()) console.warn(`expo-svelte: ${where} is not a value a native style takes (px, rem, a number, a percentage, a color or a keyword), so it is left out`);
    return;
  }
  warnUnknown(key, where);
  if ("relative" in parsed) {
    style.fontRelative = { ...(style.fontRelative as object), [key]: parsed.relative };
  } else if (key === "display" && typeof parsed.value === "string") {
    // As the converter of the classes writes it: the native view's `display`, and the keyword the author used (`fabric/html-flow.ts`). One it has no native equivalent for (`grid`, `table`) is left out.
    const keyword = parsed.value.toLowerCase();
    if (!Object.hasOwn(NATIVE_DISPLAY, keyword)) {
      if (dev()) console.warn(`expo-svelte: ${where}: display: ${keyword} has no React Native equivalent (a view is flex, \`none\` or \`contents\`), so it is left out`);
      return;
    }
    style.display = NATIVE_DISPLAY[keyword];
    style.htmlDisplay = keyword;
  } else style[key] = key === "fontWeight" ? String(parsed.value) : parsed.value;
}

/** The style of the `style:property={value}` directives of an element, as a React Native style object. `null`, `undefined` and `false` take the property away, as they do on the web. */
export function hostStyleProps(props: Record<string, unknown>): Record<string, unknown> {
  const style: Record<string, unknown> = {};
  for (const name in props) setProperty(style, name, props[name], `style:${name}={${JSON.stringify(props[name])}}`);
  return style;
}

/** The style of a CSS declaration list known only when the app runs (`padding: 4px; color: red !important`): the same values as the directives take. */
export function styleText(text: string): Record<string, unknown> {
  const style: Record<string, unknown> = {};
  for (const declaration of text.split(";")) {
    const colon = declaration.indexOf(":");
    if (colon <= 0) continue;
    const name = declaration.slice(0, colon).trim().toLowerCase();
    setProperty(style, name, declaration.slice(colon + 1), `${name}: ${declaration.slice(colon + 1).trim()}`);
  }
  return style;
}
