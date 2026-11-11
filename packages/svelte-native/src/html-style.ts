/**
 * The small run-time parser of the style an HTML element gets as `style:property={value}` directives (`hostStyleProps`) or as a string that is only known when the app runs
 * (`style={text}`, `styleText`): the name is camel-cased, `px` and a plain number are dp, `rem` is 16 dp, a percentage, a color or a keyword passes as it is, and a unitless
 * `line-height` and an `em` `line-height` or `letter-spacing` are a factor of the font size (`fontRelative`, `fabric/text-inherit.ts`). A string that is written in the source is
 * converted when the file is built, by the converter of the classes (`css/inline.ts`), which this module does not need and the app does not carry.
 */

const LENGTH = /^(-?(?:\d+\.?\d*|\.\d+))(px|rem)?$/;
const EM = /^(-?(?:\d+\.?\d*|\.\d+))em$/;
const PLAIN = /^(?:-?(?:\d+\.?\d*|\.\d+)%|#[0-9a-f]{3,8}|(?:rgb|hsl)a?\([^)]*\)|[a-z][a-z-]*)$/i;
const IMPORTANT = /\s*!\s*important\s*$/i;
const dev = () => typeof __DEV__ !== "undefined" && __DEV__;

/** The style keys React Native knows (its `ReactNativeStyleAttributes`), for the warning about a name that is none of them. */
const KNOWN = `alignContent alignItems alignSelf aspectRatio borderBottomWidth borderEndWidth borderLeftWidth borderRightWidth borderStartWidth borderTopWidth boxSizing columnGap borderWidth bottom direction display end flex flexBasis flexDirection flexGrow flexShrink flexWrap gap height inset insetBlock insetBlockEnd insetBlockStart insetInline insetInlineEnd insetInlineStart justifyContent left margin marginBlock marginBlockEnd marginBlockStart marginBottom marginEnd marginHorizontal marginInline marginInlineEnd marginInlineStart marginLeft marginRight marginStart marginTop marginVertical maxHeight maxWidth minHeight minWidth overflow padding paddingBlock paddingBlockEnd paddingBlockStart paddingBottom paddingEnd paddingHorizontal paddingInline paddingInlineEnd paddingInlineStart paddingLeft paddingRight paddingStart paddingTop paddingVertical position right rowGap start top width zIndex elevation shadowColor shadowOffset shadowOpacity shadowRadius transform transformOrigin filter mixBlendMode isolation boxShadow backfaceVisibility backgroundColor borderBlockColor borderBlockEndColor borderBlockStartColor borderBottomColor borderBottomEndRadius borderBottomLeftRadius borderBottomRightRadius borderBottomStartRadius borderColor borderCurve borderEndColor borderEndEndRadius borderEndStartRadius borderLeftColor borderRadius borderRightColor borderStartColor borderStartEndRadius borderStartStartRadius borderStyle borderTopColor borderTopEndRadius borderTopLeftRadius borderTopRightRadius borderTopStartRadius cursor opacity outlineColor outlineOffset outlineStyle outlineWidth pointerEvents color fontFamily fontSize fontStyle fontVariant fontWeight includeFontPadding letterSpacing lineHeight textAlign textAlignVertical textDecorationColor textDecorationLine textDecorationStyle textShadowColor textShadowOffset textShadowRadius textTransform userSelect verticalAlign writingDirection overlayColor resizeMode tintColor objectFit`;
let known: Set<string> | undefined;

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

function setProperty(style: Record<string, unknown>, name: string, value: unknown, where: string): void {
  if (value === undefined || value === null || value === false || value === "") return;
  if (name.startsWith("--")) {
    if (dev()) console.warn(`svelte-native: ${where} is a custom property, which a native style does not have, so it is left out`);
    return;
  }
  const key = name.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
  const parsed = styleValue(key, value);
  if (parsed === undefined) {
    if (dev()) console.warn(`svelte-native: ${where} is not a value a native style takes (px, rem, a number, a percentage, a color or a keyword), so it is left out`);
    return;
  }
  if (dev()) {
    known ??= new Set(KNOWN.split(" "));
    if (!known.has(key)) console.warn(`svelte-native: ${where}: ${key} is not a style React Native knows`);
  }
  if ("relative" in parsed) style.fontRelative = { ...(style.fontRelative as object), [key]: parsed.relative };
  else style[key] = key === "fontWeight" ? String(parsed.value) : parsed.value;
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
