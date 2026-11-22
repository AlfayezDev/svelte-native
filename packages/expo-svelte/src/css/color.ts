/**
 * CSS colors to React Native color strings: `#rrggbb`, or `rgba(r, g, b, a)` when not opaque. Reads hex, `rgb()`, `hsl()`, `oklab()`,
 * `oklch()`, the named colors and `color-mix()` in srgb, oklab and oklch. OKLab goes to sRGB through Björn Ottosson's matrices and the
 * sRGB transfer function; a colour outside the sRGB gamut is clamped per channel (what Tailwind's documented hex values are).
 */
import { indexOfTop, splitTop } from "./parse.ts";

/** Either sRGB (channels 0..1, gamma encoded) or OKLab (`L`, `a`, `b`), with an alpha. Channels may be outside their range until `toRgbString`. */
type Color = { space: "srgb" | "oklab"; c: [number, number, number]; alpha: number };
export type ColorResult = { color: string } | { error: string };

const NAMED: Record<string, string> = {
  aliceblue: "f0f8ff", antiquewhite: "faebd7", aqua: "00ffff", aquamarine: "7fffd4", azure: "f0ffff", beige: "f5f5dc", bisque: "ffe4c4",
  black: "000000", blanchedalmond: "ffebcd", blue: "0000ff", blueviolet: "8a2be2", brown: "a52a2a", burlywood: "deb887", cadetblue: "5f9ea0",
  chartreuse: "7fff00", chocolate: "d2691e", coral: "ff7f50", cornflowerblue: "6495ed", cornsilk: "fff8dc", crimson: "dc143c", cyan: "00ffff",
  darkblue: "00008b", darkcyan: "008b8b", darkgoldenrod: "b8860b", darkgray: "a9a9a9", darkgreen: "006400", darkgrey: "a9a9a9",
  darkkhaki: "bdb76b", darkmagenta: "8b008b", darkolivegreen: "556b2f", darkorange: "ff8c00", darkorchid: "9932cc", darkred: "8b0000",
  darksalmon: "e9967a", darkseagreen: "8fbc8f", darkslateblue: "483d8b", darkslategray: "2f4f4f", darkslategrey: "2f4f4f",
  darkturquoise: "00ced1", darkviolet: "9400d3", deeppink: "ff1493", deepskyblue: "00bfff", dimgray: "696969", dimgrey: "696969",
  dodgerblue: "1e90ff", firebrick: "b22222", floralwhite: "fffaf0", forestgreen: "228b22", fuchsia: "ff00ff", gainsboro: "dcdcdc",
  ghostwhite: "f8f8ff", gold: "ffd700", goldenrod: "daa520", gray: "808080", green: "008000", greenyellow: "adff2f", grey: "808080",
  honeydew: "f0fff0", hotpink: "ff69b4", indianred: "cd5c5c", indigo: "4b0082", ivory: "fffff0", khaki: "f0e68c", lavender: "e6e6fa",
  lavenderblush: "fff0f5", lawngreen: "7cfc00", lemonchiffon: "fffacd", lightblue: "add8e6", lightcoral: "f08080", lightcyan: "e0ffff",
  lightgoldenrodyellow: "fafad2", lightgray: "d3d3d3", lightgreen: "90ee90", lightgrey: "d3d3d3", lightpink: "ffb6c1", lightsalmon: "ffa07a",
  lightseagreen: "20b2aa", lightskyblue: "87cefa", lightslategray: "778899", lightslategrey: "778899", lightsteelblue: "b0c4de",
  lightyellow: "ffffe0", lime: "00ff00", limegreen: "32cd32", linen: "faf0e6", magenta: "ff00ff", maroon: "800000", mediumaquamarine: "66cdaa",
  mediumblue: "0000cd", mediumorchid: "ba55d3", mediumpurple: "9370db", mediumseagreen: "3cb371", mediumslateblue: "7b68ee",
  mediumspringgreen: "00fa9a", mediumturquoise: "48d1cc", mediumvioletred: "c71585", midnightblue: "191970", mintcream: "f5fffa",
  mistyrose: "ffe4e1", moccasin: "ffe4b5", navajowhite: "ffdead", navy: "000080", oldlace: "fdf5e6", olive: "808000", olivedrab: "6b8e23",
  orange: "ffa500", orangered: "ff4500", orchid: "da70d6", palegoldenrod: "eee8aa", palegreen: "98fb98", paleturquoise: "afeeee",
  palevioletred: "db7093", papayawhip: "ffefd5", peachpuff: "ffdab9", peru: "cd853f", pink: "ffc0cb", plum: "dda0dd", powderblue: "b0e0e6",
  purple: "800080", rebeccapurple: "663399", red: "ff0000", rosybrown: "bc8f8f", royalblue: "4169e1", saddlebrown: "8b4513", salmon: "fa8072",
  sandybrown: "f4a460", seagreen: "2e8b57", seashell: "fff5ee", sienna: "a0522d", silver: "c0c0c0", skyblue: "87ceeb", slateblue: "6a5acd",
  slategray: "708090", slategrey: "708090", snow: "fffafa", springgreen: "00ff7f", steelblue: "4682b4", tan: "d2b48c", teal: "008080",
  thistle: "d8bfd8", tomato: "ff6347", turquoise: "40e0d0", violet: "ee82ee", wheat: "f5deb3", white: "ffffff", whitesmoke: "f5f5f5",
  yellow: "ffff00", yellowgreen: "9acd32",
};

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

function toLinear(c: number): number {
  const s = Math.sign(c);
  const v = Math.abs(c);
  return s * (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
}

function toGamma(x: number): number {
  const s = Math.sign(x);
  const v = Math.abs(x);
  return s * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);
}

function oklabToSrgb([L, a, b]: [number, number, number]): [number, number, number] {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    toGamma(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    toGamma(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    toGamma(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}

function srgbToOklab([r, g, b]: [number, number, number]): [number, number, number] {
  const lr = toLinear(r);
  const lg = toLinear(g);
  const lb = toLinear(b);
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function hex2(v: number): string {
  return Math.round(clamp01(v) * 255)
    .toString(16)
    .padStart(2, "0");
}

/** `#rrggbb`, or `rgba(r, g, b, a)` when the alpha is below 1. */
function toRgbString(color: Color): string {
  const srgb = color.space === "srgb" ? color.c : oklabToSrgb(color.c);
  const alpha = clamp01(color.alpha);
  if (alpha >= 1) return `#${hex2(srgb[0])}${hex2(srgb[1])}${hex2(srgb[2])}`;
  const channel = (v: number) => Math.round(clamp01(v) * 255);
  return `rgba(${channel(srgb[0])}, ${channel(srgb[1])}, ${channel(srgb[2])}, ${Number(alpha.toFixed(3))})`;
}

function toOklab(color: Color): [number, number, number] {
  return color.space === "oklab" ? color.c : srgbToOklab(color.c);
}

function toSrgb(color: Color): [number, number, number] {
  return color.space === "srgb" ? color.c : oklabToSrgb(color.c);
}

// --- Parsing -----------------------------------------------------------------------------------------------------------------

type Parsed = Color | { error: string };
const isError = (value: Parsed): value is { error: string } => "error" in value;

/** A number, or a percentage mapped to `percentScale` (100% is that); `none` is 0. */
function component(text: string, percentScale: number): number | null {
  if (text === "none") return 0;
  const match = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)(%?)$/i.exec(text);
  if (!match) return null;
  const n = Number(match[1]);
  return match[2] === "%" ? (n / 100) * percentScale : n;
}

function angle(text: string): number | null {
  if (text === "none") return 0;
  const match = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)(deg|grad|rad|turn)?$/i.exec(text);
  if (!match) return null;
  const n = Number(match[1]);
  switch ((match[2] ?? "deg").toLowerCase()) {
    case "grad":
      return n * 0.9;
    case "rad":
      return (n * 180) / Math.PI;
    case "turn":
      return n * 360;
    default:
      return n;
  }
}

function alphaOf(text: string | undefined): number | null {
  if (text === undefined) return 1;
  const value = component(text, 1);
  return value === null ? null : clamp01(value);
}

/** The arguments of a color function: `a b c / d` or `a, b, c, d`, as `[a, b, c]` and the alpha text. */
function functionArgs(inner: string): { channels: string[]; alpha: string | undefined } {
  const slash = indexOfTop(inner, "/");
  if (slash >= 0) return { channels: splitTop(inner.slice(0, slash).replaceAll(",", " "), " "), alpha: inner.slice(slash + 1).trim() };
  const commas = splitTop(inner, ",");
  if (commas.length > 1) return { channels: commas.slice(0, 3), alpha: commas[3] };
  const spaced = splitTop(inner, " ");
  return { channels: spaced.slice(0, 3), alpha: spaced[3] };
}

function parseFunction(name: string, inner: string): Parsed {
  const { channels, alpha: alphaText } = functionArgs(inner);
  if (channels.length !== 3) return { error: `${name}() takes three channels` };
  const alpha = alphaOf(alphaText);
  if (alpha === null) return { error: `alpha ${alphaText} is not a number` };
  const [x, y, z] = channels as [string, string, string];
  switch (name) {
    case "rgb":
    case "rgba": {
      const r = component(x, 255);
      const g = component(y, 255);
      const b = component(z, 255);
      if (r === null || g === null || b === null) return { error: `rgb(${inner}) is not understood` };
      return { space: "srgb", c: [r / 255, g / 255, b / 255], alpha };
    }
    case "hsl":
    case "hsla": {
      const h = angle(x);
      const s = component(y, 1);
      const l = component(z, 1);
      if (h === null || s === null || l === null) return { error: `hsl(${inner}) is not understood` };
      return { space: "srgb", c: hslToSrgb(h, clamp01(s), clamp01(l)), alpha };
    }
    case "oklab": {
      const L = component(x, 1);
      const a = component(y, 0.4);
      const b = component(z, 0.4);
      if (L === null || a === null || b === null) return { error: `oklab(${inner}) is not understood` };
      return { space: "oklab", c: [L, a, b], alpha };
    }
    case "oklch": {
      const L = component(x, 1);
      const C = component(y, 0.4);
      const h = angle(z);
      if (L === null || C === null || h === null) return { error: `oklch(${inner}) is not understood` };
      const rad = (h * Math.PI) / 180;
      return { space: "oklab", c: [L, C * Math.cos(rad), C * Math.sin(rad)], alpha };
    }
    default:
      return { error: `${name}() is not supported` };
  }
}

function hslToSrgb(h: number, s: number, l: number): [number, number, number] {
  const hue = (((h % 360) + 360) % 360) / 30;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + hue) % 12;
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [f(0), f(8), f(4)];
}

function parseHex(text: string): Parsed {
  const digits = text.slice(1);
  if (!/^[0-9a-f]+$/i.test(digits) || ![3, 4, 6, 8].includes(digits.length)) return { error: `${text} is not a hex color` };
  const full = digits.length <= 4 ? [...digits].map((d) => d + d).join("") : digits;
  const byte = (i: number) => Number.parseInt(full.slice(i * 2, i * 2 + 2), 16) / 255;
  return { space: "srgb", c: [byte(0), byte(1), byte(2)], alpha: full.length === 8 ? byte(3) : 1 };
}

function parseColor(text: string): Parsed {
  const value = text.trim();
  const lower = value.toLowerCase();
  if (value.startsWith("#")) return parseHex(value);
  if (lower === "transparent") return { space: "srgb", c: [0, 0, 0], alpha: 0 };
  const hexOfName = Object.hasOwn(NAMED, lower) ? NAMED[lower] : undefined;
  if (hexOfName !== undefined) return parseHex(`#${hexOfName}`);
  if (lower === "currentcolor" || lower === "inherit") return { error: `${lower} depends on the element and is not supported` };
  const open = value.indexOf("(");
  if (open > 0 && value.endsWith(")")) {
    const name = lower.slice(0, open);
    const inner = value.slice(open + 1, -1).trim();
    if (name === "color-mix") return parseColorMix(inner);
    return parseFunction(name, inner);
  }
  return { error: `${value} is not a color this converter understands` };
}

// --- color-mix() -------------------------------------------------------------------------------------------------------------

function parseColorMix(inner: string): Parsed {
  const parts = splitTop(inner, ",");
  const method = /^in\s+(\S+)(?:\s+(shorter|longer|increasing|decreasing)\s+hue)?$/i.exec(parts[0] ?? "");
  if (!method || parts.length !== 3) return { error: `color-mix(${inner}) is not understood` };
  const space = (method[1] as string).toLowerCase();
  if (space !== "srgb" && space !== "oklab" && space !== "oklch") return { error: `color-mix in ${space} is not supported (srgb, oklab and oklch are)` };
  if (method[2] !== undefined && method[2].toLowerCase() !== "shorter") return { error: "color-mix hue interpolation other than shorter is not supported" };
  const entries: { color: Color; percent: number | null }[] = [];
  for (const part of parts.slice(1)) {
    let percent: number | null = null;
    let text = part;
    const lead = /^(\d+\.?\d*|\.\d+)%\s+(.+)$/.exec(part);
    const tail = /^(.+?)\s+(\d+\.?\d*|\.\d+)%$/.exec(part);
    if (lead) {
      percent = Number(lead[1]);
      text = lead[2] as string;
    } else if (tail) {
      percent = Number(tail[2]);
      text = tail[1] as string;
    }
    const color = parseColor(text);
    if (isError(color)) return color;
    entries.push({ color, percent });
  }
  const [first, second] = entries as [(typeof entries)[number], (typeof entries)[number]];
  let p1 = first.percent;
  let p2 = second.percent;
  if (p1 === null && p2 === null) {
    p1 = 50;
    p2 = 50;
  } else if (p1 === null) p1 = 100 - (p2 as number);
  else if (p2 === null) p2 = 100 - p1;
  const sum = p1 + (p2 as number);
  if (sum <= 0) return { error: "color-mix percentages add up to 0" };
  const w1 = p1 / sum;
  const w2 = (p2 as number) / sum;
  const multiplier = sum < 100 ? sum / 100 : 1;
  const alpha = first.color.alpha * w1 + second.color.alpha * w2;
  if (alpha === 0) return { space: "srgb", c: [0, 0, 0], alpha: 0 };
  const mixed = mixChannels(space, first.color, second.color, w1, w2, alpha);
  return { space: space === "srgb" ? "srgb" : "oklab", c: mixed, alpha: alpha * multiplier };
}

/** Interpolates premultiplied by alpha, as CSS does, in the named space; `alpha` is the mixed alpha. */
function mixChannels(space: string, c1: Color, c2: Color, w1: number, w2: number, alpha: number): [number, number, number] {
  const a1 = c1.alpha;
  const a2 = c2.alpha;
  const mixPremultiplied = (x: number, y: number) => (x * a1 * w1 + y * a2 * w2) / alpha;
  if (space === "srgb") {
    const x = toSrgb(c1);
    const y = toSrgb(c2);
    return [mixPremultiplied(x[0], y[0]), mixPremultiplied(x[1], y[1]), mixPremultiplied(x[2], y[2])];
  }
  const x = toOklab(c1);
  const y = toOklab(c2);
  if (space === "oklab") return [mixPremultiplied(x[0], y[0]), mixPremultiplied(x[1], y[1]), mixPremultiplied(x[2], y[2])];
  // oklch: lightness and chroma are premultiplied; the hue takes the shorter way, and an achromatic (or fully transparent) side lends its hue from the other.
  const polar = (v: [number, number, number]) => ({ L: v[0], C: Math.hypot(v[1], v[2]), h: (Math.atan2(v[2], v[1]) * 180) / Math.PI });
  const p = polar(x);
  const q = polar(y);
  const none1 = p.C < 1e-6 || a1 === 0;
  const none2 = q.C < 1e-6 || a2 === 0;
  let h1 = none1 ? q.h : p.h;
  let h2 = none2 ? p.h : q.h;
  if (none1 && none2) {
    h1 = 0;
    h2 = 0;
  }
  const delta = ((((h2 - h1) % 360) + 540) % 360) - 180;
  const hue = ((h1 + delta * w2) * Math.PI) / 180;
  const L = mixPremultiplied(p.L, q.L);
  const C = mixPremultiplied(p.C, q.C);
  return [L, C * Math.cos(hue), C * Math.sin(hue)];
}

/** A CSS color as a React Native color string, or the reason it is not one. */
export function convertColor(text: string): ColorResult {
  const parsed = parseColor(text);
  if (isError(parsed)) return parsed;
  return { color: toRgbString(parsed) };
}

/** The alpha of a color string `convertColor` made: 0 for a color that paints nothing. */
export function colorAlpha(color: string): number {
  const match = /^rgba\(.*,\s*([\d.]+)\)$/.exec(color);
  return match ? Number(match[1]) : 1;
}
