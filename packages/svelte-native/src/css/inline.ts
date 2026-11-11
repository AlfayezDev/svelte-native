/**
 * A `style="..."` of an HTML element as a React Native style object, at compile time (`lower-html.ts`), by the converter the classes go through
 * (`properties.ts`, `values.ts`, `color.ts`), so a unit or a color means the same in `style="padding: 1rem"` as in `p-4`. A declaration the converter cannot express is
 * an error that names it; so is a value only the device knows (`vw`, `vh`, `env()`), which a class can have and a string written at build time cannot.
 *
 * A unitless `line-height` and an `em` `letter-spacing` are relative to the font size the element ends up with, which is its own or the one it inherits: they are left under
 * a `fontRelative` key for the host to work out (`fabric/text-inherit.ts`).
 */
import { parseCss } from "./parse.ts";
import { convertDeclaration, emptyResult } from "./properties.ts";
import { TRANSFORM_KEYS } from "./table.ts";

const TRANSFORM_PREFIX = "transform:";

export type InlineStyle = { style: Record<string, unknown> } | { error: string };

/** The style of a CSS declaration list (`padding: 4px; color: red`). `rem` is 16 dp, as in the class table. */
export function convertInlineStyle(text: string): InlineStyle {
  const out = emptyResult();
  const problems: string[] = [];
  const env = { remPx: 16, lookup: () => undefined };
  for (const item of parseCss(text)) {
    if (item.kind !== "decl") {
      problems.push(`${item.kind === "rule" ? item.selector : `@${item.name}`} is not a declaration`);
      continue;
    }
    convertDeclaration(item.property, item.value, env, out, (property, reason) => problems.push(`${property}: ${reason}`));
  }
  for (const key in out.dynamic) problems.push(`${key}: a viewport or safe-area unit is only for classes (\`w-[50vw]\`); a style written at build time cannot know the device`);
  if (problems.length > 0) return { error: problems.join("; ") };
  const style: Record<string, unknown> = {};
  for (const key in out.style) {
    const value = out.style[key];
    // A null is the initial value of a property (`transform: none`): there is nothing earlier in an inline style to take it from.
    if (value !== null && value !== undefined) style[key] = value;
  }
  // CSS's `translate`, `rotate` and `scale` are properties of their own, applied in that order before `transform`: React Native has the one list (`css/runtime.ts`).
  const transform: Record<string, string | number>[] = [];
  for (const key of TRANSFORM_KEYS) {
    if (!(key in style)) continue;
    transform.push({ [key.slice(TRANSFORM_PREFIX.length)]: style[key] as string | number });
    delete style[key];
  }
  if (transform.length > 0) style.transform = [...transform, ...(Array.isArray(style.transform) ? (style.transform as typeof transform) : [])];
  if (Object.keys(out.fontRelative).length > 0) style.fontRelative = out.fontRelative;
  return { style };
}
