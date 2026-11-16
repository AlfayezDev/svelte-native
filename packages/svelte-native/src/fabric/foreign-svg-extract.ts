/**
 * The extraction code of react-native-svg that is written against React children and so cannot be imported without React:
 * `extractText.tsx` (the fonts, and the children that become `TSpan`s), `extractGradient.ts` (the `Stop` children),
 * `extractFilter.ts` (the `FeMergeNode` children) and `xml.tsx`'s parser live in modules that import React. What is here is
 * theirs, line for line, with the children replaced by what the Svelte components collect (the host turns text children into
 * `content` and spans, `Stop` and `FeMergeNode` register with their parent). `tests/foreign/svg/extract.test.ts` runs the library's own functions
 * on the same inputs and compares.
 */
import { extractBrush, extractLengthList, extractOpacity, extractTransform, pickNotNil, units } from "./svg-library.js";
import { Platform } from "./deps-rn.ts";
import { processColorValue } from "./view-configs.ts";

type NumberProp = string | number;
type Props = Record<string, unknown>;

const fontRegExp = /^\s*((?:(?:normal|bold|italic)\s+)*)(?:(\d+(?:\.\d+)?(?:%|px|em|pt|pc|mm|cm|in]))*(?:\s*\/.*?)?\s+)?\s*"?([^"]*)/i;
const fontFamilyPrefix = /^[\s"']*/;
const fontFamilySuffix = /[\s"']*$/;
const commaReg = /\s*,\s*/g;

type ParsedFont = { fontStyle: string; fontSize: NumberProp; fontWeight: NumberProp; fontFamily: string | null } | null;
const cachedFontObjectsFromString: Record<string, ParsedFont> = {};

function extractSingleFontFamily(fontFamilyString?: string) {
  // SVG on the web allows for multiple font-families to be specified. For compatibility, we extract the first font-family, hoping we'll get a match.
  return fontFamilyString ? fontFamilyString.split(commaReg)[0].replace(fontFamilyPrefix, "").replace(fontFamilySuffix, "") : null;
}

function parseFontString(font: string): ParsedFont {
  if (Object.hasOwn(cachedFontObjectsFromString, font)) return cachedFontObjectsFromString[font];
  const match = fontRegExp.exec(font);
  if (!match) {
    cachedFontObjectsFromString[font] = null;
    return null;
  }
  const isBold = /bold/.exec(match[1]);
  const isItalic = /italic/.exec(match[1]);
  cachedFontObjectsFromString[font] = {
    fontSize: match[2] || 12,
    fontWeight: isBold ? "bold" : "normal",
    fontStyle: isItalic ? "italic" : "normal",
    fontFamily: extractSingleFontFamily(match[3]),
  };
  return cachedFontObjectsFromString[font];
}

/** `extractFont` of `extractText.tsx`: the font props of an element as the one `font` object the native text views take. */
export function extractFont(props: Props): Props {
  const { fontStyle, fontVariant, fontWeight, fontStretch, fontSize, fontFamily, textAnchor, textDecoration, letterSpacing, wordSpacing, kerning, fontFeatureSettings, fontVariantLigatures, fontVariationSettings, font } = props as Record<string, never>;
  const ownedFont = pickNotNil({
    fontStyle, fontVariant, fontWeight, fontStretch, fontSize,
    fontFamily: extractSingleFontFamily(fontFamily),
    textAnchor, textDecoration, letterSpacing, wordSpacing, kerning, fontFeatureSettings, fontVariantLigatures, fontVariationSettings,
  });
  const baseFont = typeof font === "string" ? parseFontString(font) : font;
  return { ...(baseFont as object | undefined), ...ownedFont };
}

/**
 * `extractText` of `extractText.tsx` without the children: the text props the native text views take. `content` is null here; the
 * host fills it for a `TSpan` whose only child is a string (the library does the same with `String(children)`).
 */
export function extractText(props: Props): Props {
  const { x, y, dx, dy, rotate, inlineSize, baselineShift, verticalAlign, alignmentBaseline } = props as Record<string, NumberProp | NumberProp[] | undefined>;
  return {
    content: null,
    inlineSize,
    baselineShift,
    verticalAlign,
    alignmentBaseline,
    font: extractFont(props),
    x: extractLengthList(x),
    y: extractLengthList(y),
    dx: extractLengthList(dx),
    dy: extractLengthList(dy),
    rotate: extractLengthList(rotate),
  };
}

/** What a `Stop` hands its gradient: its props, `style` included (the XML parser puts `stop-color` and `offset` there). */
export type StopProps = { offset?: NumberProp; stopColor?: unknown; stopOpacity?: NumberProp; style?: Props };

const percentReg = /^([+-]?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)(%?)$/;
function percentToFloat(percent: NumberProp | { __getAnimatedValue: () => number }): number {
  if (typeof percent === "number") return percent;
  if (typeof percent === "object" && typeof percent.__getAnimatedValue === "function") return percent.__getAnimatedValue();
  const matched = typeof percent === "string" && percent.match(percentReg);
  if (!matched) {
    console.warn(`"${percent}" is not a valid number or percentage string.`);
    return 0;
  }
  return matched[2] ? +matched[1] / 100 : +matched[1];
}
const offsetComparator = (object: number[], other: number[]) => object[0] - other[0];

/** `extractGradient` of `extractGradient.ts`, with the stops in place of the React children; `null` without an `id`, as there. */
export function extractGradient(props: Props, stops: readonly StopProps[]): Props | null {
  const { id, gradientTransform, transform, gradientUnits } = props as { id?: string; gradientTransform?: unknown; transform?: unknown; gradientUnits?: keyof typeof units };
  if (!id) return null;
  const sorted: number[][] = [];
  for (const { style, offset = style?.offset as NumberProp | undefined, stopColor = style?.stopColor || "#000", stopOpacity = style?.stopOpacity as NumberProp | undefined } of stops) {
    const offsetNumber = percentToFloat(offset || 0);
    const color = stopColor && processColorValue(stopColor, Platform.OS === "android" ? "android" : "ios");
    if (typeof color !== "number" || Number.isNaN(offsetNumber)) {
      console.warn(`"${String(stopColor)}" is not a valid color or "${String(offset)}" is not a valid offset`);
      continue;
    }
    const alpha = Math.round(extractOpacity(stopOpacity) * 255);
    sorted.push([offsetNumber, (color & 0x00ffffff) | (alpha << 24)]);
  }
  sorted.sort(offsetComparator);
  const gradient: number[] = [];
  for (const stop of sorted) gradient.push(stop[0], stop[1]);
  return {
    name: id,
    gradient,
    gradientUnits: (gradientUnits && units[gradientUnits]) || 0,
    gradientTransform: extractTransform(gradientTransform || transform || props),
  };
}

// The filter primitives' props (`extractFilter.ts`).
const spaceReg = /\s+/;

export const extractFilter = (props: Props): Props => {
  const { x, y, width, height, result } = props;
  return { x, y, width, height, result };
};

export const extractIn = (props: Props): Props => (props.in ? { in1: props.in } : {});

export const extractFeBlend = (props: Props): Props => {
  const extracted: Props = {};
  if (props.in2) extracted.in2 = props.in2;
  if (props.mode) extracted.mode = props.mode;
  return extracted;
};

export const extractFeColorMatrix = (props: Props): Props => {
  const extracted: Props = {};
  const values = props.values;
  if (values !== undefined) {
    if (Array.isArray(values)) extracted.values = values.map((num: unknown) => (typeof num === "number" ? num : parseFloat(num as string)));
    else if (typeof values === "number") extracted.values = [values];
    else if (typeof values === "string") extracted.values = values.split(spaceReg).map(parseFloat).filter((element: number) => !Number.isNaN(element));
    else console.warn("Invalid value for FeColorMatrix `values` prop");
  }
  if (props.type) extracted.type = props.type;
  return extracted;
};

export const extractFeComposite = (props: Props): Props => {
  const extracted: Props = { in1: props.in || "", in2: props.in2 || "", operator1: props.operator || "over" };
  for (const key of ["k1", "k2", "k3", "k4"]) if (props[key] !== undefined) extracted[key] = Number(props[key]) || 0;
  return extracted;
};

export function extractFeFlood(props: Props): Props {
  const extracted: Props = {};
  const { floodColor, floodOpacity } = props;
  const platform = Platform.OS === "android" ? "android" : "ios";
  if (floodColor != null) extracted.floodColor = !floodColor && typeof floodColor !== "number" ? { type: 0, payload: processColorValue("black", platform) } : extractBrush(floodColor);
  else extracted.floodColor = { type: 0, payload: processColorValue("black", platform) }; // the spec's default is black
  if (floodOpacity != null) extracted.floodOpacity = extractOpacity(floodOpacity as NumberProp);
  return extracted;
}

export const extractFeGaussianBlur = (props: Props): Props => {
  const extracted: Props = {};
  const stdDeviation = props.stdDeviation;
  if (Array.isArray(stdDeviation)) {
    extracted.stdDeviationX = Number(stdDeviation[0]) || 0;
    extracted.stdDeviationY = Number(stdDeviation[1]) || 0;
  } else if (typeof stdDeviation === "string" && stdDeviation.match(spaceReg)) {
    const parts = stdDeviation.split(spaceReg);
    extracted.stdDeviationX = Number(parts[0]) || 0;
    extracted.stdDeviationY = Number(parts[1]) || 0;
  } else if (typeof stdDeviation === "number" || (typeof stdDeviation === "string" && !stdDeviation.match(spaceReg))) {
    extracted.stdDeviationX = Number(stdDeviation) || 0;
    extracted.stdDeviationY = Number(stdDeviation) || 0;
  }
  if (props.edgeMode) extracted.edgeMode = props.edgeMode;
  return extracted;
};

/** `extractFeMerge`: the `in` of each `FeMergeNode`, in order. */
export const extractFeMerge = (ins: readonly (string | undefined)[]): Props => ({ nodes: ins.map((name) => name || "") });
