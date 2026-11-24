"use strict";
var __importMetaUrl = require("node:url").pathToFileURL(__filename).href;
"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/transformer.ts
var transformer_exports = {};
__export(transformer_exports, {
  getCacheKey: () => getCacheKey,
  sourceOf: () => sourceOf,
  transform: () => transform,
  upstreamTransformerPath: () => upstreamTransformerPath
});
module.exports = __toCommonJS(transformer_exports);
var import_node_module3 = __toESM(require("node:module"), 1);
var import_node_path8 = require("node:path");
var import_esbuild = require("esbuild");
var import_node_crypto = require("node:crypto");
var import_node_fs6 = require("node:fs");
var import_parser2 = require("@babel/parser");
var import_types = require("@babel/types");

// src/compile-options.ts
var import_node_fs2 = require("node:fs");
var import_node_path2 = require("node:path");

// src/package-root.ts
var import_node_fs = require("node:fs");
var import_node_path = require("node:path");
function findPackageRoot(from) {
  for (let directory = from; ; directory = (0, import_node_path.dirname)(directory)) {
    if ((0, import_node_fs.existsSync)((0, import_node_path.join)(directory, "package.json"))) return directory;
    if ((0, import_node_path.dirname)(directory) === directory) throw new Error(`No package.json above ${from}: the package's files moved`);
  }
}
var packageRoot = findPackageRoot(__dirname);
var sourceDirectory = (0, import_node_path.join)(packageRoot, "src");
function sourceFile(path) {
  const file = (0, import_node_path.resolve)(sourceDirectory, path);
  if (!(0, import_node_fs.existsSync)(file)) throw new Error(`${file} is not in the package: the Node-side code names a source file that is missing`);
  return file;
}

// src/compile-options.ts
var RUNES_ENVIRONMENT_VARIABLE = "EXPO_SVELTE_RUNES";
function runesDefaultEnabled(env = process.env) {
  return !/^(?:0|false|off|no)$/i.test(env[RUNES_ENVIRONMENT_VARIABLE]?.trim() ?? "");
}
var ASYNC_ENVIRONMENT_VARIABLE = "EXPO_SVELTE_ASYNC";
function asyncEnabled(env = process.env) {
  return /^(?:1|true|on|yes)$/i.test(env[ASYNC_ENVIRONMENT_VARIABLE]?.trim() ?? "");
}
var IN_NODE_MODULES = /(?:^|[\\/])node_modules[\\/]/;
var ownSources = sourceDirectory + import_node_path2.sep;
function isLibrarySource(filename) {
  if (filename.startsWith(ownSources)) return true;
  if (!IN_NODE_MODULES.test(filename)) return false;
  try {
    return (0, import_node_fs2.realpathSync)(filename).startsWith(ownSources);
  } catch {
    return false;
  }
}
function runesOption(filename, enabled = runesDefaultEnabled()) {
  if (isLibrarySource(filename)) return true;
  if (!enabled || IN_NODE_MODULES.test(filename)) return void 0;
  return true;
}
function lowersHtml(filename) {
  return !IN_NODE_MODULES.test(filename) && !isLibrarySource(filename);
}
var CUSTOM_RENDERER = "expo-svelte/renderer";
function componentOptions(filename, enabled = runesDefaultEnabled(), async = asyncEnabled()) {
  return {
    filename,
    dev: false,
    css: "external",
    runes: runesOption(filename, enabled),
    experimental: { customRenderer: CUSTOM_RENDERER, ...async ? { async: true } : {} }
  };
}
function moduleOptions(filename, async = asyncEnabled()) {
  return { filename, dev: false, generate: "client", ...async ? { experimental: { async: true } } : {} };
}

// src/lower.ts
var import_compiler = require("svelte/compiler");

// src/css/parse.ts
function readChunk(css, from) {
  let text = "";
  let depth = 0;
  let i = from;
  let space = false;
  while (i < css.length) {
    const c = css[i];
    if (c === "/" && css[i + 1] === "*") {
      const close = css.indexOf("*/", i + 2);
      i = close < 0 ? css.length : close + 2;
      space = true;
      continue;
    }
    if (c === "\\") {
      if (space && text !== "") text += " ";
      space = false;
      text += c + (css[i + 1] ?? "");
      i += 2;
      continue;
    }
    if (c === '"' || c === "'") {
      if (space && text !== "") text += " ";
      space = false;
      let j = i + 1;
      while (j < css.length && css[j] !== c) j += css[j] === "\\" ? 2 : 1;
      text += css.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    if (depth === 0 && (c === ";" || c === "{" || c === "}")) break;
    if (c === "(" || c === "[") depth++;
    else if (c === ")" || c === "]") depth = Math.max(0, depth - 1);
    if (c === " " || c === "\n" || c === "	" || c === "\r" || c === "\f") {
      space = true;
      i++;
      continue;
    }
    if (space && text !== "") text += " ";
    space = false;
    text += c;
    i++;
  }
  return { text, end: i };
}
function skipBlank(css, from) {
  let i = from;
  while (i < css.length) {
    const c = css[i];
    if (c === " " || c === "\n" || c === "	" || c === "\r" || c === "\f") i++;
    else if (c === "/" && css[i + 1] === "*") {
      const close = css.indexOf("*/", i + 2);
      i = close < 0 ? css.length : close + 2;
    } else break;
  }
  return i;
}
function parseBody(css, from, nested) {
  const items = [];
  let i = from;
  while (true) {
    i = skipBlank(css, i);
    if (i >= css.length) return { items, end: i };
    const c = css[i];
    if (c === "}" && nested) return { items, end: i + 1 };
    if (c === ";" || c === "}") {
      i++;
      continue;
    }
    if (c === "@") {
      const { text: text2, end: end2 } = readChunk(css, i + 1);
      const space = text2.search(/[\s(]/);
      const name = (space < 0 ? text2 : text2.slice(0, space)).toLowerCase();
      const prelude = space < 0 ? "" : text2.slice(space).trim();
      if (css[end2] === "{") {
        const inner = parseBody(css, end2 + 1, true);
        items.push({ kind: "at", name, prelude, body: inner.items });
        i = inner.end;
      } else {
        items.push({ kind: "at", name, prelude, body: null });
        i = end2 + 1;
      }
      continue;
    }
    const { text, end } = readChunk(css, i);
    if (css[end] === "{") {
      const inner = parseBody(css, end + 1, true);
      items.push({ kind: "rule", selector: text, body: inner.items });
      i = inner.end;
      continue;
    }
    i = css[end] === ";" ? end + 1 : end;
    const colon = indexOfTop(text, ":");
    if (colon <= 0) continue;
    const property = text.slice(0, colon).trim();
    let value = text.slice(colon + 1).trim();
    let important = false;
    const bang = /\s*!\s*important\s*$/i.exec(value);
    if (bang) {
      important = true;
      value = value.slice(0, bang.index);
    }
    items.push({ kind: "decl", property: property.startsWith("--") ? property : property.toLowerCase(), value, important });
  }
}
function parseCss(css) {
  return parseBody(css, 0, false).items;
}
function indexOfTop(text, char) {
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "\\") i++;
    else if (c === '"' || c === "'") {
      i++;
      while (i < text.length && text[i] !== c) i += text[i] === "\\" ? 2 : 1;
    } else if (c === "(" || c === "[") depth++;
    else if (c === ")" || c === "]") depth--;
    else if (depth === 0 && c === char) return i;
  }
  return -1;
}
function splitTop(text, separator) {
  const parts = [];
  let depth = 0;
  let start = 0;
  const push = (end) => {
    const part = text.slice(start, end).trim();
    if (part !== "" || separator === ",") parts.push(part);
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "\\") i++;
    else if (c === '"' || c === "'") {
      i++;
      while (i < text.length && text[i] !== c) i += text[i] === "\\" ? 2 : 1;
    } else if (c === "(" || c === "[") depth++;
    else if (c === ")" || c === "]") depth--;
    else if (depth === 0 && (separator === "," ? c === "," : c === " ")) {
      push(i);
      start = i + 1;
    }
  }
  push(text.length);
  return parts;
}

// src/css/color.ts
var NAMED = {
  aliceblue: "f0f8ff",
  antiquewhite: "faebd7",
  aqua: "00ffff",
  aquamarine: "7fffd4",
  azure: "f0ffff",
  beige: "f5f5dc",
  bisque: "ffe4c4",
  black: "000000",
  blanchedalmond: "ffebcd",
  blue: "0000ff",
  blueviolet: "8a2be2",
  brown: "a52a2a",
  burlywood: "deb887",
  cadetblue: "5f9ea0",
  chartreuse: "7fff00",
  chocolate: "d2691e",
  coral: "ff7f50",
  cornflowerblue: "6495ed",
  cornsilk: "fff8dc",
  crimson: "dc143c",
  cyan: "00ffff",
  darkblue: "00008b",
  darkcyan: "008b8b",
  darkgoldenrod: "b8860b",
  darkgray: "a9a9a9",
  darkgreen: "006400",
  darkgrey: "a9a9a9",
  darkkhaki: "bdb76b",
  darkmagenta: "8b008b",
  darkolivegreen: "556b2f",
  darkorange: "ff8c00",
  darkorchid: "9932cc",
  darkred: "8b0000",
  darksalmon: "e9967a",
  darkseagreen: "8fbc8f",
  darkslateblue: "483d8b",
  darkslategray: "2f4f4f",
  darkslategrey: "2f4f4f",
  darkturquoise: "00ced1",
  darkviolet: "9400d3",
  deeppink: "ff1493",
  deepskyblue: "00bfff",
  dimgray: "696969",
  dimgrey: "696969",
  dodgerblue: "1e90ff",
  firebrick: "b22222",
  floralwhite: "fffaf0",
  forestgreen: "228b22",
  fuchsia: "ff00ff",
  gainsboro: "dcdcdc",
  ghostwhite: "f8f8ff",
  gold: "ffd700",
  goldenrod: "daa520",
  gray: "808080",
  green: "008000",
  greenyellow: "adff2f",
  grey: "808080",
  honeydew: "f0fff0",
  hotpink: "ff69b4",
  indianred: "cd5c5c",
  indigo: "4b0082",
  ivory: "fffff0",
  khaki: "f0e68c",
  lavender: "e6e6fa",
  lavenderblush: "fff0f5",
  lawngreen: "7cfc00",
  lemonchiffon: "fffacd",
  lightblue: "add8e6",
  lightcoral: "f08080",
  lightcyan: "e0ffff",
  lightgoldenrodyellow: "fafad2",
  lightgray: "d3d3d3",
  lightgreen: "90ee90",
  lightgrey: "d3d3d3",
  lightpink: "ffb6c1",
  lightsalmon: "ffa07a",
  lightseagreen: "20b2aa",
  lightskyblue: "87cefa",
  lightslategray: "778899",
  lightslategrey: "778899",
  lightsteelblue: "b0c4de",
  lightyellow: "ffffe0",
  lime: "00ff00",
  limegreen: "32cd32",
  linen: "faf0e6",
  magenta: "ff00ff",
  maroon: "800000",
  mediumaquamarine: "66cdaa",
  mediumblue: "0000cd",
  mediumorchid: "ba55d3",
  mediumpurple: "9370db",
  mediumseagreen: "3cb371",
  mediumslateblue: "7b68ee",
  mediumspringgreen: "00fa9a",
  mediumturquoise: "48d1cc",
  mediumvioletred: "c71585",
  midnightblue: "191970",
  mintcream: "f5fffa",
  mistyrose: "ffe4e1",
  moccasin: "ffe4b5",
  navajowhite: "ffdead",
  navy: "000080",
  oldlace: "fdf5e6",
  olive: "808000",
  olivedrab: "6b8e23",
  orange: "ffa500",
  orangered: "ff4500",
  orchid: "da70d6",
  palegoldenrod: "eee8aa",
  palegreen: "98fb98",
  paleturquoise: "afeeee",
  palevioletred: "db7093",
  papayawhip: "ffefd5",
  peachpuff: "ffdab9",
  peru: "cd853f",
  pink: "ffc0cb",
  plum: "dda0dd",
  powderblue: "b0e0e6",
  purple: "800080",
  rebeccapurple: "663399",
  red: "ff0000",
  rosybrown: "bc8f8f",
  royalblue: "4169e1",
  saddlebrown: "8b4513",
  salmon: "fa8072",
  sandybrown: "f4a460",
  seagreen: "2e8b57",
  seashell: "fff5ee",
  sienna: "a0522d",
  silver: "c0c0c0",
  skyblue: "87ceeb",
  slateblue: "6a5acd",
  slategray: "708090",
  slategrey: "708090",
  snow: "fffafa",
  springgreen: "00ff7f",
  steelblue: "4682b4",
  tan: "d2b48c",
  teal: "008080",
  thistle: "d8bfd8",
  tomato: "ff6347",
  turquoise: "40e0d0",
  violet: "ee82ee",
  wheat: "f5deb3",
  white: "ffffff",
  whitesmoke: "f5f5f5",
  yellow: "ffff00",
  yellowgreen: "9acd32"
};
var clamp01 = (v) => Math.min(1, Math.max(0, v));
function toLinear(c) {
  const s = Math.sign(c);
  const v = Math.abs(c);
  return s * (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
}
function toGamma(x) {
  const s = Math.sign(x);
  const v = Math.abs(x);
  return s * (v <= 31308e-7 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);
}
function oklabToSrgb([L, a, b]) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    toGamma(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    toGamma(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    toGamma(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s)
  ];
}
function srgbToOklab([r, g, b]) {
  const lr = toLinear(r);
  const lg = toLinear(g);
  const lb = toLinear(b);
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  ];
}
function hex2(v) {
  return Math.round(clamp01(v) * 255).toString(16).padStart(2, "0");
}
function toRgbString(color) {
  const srgb = color.space === "srgb" ? color.c : oklabToSrgb(color.c);
  const alpha = clamp01(color.alpha);
  if (alpha >= 1) return `#${hex2(srgb[0])}${hex2(srgb[1])}${hex2(srgb[2])}`;
  const channel = (v) => Math.round(clamp01(v) * 255);
  return `rgba(${channel(srgb[0])}, ${channel(srgb[1])}, ${channel(srgb[2])}, ${Number(alpha.toFixed(3))})`;
}
function toOklab(color) {
  return color.space === "oklab" ? color.c : srgbToOklab(color.c);
}
function toSrgb(color) {
  return color.space === "srgb" ? color.c : oklabToSrgb(color.c);
}
var isError = (value) => "error" in value;
function component(text, percentScale) {
  if (text === "none") return 0;
  const match = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)(%?)$/i.exec(text);
  if (!match) return null;
  const n = Number(match[1]);
  return match[2] === "%" ? n / 100 * percentScale : n;
}
function angle(text) {
  if (text === "none") return 0;
  const match = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)(deg|grad|rad|turn)?$/i.exec(text);
  if (!match) return null;
  const n = Number(match[1]);
  switch ((match[2] ?? "deg").toLowerCase()) {
    case "grad":
      return n * 0.9;
    case "rad":
      return n * 180 / Math.PI;
    case "turn":
      return n * 360;
    default:
      return n;
  }
}
function alphaOf(text) {
  if (text === void 0) return 1;
  const value = component(text, 1);
  return value === null ? null : clamp01(value);
}
function functionArgs(inner) {
  const slash = indexOfTop(inner, "/");
  if (slash >= 0) return { channels: splitTop(inner.slice(0, slash).replaceAll(",", " "), " "), alpha: inner.slice(slash + 1).trim() };
  const commas = splitTop(inner, ",");
  if (commas.length > 1) return { channels: commas.slice(0, 3), alpha: commas[3] };
  const spaced = splitTop(inner, " ");
  return { channels: spaced.slice(0, 3), alpha: spaced[3] };
}
function parseFunction(name, inner) {
  const { channels, alpha: alphaText } = functionArgs(inner);
  if (channels.length !== 3) return { error: `${name}() takes three channels` };
  const alpha = alphaOf(alphaText);
  if (alpha === null) return { error: `alpha ${alphaText} is not a number` };
  const [x, y, z] = channels;
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
      const rad = h * Math.PI / 180;
      return { space: "oklab", c: [L, C * Math.cos(rad), C * Math.sin(rad)], alpha };
    }
    default:
      return { error: `${name}() is not supported` };
  }
}
function hslToSrgb(h, s, l) {
  const hue = (h % 360 + 360) % 360 / 30;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => {
    const k = (n + hue) % 12;
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [f(0), f(8), f(4)];
}
function parseHex(text) {
  const digits = text.slice(1);
  if (!/^[0-9a-f]+$/i.test(digits) || ![3, 4, 6, 8].includes(digits.length)) return { error: `${text} is not a hex color` };
  const full = digits.length <= 4 ? [...digits].map((d) => d + d).join("") : digits;
  const byte = (i) => Number.parseInt(full.slice(i * 2, i * 2 + 2), 16) / 255;
  return { space: "srgb", c: [byte(0), byte(1), byte(2)], alpha: full.length === 8 ? byte(3) : 1 };
}
function parseColor(text) {
  const value = text.trim();
  const lower = value.toLowerCase();
  if (value.startsWith("#")) return parseHex(value);
  if (lower === "transparent") return { space: "srgb", c: [0, 0, 0], alpha: 0 };
  const hexOfName = Object.hasOwn(NAMED, lower) ? NAMED[lower] : void 0;
  if (hexOfName !== void 0) return parseHex(`#${hexOfName}`);
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
function parseColorMix(inner) {
  const parts = splitTop(inner, ",");
  const method = /^in\s+(\S+)(?:\s+(shorter|longer|increasing|decreasing)\s+hue)?$/i.exec(parts[0] ?? "");
  if (!method || parts.length !== 3) return { error: `color-mix(${inner}) is not understood` };
  const space = method[1].toLowerCase();
  if (space !== "srgb" && space !== "oklab" && space !== "oklch") return { error: `color-mix in ${space} is not supported (srgb, oklab and oklch are)` };
  if (method[2] !== void 0 && method[2].toLowerCase() !== "shorter") return { error: "color-mix hue interpolation other than shorter is not supported" };
  const entries = [];
  for (const part of parts.slice(1)) {
    let percent = null;
    let text = part;
    const lead = /^(\d+\.?\d*|\.\d+)%\s+(.+)$/.exec(part);
    const tail = /^(.+?)\s+(\d+\.?\d*|\.\d+)%$/.exec(part);
    if (lead) {
      percent = Number(lead[1]);
      text = lead[2];
    } else if (tail) {
      percent = Number(tail[2]);
      text = tail[1];
    }
    const color = parseColor(text);
    if (isError(color)) return color;
    entries.push({ color, percent });
  }
  const [first, second] = entries;
  let p1 = first.percent;
  let p2 = second.percent;
  if (p1 === null && p2 === null) {
    p1 = 50;
    p2 = 50;
  } else if (p1 === null) p1 = 100 - p2;
  else if (p2 === null) p2 = 100 - p1;
  const sum = p1 + p2;
  if (sum <= 0) return { error: "color-mix percentages add up to 0" };
  const w1 = p1 / sum;
  const w2 = p2 / sum;
  const multiplier = sum < 100 ? sum / 100 : 1;
  const alpha = first.color.alpha * w1 + second.color.alpha * w2;
  if (alpha === 0) return { space: "srgb", c: [0, 0, 0], alpha: 0 };
  const mixed = mixChannels(space, first.color, second.color, w1, w2, alpha);
  return { space: space === "srgb" ? "srgb" : "oklab", c: mixed, alpha: alpha * multiplier };
}
function mixChannels(space, c1, c2, w1, w2, alpha) {
  const a1 = c1.alpha;
  const a2 = c2.alpha;
  const mixPremultiplied = (x2, y2) => (x2 * a1 * w1 + y2 * a2 * w2) / alpha;
  if (space === "srgb") {
    const x2 = toSrgb(c1);
    const y2 = toSrgb(c2);
    return [mixPremultiplied(x2[0], y2[0]), mixPremultiplied(x2[1], y2[1]), mixPremultiplied(x2[2], y2[2])];
  }
  const x = toOklab(c1);
  const y = toOklab(c2);
  if (space === "oklab") return [mixPremultiplied(x[0], y[0]), mixPremultiplied(x[1], y[1]), mixPremultiplied(x[2], y[2])];
  const polar = (v) => ({ L: v[0], C: Math.hypot(v[1], v[2]), h: Math.atan2(v[2], v[1]) * 180 / Math.PI });
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
  const delta = ((h2 - h1) % 360 + 540) % 360 - 180;
  const hue = (h1 + delta * w2) * Math.PI / 180;
  const L = mixPremultiplied(p.L, q.L);
  const C = mixPremultiplied(p.C, q.C);
  return [L, C * Math.cos(hue), C * Math.sin(hue)];
}
function convertColor(text) {
  const parsed = parseColor(text);
  if (isError(parsed)) return parsed;
  return { color: toRgbString(parsed) };
}
function colorAlpha(color) {
  const match = /^rgba\(.*,\s*([\d.]+)\)$/.exec(color);
  return match ? Number(match[1]) : 1;
}

// src/css/table.ts
var TRANSFORM_KEYS = ["transform:translateX", "transform:translateY", "transform:rotate", "transform:rotateX", "transform:rotateY", "transform:scaleX", "transform:scaleY"];

// src/css/values.ts
function closingParen(text, open) {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (c === "\\") i++;
    else if (c === '"' || c === "'") {
      i++;
      while (i < text.length && text[i] !== c) i += text[i] === "\\" ? 2 : 1;
    } else if (c === "(") depth++;
    else if (c === ")" && --depth === 0) return i;
  }
  return -1;
}
function nextVar(text, from) {
  for (let i = from; i < text.length; i++) {
    const c = text[i];
    if (c === '"' || c === "'") {
      i++;
      while (i < text.length && text[i] !== c) i += text[i] === "\\" ? 2 : 1;
    } else if (c === "v" && text.startsWith("var(", i) && !/[\w-]/.test(text[i - 1] ?? " ")) return i;
  }
  return -1;
}
function substituteVars(text, lookup, depth = 0) {
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
    const fallback = comma < 0 ? void 0 : inner.slice(comma + 1).trim();
    const found = lookup(name);
    const source = found !== void 0 ? found.value : fallback;
    if (source === void 0) return { error: `${name} is not defined` };
    const resolved = substituteVars(source, lookup, depth + 1);
    if ("error" in resolved) return resolved;
    out += resolved.text;
    i = close + 1;
  }
  return { text: out };
}
function soleVar(text) {
  const match = /^var\(\s*(--[^\s,()]+)\s*\)$/.exec(text.trim());
  return match ? match[1] : null;
}
var INSETS = ["top", "right", "bottom", "left"];
var ABSOLUTE_PX = { px: 1, pt: 96 / 72, pc: 16, in: 96, cm: 96 / 2.54, mm: 96 / 25.4, q: 96 / 101.6 };
var WINDOW_WIDTH_UNITS = /* @__PURE__ */ new Set(["vw", "svw", "lvw", "dvw"]);
var WINDOW_HEIGHT_UNITS = /* @__PURE__ */ new Set(["vh", "svh", "lvh", "dvh"]);
function clean(x) {
  const rounded = Math.round(x * 1e6) / 1e6;
  return Math.abs(rounded - x) < 1e-9 ? rounded : x;
}
var isNumber = (q) => Object.keys(q).every((k) => k === "");
var merge = (a, b, sign) => {
  const hasPlain = (q) => "" in q;
  if (hasPlain(a) !== hasPlain(b)) return null;
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = (out[k] ?? 0) + sign * v;
  return out;
};
var scale = (q, factor) => Object.fromEntries(Object.entries(q).map(([k, v]) => [k, v * factor]));
var Evaluator = class _Evaluator {
  pos = 0;
  // Fields, not parameter properties: Node strips the types of a file it loads itself (the transformer from the sources) and does not do those.
  text;
  remPx;
  constructor(text, remPx) {
    this.text = text;
    this.remPx = remPx;
  }
  run() {
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
  blank() {
    while (this.pos < this.text.length && /\s/.test(this.text[this.pos])) this.pos++;
  }
  sum() {
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
  product() {
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
        const divisor = right[""] ?? 1;
        left = Object.fromEntries(Object.entries(left).map(([k, v]) => [k, v / divisor]));
      }
    }
  }
  unary() {
    this.blank();
    const sign = this.text[this.pos];
    if ((sign === "+" || sign === "-") && !/[\d.]/.test(this.text[this.pos + 1] ?? "")) {
      this.pos++;
      const value = this.unary();
      return sign === "-" ? scale(value, -1) : value;
    }
    return this.primary();
  }
  primary() {
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
  dimension(n, unit) {
    if (unit === "%") return { "%": n };
    if (unit === "rem") return { px: n * this.remPx };
    if (unit === "em") return { em: n };
    const absolute = Object.hasOwn(ABSOLUTE_PX, unit) ? ABSOLUTE_PX[unit] : void 0;
    if (absolute !== void 0) return { px: n * absolute };
    if (WINDOW_WIDTH_UNITS.has(unit)) return { vw: n };
    if (WINDOW_HEIGHT_UNITS.has(unit)) return { vh: n };
    if (unit === "deg") return { deg: n };
    if (unit === "grad") return { deg: n * 0.9 };
    if (unit === "rad") return { deg: n * 180 / Math.PI };
    if (unit === "turn") return { deg: n * 360 };
    throw new Error(`the unit ${unit} is not supported`);
  }
  sub(text) {
    const result = new _Evaluator(text, this.remPx).run();
    if ("error" in result) throw new Error(result.error);
    return result.q;
  }
  call(name, inner) {
    if (name === "calc") return this.sub(inner);
    if (name === "env") {
      const [first] = splitTop(inner, ",");
      const match = /^safe-area-inset-(top|right|bottom|left)$/.exec((first ?? "").trim());
      if (!match) throw new Error(`env(${first ?? ""}) is not supported (only the safe-area insets are)`);
      return { [match[1]]: 1 };
    }
    if (name === "min" || name === "max" || name === "clamp") {
      const args = splitTop(inner, ",").map((arg) => this.sub(arg));
      const unit = singleUnit(args);
      if (unit === null || INSETS.some((side) => side === unit) || unit === "vw" || unit === "vh") {
        throw new Error(`${name}() over different units, or over the device's insets or window, cannot be resolved at build time`);
      }
      const values = args.map((arg) => arg[unit] ?? 0);
      let result;
      if (name === "min") result = Math.min(...values);
      else if (name === "max") result = Math.max(...values);
      else {
        if (values.length !== 3) throw new Error("clamp() takes three arguments");
        result = Math.max(values[0], Math.min(values[1], values[2]));
      }
      return { [unit]: result };
    }
    throw new Error(`${name}() is not supported`);
  }
};
function singleUnit(args) {
  let unit = null;
  for (const arg of args) {
    const keys = Object.keys(arg);
    if (keys.length !== 1) return null;
    if (unit !== null && unit !== keys[0]) return null;
    unit = keys[0];
  }
  return unit;
}
function evaluate(text, remPx) {
  return new Evaluator(text.trim(), remPx).run();
}
function toLength(q, options) {
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
  const unit = others[0];
  const amount = q[unit];
  if (unit === "%") {
    if (px !== 0) return { error: "mixes a percentage and a length, which needs the parent's size" };
    return options.percent ? { value: `${Number(amount.toFixed(6))}%` } : { error: "a percentage is not supported here" };
  }
  const add = px !== 0 ? { add: clean(px) } : {};
  if (unit === "vw" || unit === "vh") return { dynamic: { window: unit === "vw" ? "width" : "height", scale: clean(amount / 100), ...add } };
  const inset = unit;
  return { dynamic: { inset, ...amount !== 1 ? { scale: clean(amount) } : {}, ...add } };
}
function toNumber(q, options = {}) {
  const dims = Object.keys(q).filter((k) => q[k] !== 0);
  let value;
  if (dims.length === 0) value = 0;
  else if (dims.length === 1 && dims[0] === "") value = q[""];
  else if (dims.length === 1 && dims[0] === "%" && options.percent) value = q["%"] / 100;
  else return { error: "not a number" };
  return Number.isFinite(value) ? { value: clean(value) } : { error: "an infinite number" };
}
function toAngle(q) {
  const dims = Object.keys(q).filter((k) => q[k] !== 0);
  if (dims.length === 0) return { value: "0deg" };
  if (dims.length === 1 && dims[0] === "deg") return { value: `${clean(q.deg)}deg` };
  return { error: "not an angle" };
}

// src/css/properties.ts
var emptyResult = () => ({ style: {}, dynamic: {}, fontRelative: {} });
function own(table2, key) {
  return Object.hasOwn(table2, key) ? table2[key] : void 0;
}
var Declaration = class {
  // Fields, not parameter properties: Node strips the types of a file it loads itself (the transformer from the sources, `lower-html.ts` through `inline.ts`) and does not do those.
  property;
  env;
  out;
  report;
  constructor(property, env, out, report) {
    this.property = property;
    this.env = env;
    this.out = out;
    this.report = report;
  }
  fail(reason) {
    this.report(this.property, reason);
  }
  // A later declaration of the same key replaces an earlier one, whichever of the three places the earlier one put it in.
  set(key, value) {
    delete this.out.dynamic[key];
    if (key === "lineHeight" || key === "letterSpacing") delete this.out.fontRelative[key];
    this.out.style[key] = value;
  }
  setDynamic(key, value) {
    delete this.out.style[key];
    this.out.dynamic[key] = value;
  }
  setRelative(key, value) {
    delete this.out.style[key];
    this.out.fontRelative[key] = value;
  }
  /** Writes a length to `key`: dp, a percentage string, a keyword (`null` for one that resets the key), or a dynamic value. Returns false (after reporting) when it is none of them. */
  length(key, text, options = {}) {
    const keyword = options.keywords === void 0 ? void 0 : own(options.keywords, text.trim().toLowerCase());
    if (keyword !== void 0) {
      this.set(key, keyword);
      return true;
    }
    if (/^[a-z][a-z-]*$/i.test(text.trim()) && !/^(infinity|pi|e)$/i.test(text.trim())) return this.bad(`${text} has no React Native equivalent`);
    const evaluated = evaluate(text, this.env.remPx);
    if ("error" in evaluated) return this.bad(evaluated.error);
    const length = toLength(evaluated.q, { percent: options.percent === true });
    if ("error" in length) return this.bad(`${text}: ${length.error}`);
    if ("dynamic" in length) this.setDynamic(key, length.dynamic);
    else this.set(key, length.value);
    return true;
  }
  number(key, text, options = {}) {
    const evaluated = evaluate(text, this.env.remPx);
    if ("error" in evaluated) return this.bad(evaluated.error);
    const number = toNumber(evaluated.q, options);
    if ("error" in number) return this.bad(`${text} is not a number`);
    this.set(key, number.value);
    return true;
  }
  color(keys, text) {
    const color = convertColor(text);
    if ("error" in color) return this.bad(color.error);
    for (const key of keys) this.set(key, color.color);
    return true;
  }
  keyword(key, text, map) {
    const value = own(map, text.trim().toLowerCase());
    if (value === void 0) return this.bad(`${text} has no React Native equivalent`);
    this.set(key, value);
    return true;
  }
  quantity(text) {
    const evaluated = evaluate(text, this.env.remPx);
    if ("error" in evaluated) {
      this.bad(evaluated.error);
      return null;
    }
    return evaluated.q;
  }
  bad(reason) {
    this.fail(reason);
    return false;
  }
};
var same = (...words) => Object.fromEntries(words.map((word) => [word, word]));
function around(parts) {
  const [a, b, c, d] = parts;
  if (a === void 0 || parts.length > 4) return null;
  if (b === void 0) return [a, a, a, a];
  if (c === void 0) return [a, b, a, b];
  if (d === void 0) return [a, b, c, b];
  return [a, b, c, d];
}
function pair(parts) {
  const [a, b] = parts;
  if (a === void 0 || parts.length > 2) return null;
  return [a, b ?? a];
}
function edges(keys, write) {
  return (d, text) => {
    const values = around(splitTop(text, " "));
    if (values === null) return d.fail(`${text} is not one to four values`);
    for (const [i, key] of keys.entries()) write(d, key, values[i]);
  };
}
function twoEdges(keys, write) {
  return (d, text) => {
    const values = pair(splitTop(text, " "));
    if (values === null) return d.fail(`${text} is not one or two values`);
    for (const [i, key] of keys.entries()) write(d, key, values[i]);
  };
}
function one(key, write) {
  return (d, text) => write(d, key, text);
}
var spacing = (d, key, text) => d.length(key, text, { percent: true });
var margin = (d, key, text) => d.length(key, text, { percent: true, keywords: { auto: "auto" } });
var sizing = (d, key, text) => d.length(key, text, { percent: true, keywords: { auto: "auto" } });
var maxSizing = (d, key, text) => d.length(key, text, { percent: true, keywords: { auto: "auto", none: null } });
var borderWidth = (d, key, text) => d.length(key, text, { keywords: { thin: 1, medium: 3, thick: 5 } });
var borderColor = (d, key, text) => void d.color([key], text);
var radius = (d, key, text) => {
  const q = d.quantity(text);
  if (q === null) return;
  const px = q.px ?? 0;
  if (Object.keys(q).length === 1 && "px" in q && px > 1e6) d.set(key, 9999);
  else d.length(key, text, { percent: true });
};
var SIDE_KEYS = (prefix, suffix = "") => [`${prefix}Top${suffix}`, `${prefix}Right${suffix}`, `${prefix}Bottom${suffix}`, `${prefix}Left${suffix}`];
function boxFamily(prefix, cssPrefix, suffix, cssSuffix, write, handlers2) {
  const [top, right, bottom, left] = SIDE_KEYS(prefix, suffix);
  const sides = [top, right, bottom, left];
  handlers2[`${cssPrefix}${cssSuffix}`] = edges(sides, write);
  for (const [name, key] of [["top", top], ["right", right], ["bottom", bottom], ["left", left]]) handlers2[`${cssPrefix}-${name}${cssSuffix}`] = one(key, write);
  handlers2[`${cssPrefix}-inline${cssSuffix}`] = twoEdges([left, right], write);
  handlers2[`${cssPrefix}-block${cssSuffix}`] = twoEdges([top, bottom], write);
  handlers2[`${cssPrefix}-inline-start${cssSuffix}`] = one(`${prefix}Start${suffix}`, write);
  handlers2[`${cssPrefix}-inline-end${cssSuffix}`] = one(`${prefix}End${suffix}`, write);
  handlers2[`${cssPrefix}-block-start${cssSuffix}`] = one(top, write);
  handlers2[`${cssPrefix}-block-end${cssSuffix}`] = one(bottom, write);
}
var handlers = {};
boxFamily("padding", "padding", "", "", spacing, handlers);
boxFamily("margin", "margin", "", "", margin, handlers);
boxFamily("border", "border", "Width", "-width", borderWidth, handlers);
boxFamily("border", "border", "Color", "-color", borderColor, handlers);
{
  const keys = ["top", "right", "bottom", "left"];
  handlers.inset = edges(keys, sizing);
  for (const key of keys) handlers[key] = one(key, sizing);
  handlers["inset-inline"] = twoEdges(["left", "right"], sizing);
  handlers["inset-block"] = twoEdges(["top", "bottom"], sizing);
  handlers["inset-inline-start"] = one("start", sizing);
  handlers["inset-inline-end"] = one("end", sizing);
  handlers["inset-block-start"] = one("top", sizing);
  handlers["inset-block-end"] = one("bottom", sizing);
}
for (const [property, key] of [["width", "width"], ["height", "height"], ["min-width", "minWidth"], ["min-height", "minHeight"]]) {
  handlers[property] = one(key, sizing);
}
handlers["max-width"] = one("maxWidth", maxSizing);
handlers["max-height"] = one("maxHeight", maxSizing);
handlers["border-radius"] = (d, text) => {
  if (text.includes("/")) return d.fail("elliptical radii (a / b) are not supported");
  const values = around(splitTop(text, " "));
  if (values === null) return d.fail(`${text} is not one to four values`);
  const keys = ["borderTopLeftRadius", "borderTopRightRadius", "borderBottomRightRadius", "borderBottomLeftRadius"];
  for (const [i, key] of keys.entries()) radius(d, key, values[i]);
};
for (const [property, key] of [
  ["border-top-left-radius", "borderTopLeftRadius"],
  ["border-top-right-radius", "borderTopRightRadius"],
  ["border-bottom-right-radius", "borderBottomRightRadius"],
  ["border-bottom-left-radius", "borderBottomLeftRadius"],
  ["border-start-start-radius", "borderStartStartRadius"],
  ["border-start-end-radius", "borderStartEndRadius"],
  ["border-end-start-radius", "borderEndStartRadius"],
  ["border-end-end-radius", "borderEndEndRadius"]
]) {
  handlers[property] = (d, text) => {
    if (splitTop(text, " ").length > 1) return d.fail("elliptical radii (two values) are not supported");
    radius(d, key, text);
  };
}
function noBorder(d) {
  d.set("borderStyle", null);
  for (const key of SIDE_KEYS("border", "Width")) d.set(key, 0);
}
handlers["border-style"] = (d, text) => {
  const values = splitTop(text, " ");
  if (values.some((value) => value !== values[0])) return d.fail("a different border style per side is not supported");
  if (values[0] === "none" || values[0] === "hidden") return noBorder(d);
  d.keyword("borderStyle", values[0] ?? "", same("solid", "dashed", "dotted"));
};
for (const side of ["top", "right", "bottom", "left", "inline", "block", "inline-start", "inline-end", "block-start", "block-end"]) {
  handlers[`border-${side}-style`] = (d) => d.fail("a border style per side is not supported (React Native has one borderStyle)");
}
function borderShorthand(widthKeys, colorKeys) {
  return (d, text) => {
    for (const part of splitTop(text, " ")) {
      const word = part.toLowerCase();
      if (word === "solid" || word === "dashed" || word === "dotted") d.set("borderStyle", word);
      else if (word === "none" || word === "hidden") {
        d.set("borderStyle", null);
        for (const key of widthKeys) d.set(key, 0);
      } else if (["double", "groove", "ridge", "inset", "outset"].includes(word)) d.fail(`border style ${word} is not supported`);
      else if (["thin", "medium", "thick"].includes(word) || "q" in evaluate(part, d.env.remPx)) for (const key of widthKeys) borderWidth(d, key, part);
      else d.color([...colorKeys], part);
    }
  };
}
handlers.border = borderShorthand(SIDE_KEYS("border", "Width"), SIDE_KEYS("border", "Color"));
for (const side of ["Top", "Right", "Bottom", "Left"]) handlers[`border-${side.toLowerCase()}`] = borderShorthand([`border${side}Width`], [`border${side}Color`]);
handlers["border-inline"] = borderShorthand(["borderLeftWidth", "borderRightWidth"], ["borderLeftColor", "borderRightColor"]);
handlers["border-block"] = borderShorthand(["borderTopWidth", "borderBottomWidth"], ["borderTopColor", "borderBottomColor"]);
handlers["background-color"] = (d, text) => void d.color(["backgroundColor"], text);
handlers.color = (d, text) => void d.color(["color"], text);
handlers.background = (d, text) => {
  if (splitTop(text, " ").length > 1 || /^(url|linear-gradient|radial-gradient|conic-gradient)\(/i.test(text)) return d.fail("only a background color is supported");
  d.color(["backgroundColor"], text);
};
handlers.display = (d, text) => {
  if (d.keyword("display", text, { flex: "flex", "inline-flex": "flex", block: "flex", "inline-block": "flex", inline: "flex", "flow-root": "flex", none: "none", contents: "contents" })) d.set("htmlDisplay", text.trim().toLowerCase());
};
handlers.position = (d, text) => void d.keyword("position", text, same("absolute", "relative", "static"));
handlers.direction = (d, text) => void d.keyword("direction", text, same("ltr", "rtl"));
handlers["z-index"] = (d, text) => text.trim() === "auto" ? d.set("zIndex", null) : void d.number("zIndex", text);
handlers.overflow = (d, text) => {
  const values = splitTop(text, " ");
  if (values.length > 1 && values[0] !== values[1]) return d.fail("a different overflow per axis is not supported");
  d.keyword("overflow", values[0] ?? "", { visible: "visible", hidden: "hidden", clip: "hidden", scroll: "scroll", auto: "scroll" });
};
handlers.opacity = (d, text) => void d.number("opacity", text, { percent: true });
handlers["flex-direction"] = (d, text) => void d.keyword("flexDirection", text, same("row", "row-reverse", "column", "column-reverse"));
handlers["flex-wrap"] = (d, text) => void d.keyword("flexWrap", text, same("wrap", "nowrap", "wrap-reverse"));
handlers["flex-grow"] = (d, text) => void d.number("flexGrow", text);
handlers["flex-shrink"] = (d, text) => void d.number("flexShrink", text);
handlers["flex-basis"] = (d, text) => void d.length("flexBasis", text, { percent: true, keywords: { auto: "auto" } });
handlers.flex = (d, text) => {
  const word = text.trim().toLowerCase();
  const presets = { none: [0, 0, "auto"], auto: [1, 1, "auto"], initial: [0, 1, "auto"] };
  const preset = own(presets, word);
  if (preset !== void 0) {
    d.set("flexGrow", preset[0]);
    d.set("flexShrink", preset[1]);
    d.set("flexBasis", preset[2]);
    return;
  }
  const parts = splitTop(text, " ");
  const isFactor = (part) => /^[+-]?(\d+\.?\d*|\.\d+)$/.test(part) || /^calc\(\s*[\d.\s*/+-]+\)$/.test(part);
  const factors = [];
  while (parts.length > 0 && factors.length < 2 && isFactor(parts[0])) factors.push(parts.shift());
  if (parts.length > 1) return d.fail(`${text} is not a flex shorthand`);
  d.number("flexGrow", factors[0] ?? "1");
  d.number("flexShrink", factors[1] ?? "1");
  if (parts[0] === void 0) return d.set("flexBasis", 0);
  d.length("flexBasis", parts[0], { percent: true, keywords: { auto: "auto" } });
  if (d.out.style.flexBasis === "0%") d.set("flexBasis", 0);
};
handlers["align-items"] = (d, text) => void d.keyword("alignItems", text, { "flex-start": "flex-start", start: "flex-start", "flex-end": "flex-end", end: "flex-end", center: "center", stretch: "stretch", normal: "stretch", baseline: "baseline" });
handlers["align-self"] = (d, text) => void d.keyword("alignSelf", text, { auto: "auto", "flex-start": "flex-start", start: "flex-start", "flex-end": "flex-end", end: "flex-end", center: "center", stretch: "stretch", baseline: "baseline" });
handlers["align-content"] = (d, text) => {
  d.keyword("alignContent", text, { "flex-start": "flex-start", start: "flex-start", "flex-end": "flex-end", end: "flex-end", center: "center", stretch: "stretch", normal: "stretch", "space-between": "space-between", "space-around": "space-around", "space-evenly": "space-evenly" });
};
handlers["justify-content"] = (d, text) => {
  d.keyword("justifyContent", text, { "flex-start": "flex-start", start: "flex-start", normal: "flex-start", "flex-end": "flex-end", end: "flex-end", center: "center", "space-between": "space-between", "space-around": "space-around", "space-evenly": "space-evenly" });
};
handlers.gap = (d, text) => {
  const values = pair(splitTop(text, " "));
  if (values === null) return d.fail(`${text} is not one or two values`);
  d.length("rowGap", values[0]);
  d.length("columnGap", values[1]);
};
handlers["row-gap"] = (d, text) => void d.length("rowGap", text);
handlers["column-gap"] = (d, text) => void d.length("columnGap", text);
handlers["aspect-ratio"] = (d, text) => {
  if (text.trim() === "auto") return d.set("aspectRatio", null);
  const [a, b, extra] = text.split("/");
  if (extra !== void 0 || a?.trim() === "auto") return d.fail(`${text} has no React Native equivalent`);
  const ratio = (part) => {
    const q = d.quantity(part);
    const n = q === null ? null : toNumber(q);
    return n === null || "error" in n ? null : n.value;
  };
  const numerator = ratio(a ?? "");
  const denominator = b === void 0 ? 1 : ratio(b);
  if (numerator === null || denominator === null || denominator === 0) return d.fail(`${text} is not a ratio`);
  d.set("aspectRatio", numerator / denominator);
};
handlers["font-size"] = (d, text) => void d.length("fontSize", text);
handlers["font-weight"] = (d, text) => {
  const word = text.trim().toLowerCase();
  if (word === "normal") return d.set("fontWeight", "400");
  if (word === "bold") return d.set("fontWeight", "700");
  const q = d.quantity(text);
  const n = q === null ? null : toNumber(q);
  if (n === null || "error" in n) return d.fail(`font-weight ${text} is not a number`);
  d.set("fontWeight", String(n.value));
};
handlers["font-style"] = (d, text) => void d.keyword("fontStyle", text, { normal: "normal", italic: "italic", oblique: "italic" });
handlers["font-family"] = (d, text) => {
  const first = (splitTop(text, ",")[0] ?? "").replace(/^["']|["']$/g, "").trim();
  if (first === "") return d.fail("empty font-family");
  const alias = { "ui-monospace": "monospace", "ui-serif": "serif", "ui-sans-serif": "System", "ui-rounded": "System", "system-ui": "System", "-apple-system": "System", blinkmacsystemfont: "System" };
  d.set("fontFamily", own(alias, first.toLowerCase()) ?? first);
};
handlers["line-height"] = (d, text) => {
  if (text.trim().toLowerCase() === "normal") return d.set("lineHeight", null);
  const q = d.quantity(text);
  if (q === null) return;
  const dims = Object.keys(q).filter((k) => q[k] !== 0);
  if (dims.length === 1 && dims[0] === "") d.setRelative("lineHeight", clean(q[""]));
  else if (dims.length === 1 && dims[0] === "em") d.setRelative("lineHeight", clean(q.em));
  else if (dims.length === 1 && dims[0] === "%") d.setRelative("lineHeight", clean(q["%"] / 100));
  else d.length("lineHeight", text);
};
handlers["letter-spacing"] = (d, text) => {
  if (text.trim().toLowerCase() === "normal") return d.set("letterSpacing", 0);
  const q = d.quantity(text);
  if (q === null) return;
  const dims = Object.keys(q).filter((k) => q[k] !== 0);
  if (dims.length === 1 && dims[0] === "em") d.setRelative("letterSpacing", clean(q.em));
  else d.length("letterSpacing", text);
};
handlers["text-align"] = (d, text) => void d.keyword("textAlign", text, { left: "left", right: "right", center: "center", justify: "justify", start: "auto" });
handlers["text-transform"] = (d, text) => void d.keyword("textTransform", text, same("none", "uppercase", "lowercase", "capitalize"));
var decorationLine = (d, text) => {
  const words = splitTop(text.toLowerCase(), " ");
  if (words.some((word) => !["underline", "line-through", "none"].includes(word))) return d.fail(`${text} is not supported (underline, line-through and none are)`);
  d.set("textDecorationLine", words.join(" "));
};
handlers["text-decoration-line"] = decorationLine;
handlers["text-decoration"] = (d, text) => {
  if (splitTop(text, " ").length > 1) return d.fail("only the decoration line is supported in text-decoration");
  decorationLine(d, text);
};
function components(d, text) {
  const out = [];
  for (const part of splitTop(text, " ")) {
    const name = soleVar(part);
    if (name !== null && d.env.lookup(name)?.source === "default") {
      out.push(null);
      continue;
    }
    const resolved = substituteVars(part, d.env.lookup);
    if ("error" in resolved) {
      d.fail(resolved.error);
      return null;
    }
    out.push(resolved.text);
  }
  return out;
}
var rawHandlers = {
  translate(d, text) {
    if (text.trim() === "none") {
      d.set("transform:translateX", null);
      d.set("transform:translateY", null);
      return;
    }
    const resolved = components(d, text);
    if (resolved === null) return;
    const [x, y, z] = resolved;
    for (const [key, part] of [["transform:translateX", x], ["transform:translateY", y]]) {
      if (part === null || part === void 0) continue;
      const q = d.quantity(part);
      if (q === null) continue;
      if ((q["%"] ?? 0) !== 0) {
        d.fail("a percentage translation depends on the element's own size, which a style cannot express");
        continue;
      }
      const length = toLength(q, { percent: false });
      if ("error" in length) d.fail(`${part}: ${length.error}`);
      else if ("dynamic" in length) d.setDynamic(key, length.dynamic);
      else d.set(key, length.value);
    }
    if (z !== null && z !== void 0 && z !== "0" && z !== "0px") d.fail("translateZ has no React Native equivalent");
  },
  scale(d, text) {
    if (text.trim() === "none") {
      d.set("transform:scaleX", null);
      d.set("transform:scaleY", null);
      return;
    }
    const resolved = components(d, text);
    if (resolved === null) return;
    const [x, y] = resolved;
    const factor = (part) => {
      const q = d.quantity(part);
      const n = q === null ? null : toNumber(q, { percent: true });
      if (n === null || "error" in n) {
        d.fail(`${part} is not a scale factor`);
        return null;
      }
      return n.value;
    };
    if (x !== null && x !== void 0) {
      const value = factor(x);
      if (value !== null) {
        d.set("transform:scaleX", value);
        if (resolved.length === 1) d.set("transform:scaleY", value);
      }
    }
    if (y !== null && y !== void 0) {
      const value = factor(y);
      if (value !== null) d.set("transform:scaleY", value);
    }
  },
  rotate(d, text) {
    if (text.trim() === "none") {
      for (const key of ["transform:rotate", "transform:rotateX", "transform:rotateY"]) d.set(key, null);
      return;
    }
    const resolved = components(d, text);
    if (resolved === null) return;
    const words = resolved.filter((part) => part !== null).join(" ").split(/\s+/);
    const axis = /^[xyz]$/i.test(words[0] ?? "") ? words.shift().toLowerCase() : "z";
    const q = d.quantity(words.join(" "));
    if (q === null) return;
    const angle2 = toAngle(q);
    if ("error" in angle2) return d.fail(`${words.join(" ")} is not an angle`);
    d.set(axis === "x" ? "transform:rotateX" : axis === "y" ? "transform:rotateY" : "transform:rotate", angle2.value);
  }
};
handlers["box-shadow"] = (d, text) => {
  if (text.trim().toLowerCase() === "none") return d.set("boxShadow", null);
  const layers = [];
  for (const layer of splitTop(text, ",")) {
    if (layer === "") continue;
    const tokens = splitTop(layer, " ");
    let inset = false;
    let colorText;
    const lengths = [];
    for (const token of tokens) {
      if (token.toLowerCase() === "inset") {
        inset = true;
        continue;
      }
      const q = evaluate(token, d.env.remPx);
      if ("q" in q) {
        const length = toLength(q.q, { percent: false });
        if ("error" in length || "dynamic" in length) return d.fail(`box-shadow length ${token} cannot be resolved at build time`);
        lengths.push(length.value);
      } else colorText = token;
    }
    if (lengths.length < 2 || lengths.length > 4) return d.fail(`box-shadow layer ${layer} needs two to four lengths`);
    if (colorText === void 0) return d.fail("a box-shadow layer without a color takes the text color (currentColor), which is not supported");
    const color = convertColor(colorText);
    if ("error" in color) return d.fail(`box-shadow color: ${color.error}`);
    if (colorAlpha(color.color) === 0) continue;
    const [x, y, blur = 0, spread = 0] = lengths;
    layers.push(`${inset ? "inset " : ""}${x}px ${y}px ${blur}px ${spread}px ${color.color}`);
  }
  d.set("boxShadow", layers.length > 0 ? layers.join(", ") : null);
};
handlers.transform = (d, text) => {
  if (text.trim().toLowerCase() !== "none") return d.fail(`transform: ${text} is not supported (the translate, rotate and scale properties are)`);
  for (const key of TRANSFORM_KEYS) d.set(key, null);
};
var GLOBAL_KEYWORDS = /* @__PURE__ */ new Set(["inherit", "initial", "unset", "revert", "revert-layer"]);
function convertDeclaration(property, value, env, out, report) {
  const raw = own(rawHandlers, property);
  const handler = raw ?? own(handlers, property);
  const declaration = new Declaration(property, env, out, report);
  if (handler === void 0) {
    declaration.fail(`no React Native style for ${property}`);
    return;
  }
  if (raw !== void 0) {
    raw(declaration, value);
    return;
  }
  const sole = soleVar(value);
  if (sole !== null && env.lookup(sole)?.source === "default") return;
  const resolved = substituteVars(value, env.lookup);
  if ("error" in resolved) {
    declaration.fail(resolved.error);
    return;
  }
  const text = resolved.text.trim();
  if (GLOBAL_KEYWORDS.has(text.toLowerCase())) declaration.fail(`${text} has no meaning in a class table`);
  else if (text === "") declaration.fail("empty value");
  else handler(declaration, text);
}

// src/css/inline.ts
var TRANSFORM_PREFIX = "transform:";
function convertInlineStyle(text) {
  const out = emptyResult();
  const problems = [];
  const env = { remPx: 16, lookup: () => void 0 };
  for (const item of parseCss(text)) {
    if (item.kind !== "decl") {
      problems.push(`${item.kind === "rule" ? item.selector : `@${item.name}`} is not a declaration`);
      continue;
    }
    convertDeclaration(item.property, item.value, env, out, (property, reason) => problems.push(`${property}: ${reason}`));
  }
  for (const key in out.dynamic) problems.push(`${key}: a viewport or safe-area unit is only for classes (\`w-[50vw]\`); a style written at build time cannot know the device`);
  if (problems.length > 0) return { error: problems.join("; ") };
  const style = {};
  for (const key in out.style) {
    const value = out.style[key];
    if (value !== null && value !== void 0) style[key] = value;
  }
  const transform2 = [];
  for (const key of TRANSFORM_KEYS) {
    if (!(key in style)) continue;
    transform2.push({ [key.slice(TRANSFORM_PREFIX.length)]: style[key] });
    delete style[key];
  }
  if (transform2.length > 0) style.transform = [...transform2, ...Array.isArray(style.transform) ? style.transform : []];
  if (Object.keys(out.fontRelative).length > 0) style.fontRelative = out.fontRelative;
  return { style };
}

// src/html-tags.ts
var ELEMENTS = {};
for (const name of "div section header footer main nav article aside ul ol li form label figure fieldset dl dd".split(" ")) ELEMENTS[name] = "view";
for (const name of "p span h1 h2 h3 h4 h5 h6 strong b em i small code blockquote figcaption dt mark kbd time abbr s u del ins q cite sub sup var samp dfn data".split(" ")) ELEMENTS[name] = "text";
Object.assign(ELEMENTS, { button: "button", a: "link", img: "image", input: "input", textarea: "textarea", dialog: "dialog", pre: "pre", br: "br", hr: "rule" });
var INLINE = new Set("span strong b em i small code a br mark kbd time abbr s u del ins q cite sub sup var samp dfn data".split(" "));
var HOST_TAGS = {
  view: "native-view",
  rule: "native-view",
  text: "native-text",
  pre: "native-text",
  button: "native-pressable",
  link: "native-pressable",
  image: "native-image"
};
function hostTagOf(name) {
  const kind = Object.hasOwn(ELEMENTS, name) ? ELEMENTS[name] : void 0;
  return kind === void 0 ? void 0 : HOST_TAGS[kind];
}
var USER_AGENT_STYLES = new Set("b strong em i cite dfn var u ins s del code kbd samp pre small sub sup mark h1 h2 h3 h4 h5 h6".split(" "));

// src/lower-html.ts
var PACKAGE = "expo-svelte";
var CORE = `${PACKAGE}/core`;
var ROUTER = `${PACKAGE}/router`;
var SOURCE_HELPER = "__expoSvelteSource";
var INPUT_EVENT_HELPER = "__expoSvelteInputEvent";
var WEB_SPREAD_HELPER = "__expoSvelteWebSpread";
var WEB_CLICK_SPREAD_HELPER = "__expoSvelteWebClickSpread";
var HTML_CLASS_HELPER = "__expoSvelteHtmlClass";
var CLICK_HELPER = "__expoSvelteClick";
var SUBMIT_HELPER = "__expoSvelteSubmit";
var HREF_HELPER = "__expoSvelteHref";
var STYLE_HELPER = "__expoSvelteStyleProps";
var BIND_HELPER = "__expoSvelteBind";
var TAG_HELPER = "__expoSvelteTag";
var INLINE_HELPER = "__expoSvelteInline";
var VALUE_HELPER = "__expoSvelteValue";
var HTML_HELPER_EXPORTS = {
  [SOURCE_HELPER]: "hostSource",
  [INPUT_EVENT_HELPER]: "hostInputEvent",
  [WEB_SPREAD_HELPER]: "hostWebSpread",
  [WEB_CLICK_SPREAD_HELPER]: "hostWebClickSpread",
  [HTML_CLASS_HELPER]: "hostHtmlClass",
  [CLICK_HELPER]: "hostClick",
  [SUBMIT_HELPER]: "hostSubmit",
  [HREF_HELPER]: "hostHref",
  [STYLE_HELPER]: "hostStyleProps",
  [BIND_HELPER]: "hostBind",
  [TAG_HELPER]: "hostTag",
  [INLINE_HELPER]: "hostInline"
};
var LINK = "__expoSvelteLink";
var COMPONENTS = { TextInput: "ExpoSvelteTextInput", Switch: "ExpoSvelteSwitch", Modal: "ExpoSvelteModal" };
var table = "tables have no native equivalent: lay the rows out with flex `div`s (`flex flex-row`)";
var select = "there is no native select: show the choices as a list of `button`s, in a `Modal` if they should cover the screen";
var web = "use `WebView` from `expo-svelte/foreign`";
var textLike = "use a `span` (or `p`)";
var blockLike = "use a `div`";
var HINTS = {
  table,
  thead: table,
  tbody: table,
  tfoot: table,
  tr: table,
  td: table,
  th: table,
  caption: table,
  colgroup: table,
  col: table,
  canvas: "there is no canvas: draw with the SVG components of `expo-svelte` (react-native-svg)",
  svg: "SVG is react-native-svg here: import `Svg`, `Path`, ... from `expo-svelte`",
  video: "use `Video` (react-native-video) or `VideoView` (expo-video) from `expo-svelte/foreign`",
  audio: "there is no audio element: play sound with a native module such as expo-audio",
  iframe: web,
  embed: web,
  object: web,
  select,
  option: select,
  optgroup: select,
  datalist: select,
  progress: "use `ActivityIndicator`, or a `div` whose width follows the value",
  meter: "use a `div` whose width follows the value",
  picture: "use an `img`",
  source: "use `img`, or `Video` from `expo-svelte/foreign`",
  details: blockLike,
  summary: blockLike,
  menu: "use a `ul`",
  legend: textLike,
  address: blockLike,
  hgroup: blockLike,
  search: blockLike,
  bdi: textLike,
  bdo: textLike,
  rp: textLike,
  rt: textLike,
  ruby: textLike,
  wbr: textLike,
  output: textLike,
  map: "image maps have no native equivalent",
  area: "image maps have no native equivalent",
  track: "use `Video` from `expo-svelte/foreign`",
  template: "there is no template element: use a snippet (`{#snippet}`)",
  noscript: "there is no noscript on a device",
  link: "there is nothing to link on a device",
  meta: "there is nothing to describe on a device",
  base: "there is no base URL on a device",
  param: "use `WebView` from `expo-svelte/foreign`"
};
var DEFAULT_HINT = "use a `div` (View) or a `span` (Text), or a component of `expo-svelte`";
var HTML_NAMES = /* @__PURE__ */ new Set([...Object.keys(ELEMENTS), ...Object.keys(HINTS)]);
var OPENING = /<(?!native-|script[\s>]|style[\s>])[a-z][a-z0-9]*(?:-[a-z0-9]+)*(?=[\s/>])|<svelte:(?:head|window|document|body|element)(?=[\s/>])/;
function mayHaveHtml(content) {
  return OPENING.test(content);
}
var UNSUPPORTED_TYPES = {
  radio: "there is no native radio: use a `button` per choice and keep the chosen one in state",
  submit: "use a `button`",
  reset: "use a `button`",
  button: "use a `button`",
  image: "use a `button` around an `img`",
  file: "there is no file input: pick files with a native module such as expo-document-picker",
  range: "there is no slider here: build one with gestures (`Gesture` from `expo-svelte`)",
  color: "there is no color picker",
  hidden: "keep the value in a variable",
  date: "use `DateTimePicker` from `expo-svelte/foreign`",
  time: "use `DateTimePicker` from `expo-svelte/foreign`",
  "datetime-local": "use `DateTimePicker` from `expo-svelte/foreign`",
  month: "use `DateTimePicker` from `expo-svelte/foreign`",
  week: "use `DateTimePicker` from `expo-svelte/foreign`"
};
var TRANSITION_EVENTS = ["introstart", "introend", "outrostart", "outroend"];
var INPUT_EVENTS = ["input", "change", "focus", "blur", "keydown", "keyup"];
var lines = (text) => text.split("\n").length - 1;
var WHITESPACE = /^[ \t\n\r\f]*$/;
var NUMBER = /^\d+(?:\.\d+)?(?:px)?$/;
function unflattenable(text) {
  for (let at = 0; at < text.length; at++) {
    const char = text[at];
    if (char === '"' || char === "'") {
      for (at++; at < text.length && text[at] !== char; at++) if (text[at] === "\\") at++;
    } else if (char === "`") {
      const from = at;
      for (at++; at < text.length && text[at] !== "`"; at++) if (text[at] === "\\") at++;
      if (text.slice(from, at).includes("\n")) return true;
    } else if (char === "/" && text[at + 1] === "/") return true;
    else if (char === "/" && text[at + 1] === "*") {
      const end = text.indexOf("*/", at + 2);
      at = end < 0 ? text.length : end + 1;
    }
  }
  return false;
}
function isFunctionLiteral(expression) {
  return expression.type === "ArrowFunctionExpression" || expression.type === "FunctionExpression";
}
function oneLine(text) {
  return unflattenable(text) ? text : text.replace(/[ \t]*\r?\n[ \t]*/g, " ");
}
var READ_ONLY = /* @__PURE__ */ new Set(["Identifier", "Literal", "ObjectExpression", "ArrayExpression", "Property", "SpreadElement", "MemberExpression", "ChainExpression", "ConditionalExpression", "LogicalExpression", "BinaryExpression", "TemplateLiteral", "TemplateElement"]);
function repeatableSource(content, expression) {
  const reads = (node) => {
    if (!READ_ONLY.has(node.type) || node.type === "TemplateElement" && node.value.raw.includes("\n")) return false;
    for (const key in node) {
      if (key === "metadata" || key === "type" || key === "start" || key === "end" || key === "loc") continue;
      const value = node[key];
      if (value && typeof value === "object" && !(Array.isArray(value) ? value.every((item) => item === null || typeof item !== "object" || reads(item)) : typeof value.type !== "string" || reads(value))) return false;
    }
    return true;
  };
  const source = content.slice(expression.start, expression.end);
  if (!reads(expression)) return void 0;
  const flat = oneLine(source);
  return flat.includes("\n") ? void 0 : flat;
}
function bindThisText(content, attribute, spreads) {
  const expression = attribute.expression;
  if (expression.type === "SequenceExpression") return void 0;
  const keys = [];
  const collect = (node) => {
    if (node.type !== "MemberExpression") return;
    collect(node.object);
    if (node.computed && node.property.type !== "Literal") keys.push(node.property);
  };
  collect(expression);
  let target = content.slice(expression.start, expression.end);
  for (let index = keys.length - 1; index >= 0; index--) {
    const key = keys[index];
    target = `${target.slice(0, key.start - expression.start)}__k[${index}]${target.slice(key.end - expression.start)}`;
  }
  target = oneLine(target);
  const call = `${BIND_HELPER}((__k, __v) => (${target} = __v), (__k) => ${target}, [${keys.map((key) => content.slice(key.start, key.end)).join(", ")}])`;
  return `ref={${spreads ? `${VALUE_HELPER}(${call})` : call}}`;
}
function lowerHtml(ast, content, filename, warn = () => {
}) {
  const out = { elements: /* @__PURE__ */ new Map(), edits: [], helpers: /* @__PURE__ */ new Set(), imports: [], setup: [] };
  const problems = [];
  const components2 = /* @__PURE__ */ new Set();
  let link = false;
  const slice = (node) => content.slice(node.start, node.end);
  const where = (node) => {
    const before2 = content.slice(0, node.start);
    return `${filename ?? "component"}:${lines(before2) + 1}:${node.start - before2.lastIndexOf("\n")}`;
  };
  const fail = (node, message) => {
    problems.push(`${where(node)} ${message}`);
  };
  const replace = (start, end, text) => {
    const lost = lines(content.slice(start, end)) - lines(text);
    out.edits.push({ start, end, text: lost > 0 ? text + "\n".repeat(lost) : text });
  };
  const edited = /* @__PURE__ */ new Set();
  const replaceNode = (node, text) => {
    edited.add(node);
    replace(node.start, node.end, text);
  };
  const moveOut = (node, written) => {
    edited.add(node);
    out.edits.push({ start: node.start, end: node.end, text: "" });
    const lost = lines(slice(node)) - lines(written);
    return lost > 0 ? written + "\n".repeat(lost) : written;
  };
  const rename = (attribute, to) => {
    edited.add(attribute);
    if (content[attribute.start] === "{") out.edits.push({ start: attribute.start, end: attribute.start, text: `${to}=` });
    else out.edits.push({ start: attribute.start, end: attribute.start + attribute.name.length, text: to });
  };
  const helper = (name) => {
    out.helpers.add(name);
    return name;
  };
  const attributeNamed = (node, name) => node.attributes.find((attribute) => attribute.type === "Attribute" && attribute.name === name);
  const directive = (node, type, name) => node.attributes.find((attribute) => attribute.type === type && attribute.name === name);
  const expressionSource = (expression) => content.slice(expression.start, expression.end);
  const staticText = (attribute) => {
    const value = attribute.value;
    if (value === true) return void 0;
    if (Array.isArray(value)) return value.every((part) => part.type === "Text") ? value.map((part) => part.data).join("") : void 0;
    return value.type === "ExpressionTag" && value.expression.type === "Literal" && typeof value.expression.value === "string" ? value.expression.value : void 0;
  };
  const valueSource = (attribute) => {
    const value = attribute.value;
    if (value === true) return "true";
    if (!Array.isArray(value)) return expressionSource(value.expression);
    const parts = value;
    if (parts.length === 1 && parts[0].type === "ExpressionTag") return expressionSource(parts[0].expression);
    if (parts.every((part) => part.type === "Text")) return JSON.stringify(parts.map((part) => part.data).join(""));
    let template = "`";
    for (const part of parts) template += part.type === "Text" ? part.data.replace(/[`\\$]/g, (match) => `\\${match}`) : `\${(${expressionSource(part.expression)}) ?? ""}`;
    return `${template}\``;
  };
  const handlerSource = (attribute, web2) => {
    if (attribute.type === "Attribute" && attribute.name === `on${web2}` && attribute.value !== true && !Array.isArray(attribute.value)) return { source: expressionSource(attribute.value.expression), expression: attribute.value.expression };
    if (attribute.type === "OnDirective" && attribute.name === web2 && attribute.expression && attribute.modifiers.length === 0) return { source: expressionSource(attribute.expression), expression: attribute.expression };
    return void 0;
  };
  const handlerOf = (node, web2) => {
    const spread = node.attributes.some((attribute) => attribute.type === "SpreadAttribute");
    for (const attribute of node.attributes) {
      const found = handlerSource(attribute, web2);
      if (found !== void 0) return { attribute, ...found, spread };
    }
    return void 0;
  };
  const nativeHandler = (found, to) => {
    const name = to === "onPress" && !found.spread && !isFunctionLiteral(found.expression) ? "nativeOnPress" : to;
    if (found.attribute.type === "Attribute") rename(found.attribute, name);
    else replaceNode(found.attribute, `${name}={${found.source}}`);
  };
  const wrappedHandler = (found, to, parameter, call) => {
    replaceNode(found.attribute, `${to}={(${parameter}) => (${found.source})?.(${call})}`);
  };
  const numberAttribute = (attribute, name = attribute.name) => {
    const text = staticText(attribute);
    if (text === void 0 || !NUMBER.test(text.trim())) return false;
    replaceNode(attribute, `${name}={${Number.parseFloat(text)}}`);
    return true;
  };
  const unsupportedBinding = (node, attribute, hint) => {
    fail(attribute, `bind:${attribute.name} on <${node.name}> is not supported on native: ${hint}`);
  };
  const rejectDirectives = (node, allowed = () => false) => {
    for (const attribute of node.attributes) {
      if (attribute.type === "ClassDirective" && !allowed(attribute)) fail(attribute, `class:${attribute.name} on <${node.name}> is not supported on native here: give \`class\` an array or an object (\`class={[...]}\`)`);
      else if (attribute.type === "BindDirective" && attribute.name !== "this" && !allowed(attribute)) {
        const sizes = /^(?:client|offset)(?:Width|Height)$|^contentRect$|^contentBoxSize$|^borderBoxSize$|^devicePixelContentBoxSize$/;
        unsupportedBinding(node, attribute, sizes.test(attribute.name) ? "measure with `onLayout`" : "there is nothing to bind to on a native view");
      }
    }
  };
  const warnUnhandled = (node, handled) => {
    for (const attribute of node.attributes) {
      if (attribute.type === "OnDirective" && !edited.has(attribute)) {
        const modifiers = attribute.modifiers.map((modifier) => `|${modifier}`).join("");
        const source = handlerSource(attribute, attribute.name);
        if (source === void 0) {
          fail(attribute, `on:${attribute.name}${modifiers} on <${node.name}> is not supported on native: write the \`on${attribute.name}\` attribute with a function, and call \`event.preventDefault()\` in it for a modifier`);
          continue;
        }
        replaceNode(attribute, `on${attribute.name}={${source.source}}`);
      }
      const event = attribute.type === "Attribute" && attribute.value !== true && /^on[a-z]+$/.test(attribute.name) ? attribute.name.slice(2) : attribute.type === "OnDirective" ? attribute.name : void 0;
      if (event === void 0 || handled.includes(event)) continue;
      warn(`${where(attribute)} ${attribute.type === "Attribute" ? attribute.name : `on:${event}`} on <${node.name}> never runs on a device: a native element has no "${event}" event (the web still calls it)`);
    }
  };
  const lowerStyle = (node, property, handled, generated) => {
    const attribute = attributeNamed(node, "style");
    const directives = node.attributes.filter((other) => other.type === "StyleDirective");
    let own2;
    let rewrite = directives.length > 0;
    if (attribute && attribute.value !== true) {
      if (!Array.isArray(attribute.value)) own2 = expressionSource(attribute.value.expression);
      else {
        const text2 = staticText(attribute);
        if (text2 === void 0) {
          fail(attribute, `style="..." with {...} in it is not supported on native: write the style as an object (\`style={{ ... }}\`), give the element a class, or use \`style:property={value}\``);
          return;
        }
        const converted = convertInlineStyle(text2);
        if ("error" in converted) {
          fail(attribute, `style="${text2.trim()}" on <${node.name}> cannot be converted: ${converted.error}`);
          return;
        }
        if (Object.keys(converted.style).length > 0) own2 = JSON.stringify(converted.style);
        rewrite = true;
      }
    }
    if (!rewrite) return;
    const parts = own2 === void 0 ? [] : [own2];
    if (directives.length > 0) {
      const entries = [];
      for (const style of directives) {
        if (style.value === true && !/^[A-Za-z_$][\w$]*$/.test(style.name)) fail(style, `style:${style.name} needs a value: write style:${style.name}={...}`);
        entries.push(moveOut(style, `${JSON.stringify(style.name)}: ${style.value === true ? style.name : valueSource(style)}`));
        handled?.add(style);
      }
      parts.push(`${helper(STYLE_HELPER)}({ ${entries.join(", ")} })`);
    }
    const text = parts.length === 0 ? void 0 : parts.length === 1 ? parts[0] : `[${parts.join(", ")}]`;
    if (attribute) {
      handled?.add(attribute);
      replaceNode(attribute, text === void 0 ? "" : `${property}={${text}}`);
    } else if (text !== void 0) generated.push(`${property}={${text}}`);
  };
  const hasRole = (node) => node.attributes.some((attribute) => attribute.type === "Attribute" && (attribute.name === "role" || attribute.name === "accessibilityRole"));
  const press = (node, handled, generated, after) => {
    const click = handlerOf(node, "click");
    if (click) handled.add(click.attribute);
    if (after === void 0) {
      if (click) nativeHandler(click, "onPress");
      return click !== void 0;
    }
    const call = `onPress={(__event) => ${helper(CLICK_HELPER)}(__event, ${click ? click.source : "undefined"}, ${after})}`;
    if (click) replaceNode(click.attribute, call);
    else generated.push(call);
    return click !== void 0;
  };
  const host = (node, kind, context) => {
    const handled = /* @__PURE__ */ new Set();
    const inline = kind === "text" && INLINE.has(node.name) || kind === "link" && context === "text";
    const generated = kind === "image" ? [] : [inline ? 'nativeHtml="inline"' : "nativeHtml={true}"];
    if (USER_AGENT_STYLES.has(node.name)) generated.push(`nativeBase="${node.name}"`);
    const events = ["click", ...TRANSITION_EVENTS];
    const role = (name) => {
      if (!hasRole(node)) generated.push(`accessibilityRole="${name}"`);
    };
    let tag = "native-view";
    let inside = "view";
    let isVoid = false;
    let spreadHelper = WEB_SPREAD_HELPER;
    if (kind === "text" || kind === "pre") {
      tag = "native-text";
      inside = "text";
      if (/^h[1-6]$/.test(node.name)) role("header");
      press(node, handled, generated);
    } else if (kind === "link") {
      const inText = context === "text";
      tag = inText ? "native-text" : "native-pressable";
      inside = inText ? "text" : "view";
      role("link");
      link = true;
      spreadHelper = WEB_CLICK_SPREAD_HELPER;
      press(node, handled, generated, `(__event) => ${LINK}(${helper(HREF_HELPER)}(__event))`);
    } else if (kind === "button") {
      tag = "native-pressable";
      role("button");
      generated.push("nativeButton={true}");
      spreadHelper = WEB_CLICK_SPREAD_HELPER;
      press(node, handled, generated, `(__event) => ${helper(SUBMIT_HELPER)}(__event)`);
    } else if (kind === "image") {
      tag = "native-image";
      isVoid = true;
      imageAttributes(node, handled);
      press(node, handled, generated);
      events.push("load", "error");
    } else if (kind === "rule") {
      isVoid = true;
      generated.push('nativeBase="hairline"');
    } else {
      if (node.name === "form") {
        generated.push("nativeForm={true}");
        events.push("submit");
      }
      if (press(node, handled, generated)) tag = "native-pressable";
    }
    lowerStyle(node, "nativeStyle", handled, generated);
    rejectDirectives(node, (attribute) => attribute.type === "ClassDirective");
    warnUnhandled(node, events);
    out.elements.set(node, { tag, handled, attributes: generated.map((attribute) => ` ${attribute}`).join(""), isVoid, spreadHelper });
    return kind === "image" || kind === "rule" ? "unknown" : inside;
  };
  const imageAttributes = (node, handled) => {
    for (const attribute of node.attributes) {
      if (attribute.type !== "Attribute") continue;
      if (attribute.name === "src" && attribute.value !== true) {
        handled.add(attribute);
        const text = staticText(attribute);
        replaceNode(attribute, `source={${text === void 0 ? `${helper(SOURCE_HELPER)}(${valueSource(attribute)})` : `{ uri: ${JSON.stringify(text)} }`}}`);
      } else if ((attribute.name === "width" || attribute.name === "height") && numberAttribute(attribute)) handled.add(attribute);
      else if (attribute.name === "onload" || attribute.name === "onerror") {
        handled.add(attribute);
        rename(attribute, attribute.name === "onload" ? "onLoad" : "onError");
      }
    }
  };
  const asComponent = (node, component2, generated) => {
    components2.add(component2);
    for (const attribute of node.attributes) {
      if (attribute.type !== "UseDirective" && attribute.type !== "TransitionDirective" && attribute.type !== "AnimateDirective") continue;
      const kind = attribute.type === "UseDirective" ? "use:" : attribute.type === "AnimateDirective" ? "animate:" : attribute.intro && !attribute.outro ? "in:" : attribute.outro && !attribute.intro ? "out:" : "transition:";
      warn(`${where(attribute)} ${kind}${attribute.name} on <${node.name}> is left out on native: the control is a component, which takes no DOM directive, and a native element runs none`);
      replaceNode(attribute, "");
    }
    out.edits.push({ start: node.start + 1, end: node.start + 1 + node.name.length, text: COMPONENTS[component2] + generated.map((attribute) => ` ${attribute}`).join("") });
    if (slice(node).endsWith("/>")) return;
    if (node.name === "input") out.edits.push({ start: node.end - 1, end: node.end - 1, text: " /" });
    else {
      const close = content.lastIndexOf(`</${node.name}`, node.end - 1);
      if (close > node.start) out.edits.push({ start: close + 2, end: close + 2 + node.name.length, text: COMPONENTS[component2] });
    }
  };
  const thisAsRef = (attribute, spreads = false) => {
    const text = bindThisText(content, attribute, spreads);
    if (text === void 0) return;
    helper(BIND_HELPER);
    if (spreads) helper(VALUE_HELPER);
    replaceNode(attribute, text);
  };
  const textareaValue = (node, generated) => {
    const nodes = node.fragment.nodes;
    if (nodes.length === 0 || attributeNamed(node, "value") || directive(node, "BindDirective", "value")) return;
    if (!nodes.every((child) => child.type === "Text" || child.type === "ExpressionTag")) return;
    let template = "`";
    let lost = 0;
    for (const [index, child] of nodes.entries()) {
      if (child.type === "Text") {
        let data = child.data;
        if (index === 0 && data.startsWith("\n")) {
          data = data.slice(1);
          lost++;
        }
        template += data.replace(/[`\\]|\$\{/g, (match) => `\\${match}`);
      } else template += `\${(${expressionSource(child.expression)}) ?? ""}`;
    }
    const written = `value={${template}\`}${"\n".repeat(lost)}`;
    const range = { start: nodes[0].start, end: nodes[nodes.length - 1].end };
    generated.push(moveOut(range, written));
  };
  const lowerTextInput = (node, multiline) => {
    const generated = ["nativeHtml={true}"];
    const typeAttribute = multiline ? void 0 : attributeNamed(node, "type");
    if (typeAttribute && typeAttribute.value !== true) {
      const text = staticText(typeAttribute);
      if (text !== void 0) {
        const type = text.trim().toLowerCase();
        if (type === "checkbox") {
          lowerCheckbox(node, typeAttribute);
          return;
        }
        if (Object.hasOwn(UNSUPPORTED_TYPES, type)) {
          fail(node, `<input type="${text}"> is not supported on native: ${UNSUPPORTED_TYPES[type]}`);
          return;
        }
      }
    }
    if (multiline) {
      if (!attributeNamed(node, "multiline")) generated.push("multiline={true}");
      textareaValue(node, generated);
    }
    for (const attribute of node.attributes) {
      if (attribute.type === "OnDirective" && INPUT_EVENTS.includes(attribute.name)) {
        const found = handlerOf(node, attribute.name);
        if (found?.attribute === attribute) replaceNode(attribute, `on${attribute.name}={${found.source}}`);
      } else if (attribute.type === "BindDirective") {
        if (attribute.name === "this") thisAsRef(attribute);
        else if (attribute.name !== "value") unsupportedBinding(node, attribute, "bind:value is the one a text input has");
      }
    }
    lowerStyle(node, "style", void 0, generated);
    rejectDirectives(node, (attribute) => attribute.type === "BindDirective");
    warnUnhandled(node, INPUT_EVENTS);
    asComponent(node, "TextInput", generated);
  };
  const lowerCheckbox = (node, typeAttribute) => {
    replaceNode(typeAttribute, "");
    const element = [`type: "checkbox"`];
    for (const name of ["name", "id"]) {
      const text = attributeNamed(node, name);
      const value = text && staticText(text);
      if (value !== void 0 && value !== "") element.push(`${name}: ${JSON.stringify(value)}`);
    }
    const change = () => `${helper(INPUT_EVENT_HELPER)}("change", __value, { ${element.join(", ")} })`;
    for (const attribute of node.attributes) {
      if (attribute.type === "Attribute") {
        if (attribute.name === "checked") {
          if (attribute.value === true || staticText(attribute) !== void 0) replaceNode(attribute, "value={true}");
          else rename(attribute, "value");
        } else if (attribute.name === "value") replaceNode(attribute, "");
        else if (attribute.name === "onchange") {
          const found = handlerOf(node, "change");
          if (found?.attribute === attribute) wrappedHandler(found, "onValueChange", "__value", change());
        }
      } else if (attribute.type === "OnDirective" && attribute.name === "change") {
        const found = handlerOf(node, "change");
        if (found) wrappedHandler(found, "onValueChange", "__value", change());
      } else if (attribute.type === "BindDirective") {
        if (attribute.name === "checked") replaceNode(attribute, `bind:value={${expressionSource(attribute.expression)}}`);
        else if (attribute.name === "this") thisAsRef(attribute);
        else unsupportedBinding(node, attribute, attribute.name === "group" ? "keep the choice in state" : "`bind:checked` is the one a checkbox has");
      }
    }
    const generated = [];
    lowerStyle(node, "style", void 0, generated);
    rejectDirectives(node, (attribute) => attribute.type === "BindDirective");
    warnUnhandled(node, ["change"]);
    asComponent(node, "Switch", generated);
  };
  const lowerDialog = (node) => {
    const generated = ["nativeHtml={true}"];
    const open = attributeNamed(node, "open");
    const bound = directive(node, "BindDirective", "open");
    if (!open && !bound) generated.push("open={false}");
    const close = handlerOf(node, "close");
    if (close) nativeHandler(close, "onRequestClose");
    for (const attribute of node.attributes) if (attribute.type === "BindDirective" && attribute.name === "this") thisAsRef(attribute);
    lowerStyle(node, "style", void 0, generated);
    rejectDirectives(node, (attribute) => attribute === bound);
    warnUnhandled(node, ["close"]);
    asComponent(node, "Modal", generated);
  };
  const blank = (node) => node.type === "Comment" || node.type === "Text" && WHITESPACE.test(node.data);
  const inlineNode = (node) => node.type === "Text" || node.type === "ExpressionTag" || node.type === "Comment" || node.type === "RegularElement" && INLINE.has(node.name);
  const lineMembers = (nodes) => {
    const members = /* @__PURE__ */ new Set();
    let run = [];
    const finish = () => {
      let from = 0;
      let to = run.length;
      while (from < to && blank(run[from])) from++;
      while (to > from && blank(run[to - 1])) to--;
      const body = run.slice(from, to);
      run = [];
      if (!body.some((node) => node.type === "ExpressionTag" || node.type === "Text" && !WHITESPACE.test(node.data))) return;
      for (const node of body) members.add(node);
    };
    for (const node of nodes) {
      if (inlineNode(node)) run.push(node);
      else finish();
    }
    finish();
    return members;
  };
  const preformatted = (text, first) => {
    let data = text.data;
    let prefix = "";
    if (first && data.startsWith("\n")) {
      data = data.slice(1);
      prefix = "\n";
    }
    if (data === "") return;
    replace(text.start, text.end, `${prefix}{\`${data.replace(/[`\\]|\$\{/g, (match) => `\\${match}`)}\`}`);
  };
  const visitFragment = (fragment, context, pre) => {
    const nodes = fragment.nodes;
    const members = context === "view" ? lineMembers(nodes) : /* @__PURE__ */ new Set();
    for (const [index, node] of nodes.entries()) {
      if (pre && node.type === "Text") preformatted(node, pre === "start" && index === 0);
      else visitNode(node, members.has(node) ? "text" : context, pre === void 0 ? void 0 : "inside");
    }
  };
  const visitDynamic = (node) => {
    const tag = node.tag;
    let marker = " nativeHtml={true}";
    if (tag.type === "Literal" && typeof tag.value === "string") {
      const host2 = tag.value.startsWith("native-") ? tag.value : hostTagOf(tag.value);
      if (host2 === void 0) fail(tag, `<svelte:element this="${tag.value}"> has no native equivalent: ${Object.hasOwn(HINTS, tag.value) ? HINTS[tag.value] : DEFAULT_HINT}`);
      else if (host2 !== tag.value) out.edits.push({ start: tag.start, end: tag.end, text: host2 });
      if (INLINE.has(tag.value) && host2 === "native-text") marker = ' nativeHtml="inline"';
    } else {
      out.edits.push({ start: tag.start, end: tag.start, text: `${helper(TAG_HELPER)}(` }, { start: tag.end, end: tag.end, text: ")" });
      const again = repeatableSource(content, tag);
      if (again !== void 0) marker = ` nativeHtml={${helper(INLINE_HELPER)}(${again})}`;
    }
    out.edits.push({ start: node.start + 1 + "svelte:element".length, end: node.start + 1 + "svelte:element".length, text: marker });
    for (const attribute of node.attributes) {
      if (attribute.type === "BindDirective") {
        if (attribute.name === "this") thisAsRef(attribute, true);
        else unsupportedBinding(node, attribute, "there is nothing to bind to on a native view");
      } else if (attribute.type === "Attribute" && attribute.name === "onclick" && attribute.value !== true) {
        rename(attribute, "onPress");
      } else if (attribute.type === "OnDirective") {
        if (attribute.expression && attribute.modifiers.length === 0) replaceNode(attribute, `on${attribute.name === "click" ? "Press" : attribute.name}={${expressionSource(attribute.expression)}}`);
        else fail(attribute, `on:${attribute.name}${attribute.modifiers.map((modifier) => `|${modifier}`).join("")} on <svelte:element> is not supported on native: write the \`on${attribute.name}\` attribute, and call \`event.preventDefault()\` in it for a modifier`);
      } else if (attribute.type === "Attribute" && (attribute.name === "class" || attribute.name === "style" || /^on[a-z]+$/.test(attribute.name)) || attribute.type === "ClassDirective" || attribute.type === "StyleDirective") {
        warn(`${where(attribute)} ${attribute.type === "Attribute" ? attribute.name : `${attribute.type === "ClassDirective" ? "class" : "style"}:${attribute.name}`} on <svelte:element> is not adapted on native (a class, a style and the web's events are for the elements written out): write the element, or use \`native-*\` attributes`);
      }
    }
    visitFragment(node.fragment, "unknown");
  };
  const visitNode = (node, context, pre) => {
    if (node.type === "RegularElement") {
      visitElement(node, context, pre);
      return;
    }
    if (node.type === "SvelteHead") {
      replaceNode(node, "");
      return;
    }
    if (node.type === "SvelteWindow" || node.type === "SvelteDocument" || node.type === "SvelteBody") {
      const name = node.type === "SvelteWindow" ? "svelte:window" : node.type === "SvelteDocument" ? "svelte:document" : "svelte:body";
      fail(node, `<${name}> is not supported on native: there is no ${name.slice(7)} to listen to (read the window's size with \`windowSize\` or \`svelte/reactivity/window\`, and use the events of the elements)`);
      return;
    }
    if (node.type === "SvelteElement") {
      visitDynamic(node);
      return;
    }
    const inherit = node.type === "IfBlock" || node.type === "EachBlock" || node.type === "KeyBlock" || node.type === "AwaitBlock";
    for (const key in node) {
      const value = node[key];
      if (key !== "metadata" && value && typeof value === "object" && value.type === "Fragment") visitFragment(value, inherit ? context : "unknown", inherit ? pre : void 0);
    }
  };
  const visitElement = (node, context, pre) => {
    const name = node.name;
    if (name.startsWith("native-")) {
      visitFragment(node.fragment, "unknown");
      return;
    }
    if (!HTML_NAMES.has(name)) {
      fail(node, name.includes("-") ? `<${name}> is a custom element, which is not supported on native: write a component, or a host tag (\`native-view\`)` : `<${name}> is not supported on native: ${DEFAULT_HINT}`);
      return;
    }
    const kind = ELEMENTS[name];
    if (kind === void 0) fail(node, `<${name}> is not supported on native: ${Object.hasOwn(HINTS, name) ? HINTS[name] : DEFAULT_HINT}`);
    else if (kind === "input" || kind === "textarea") lowerTextInput(node, kind === "textarea");
    else if (kind === "dialog") {
      lowerDialog(node);
      visitFragment(node.fragment, "view");
    } else if (kind === "br") {
      if (context === "text") replaceNode(node, `{"\\n"}`);
      else fail(node, '<br> is not supported on native outside text: put a newline in the text instead (`{"\\n"}`), or use a margin');
    } else {
      const inside = host(node, kind, context);
      if (kind !== "image" && kind !== "rule") visitFragment(node.fragment, inside, kind === "pre" ? "start" : pre ? "inside" : void 0);
    }
  };
  visitFragment(ast.fragment, "unknown");
  if (problems.length) throw new Error(problems.length === 1 ? problems[0] : `${problems.length} HTML elements or attributes have no native equivalent:
${problems.map((problem) => `  ${problem}`).join("\n")}`);
  if (components2.size) out.imports.push(`import { ${[...components2].sort().map((component2) => `${component2} as ${COMPONENTS[component2]}`).join(", ")} } from "${CORE}";`);
  if (link) {
    out.imports.push(`import { useLink as __expoSvelteUseLink } from "${ROUTER}";`);
    out.setup.push(`const ${LINK} = __expoSvelteUseLink();`);
  }
  return out;
}

// src/lower.ts
var PACKAGE2 = "expo-svelte";
var RENDERER = `${PACKAGE2}/renderer`;
var SPREAD_HELPER = "__expoSvelteSpread";
var VALUE_HELPER2 = "__expoSvelteValue";
var CLASS_HELPER = "__expoSvelteClass";
var HELPER_EXPORTS = { [SPREAD_HELPER]: "hostSpread", [VALUE_HELPER2]: "hostValue", [CLASS_HELPER]: "hostClass", ...HTML_HELPER_EXPORTS };
var LOWERED_TAGS = {
  View: "native-view",
  Text: "native-text",
  ScrollView: "native-scroll",
  Image: "native-image",
  ActivityIndicator: "native-spinner",
  Pressable: "native-pressable"
};
var PRESS_HANDLERS = /* @__PURE__ */ new Set(["onPress", "onPressIn", "onPressOut", "onLongPress", "onPressChange"]);
function fromPackage(source) {
  return typeof source === "string" && (source === PACKAGE2 || source.startsWith(`${PACKAGE2}/`));
}
function collectImports(program, locals, actions) {
  for (const statement of program?.body ?? []) {
    if (statement.type !== "ImportDeclaration" || statement.importKind === "type" || !fromPackage(statement.source?.value)) continue;
    for (const specifier of statement.specifiers) {
      if (specifier.type !== "ImportSpecifier" || specifier.importKind === "type") continue;
      const imported = specifier.imported.name ?? specifier.imported.value;
      if (Object.hasOwn(LOWERED_TAGS, imported)) locals.set(specifier.local.name, imported);
      if (imported === "gesture" && statement.source?.value === PACKAGE2) actions.add(specifier.local.name);
    }
  }
}
function mustStayComponent(node, primitive) {
  for (const attribute of node.attributes) {
    if (attribute.type === "LetDirective") return true;
    if (attribute.type === "BindDirective" && attribute.name !== "this") return true;
    if (attribute.type === "Attribute" && attribute.name === "children") return true;
    if (primitive === "Pressable" && attribute.type === "Attribute" && attribute.name === "style") {
      const value = attribute.value;
      const isStatic = value === true || (Array.isArray(value) ? value.every((part) => part.type === "Text") : value.type === "ExpressionTag" && value.expression.type === "ObjectExpression");
      if (!isStatic) return true;
    }
  }
  return (node.fragment?.nodes ?? []).some((child) => child.type === "SnippetBlock");
}
function classExpression(content, attribute) {
  const value = attribute.value;
  if (value === true) return "true";
  if (!Array.isArray(value)) return content.slice(value.expression.start, value.expression.end);
  let template = "`";
  for (const part of value) {
    template += part.type === "Text" ? part.data.replace(/[`\\]/g, (match) => `\\${match}`) : `\${(${content.slice(part.expression.start, part.expression.end)}) ?? ""}`;
  }
  return `${template}\``;
}
function couldBeFunction(expression) {
  switch (expression.type) {
    case "Literal":
    case "TemplateLiteral":
    case "ObjectExpression":
    case "ArrayExpression":
    case "BinaryExpression":
    case "UnaryExpression":
    case "UpdateExpression":
      return false;
    default:
      return true;
  }
}
function walk(value, visit) {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) walk(item, visit);
    return;
  }
  const node = value;
  if (typeof node.type === "string") visit(node);
  for (const key in node) if (key !== "metadata") walk(node[key], visit);
}
function lowerWithMap(content, options = {}) {
  const unchanged = () => ({ code: content, original: (line, column) => ({ line, column }) });
  if (!content.includes(PACKAGE2) && !(options.html && mayHaveHtml(content))) return unchanged();
  let ast;
  try {
    ast = (0, import_compiler.parse)(content, { modern: true, filename: options.filename });
  } catch {
    return unchanged();
  }
  const locals = /* @__PURE__ */ new Map();
  const actions = /* @__PURE__ */ new Set();
  collectImports(ast.instance?.content, locals, actions);
  collectImports(ast.module?.content, locals, actions);
  const warn = options.warn ?? ((message) => console.warn(message));
  const html = options.html ? lowerHtml(ast, content, options.filename, warn) : void 0;
  if (!locals.size && !html?.elements.size && !html?.edits.length) return unchanged();
  const edits = html ? [...html.edits] : [];
  const helpers = new Set(html?.helpers);
  const wrap = (expression, helper) => {
    helpers.add(helper);
    edits.push({ start: expression.start, end: expression.start, text: `${helper}(` }, { start: expression.end, end: expression.end, text: ")" });
  };
  const seen = /* @__PURE__ */ new Set();
  walk(ast.fragment, (node) => {
    if (node.type !== "Component" && node.type !== "RegularElement" || seen.has(node)) return;
    seen.add(node);
    const lowered = node.type === "RegularElement" ? html?.elements.get(node) : void 0;
    const primitive = lowered ? void 0 : locals.get(node.name);
    if (node.type === "RegularElement" ? !lowered : !primitive || mustStayComponent(node, primitive)) return;
    const tag = lowered?.tag ?? LOWERED_TAGS[primitive];
    const spreadHelper = lowered ? lowered.spreadHelper : SPREAD_HELPER;
    const classHelper = lowered ? HTML_CLASS_HELPER : CLASS_HELPER;
    const spreads = node.attributes.some((attribute) => attribute.type === "SpreadAttribute");
    const classes = node.attributes.filter((attribute) => attribute.type === "Attribute" && attribute.name === "class" || attribute.type === "ClassDirective");
    const directives = classes.filter((attribute) => attribute.type === "ClassDirective");
    const toggles = directives.length === 0 ? void 0 : `{ ${directives.map((directive) => `${JSON.stringify(directive.name)}: ${oneLine(content.slice(directive.expression.start, directive.expression.end))}`).join(", ")} }`;
    if (classes.length > 0) {
      const own2 = classes.find((attribute) => attribute.type === "Attribute");
      const parts = [...own2 ? [classExpression(content, own2)] : [], ...toggles ? [toggles] : []];
      const style = lowered ? void 0 : node.attributes.find((attribute) => attribute.type === "Attribute" && attribute.name === "style" && attribute.value !== true && !Array.isArray(attribute.value));
      const copy = style === void 0 ? void 0 : repeatableSource(content, style.value.expression);
      const styleArgument = copy === void 0 ? "" : `, ${copy}`;
      const written = `nativeClass={${classHelper}(${parts.length === 1 ? parts[0] : `[${parts.join(", ")}]`}${styleArgument})}`;
      const dropped = classes.reduce((count, attribute) => count + content.slice(attribute.start, attribute.end).split("\n").length - 1, 0) - (written.split("\n").length - 1);
      const value = dropped > 0 ? written + "\n".repeat(dropped) : written;
      helpers.add(classHelper);
      const at = own2 ?? (spreads ? void 0 : classes[0]);
      if (at === void 0) edits.push({ start: node.attributes[0].start, end: node.attributes[0].start, text: `${value} ` });
      for (const attribute of classes) edits.push({ start: attribute.start, end: attribute.end, text: attribute === at ? value : "" });
    }
    for (const attribute of node.attributes) {
      if (classes.includes(attribute) || lowered?.handled.has(attribute)) continue;
      if (attribute.type === "BindDirective" && attribute.name === "this") {
        const text = bindThisText(content, attribute, spreads);
        if (text !== void 0) {
          if (spreads) helpers.add(VALUE_HELPER2);
          helpers.add("__expoSvelteBind");
          const lost = content.slice(attribute.start, attribute.end).split("\n").length - text.split("\n").length;
          edits.push({ start: attribute.start, end: attribute.end, text: lost > 0 ? text + "\n".repeat(lost) : text });
          continue;
        }
      }
      if (spreads && attribute.type === "SpreadAttribute") {
        if (toggles === void 0) wrap(attribute.expression, spreadHelper);
        else {
          helpers.add(spreadHelper);
          edits.push({ start: attribute.expression.start, end: attribute.expression.start, text: `${spreadHelper}(` }, { start: attribute.expression.end, end: attribute.expression.end, text: `, ${toggles})` });
        }
      }
      if (spreads && attribute.type === "Attribute" && !attribute.name.startsWith("on") && attribute.name !== "style" && attribute.value !== true && !Array.isArray(attribute.value) && attribute.value.type === "ExpressionTag" && couldBeFunction(attribute.value.expression)) {
        if (content[attribute.start] === "{") edits.push({ start: attribute.start, end: attribute.start, text: `${attribute.name}=` });
        wrap(attribute.value.expression, VALUE_HELPER2);
      }
      if (!spreads && attribute.type === "Attribute" && PRESS_HANDLERS.has(attribute.name) && attribute.value !== true && !Array.isArray(attribute.value) && attribute.value.type === "ExpressionTag" && !isFunctionLiteral(attribute.value.expression)) {
        const renamed = `native${attribute.name[0].toUpperCase()}${attribute.name.slice(1)}`;
        if (content[attribute.start] === "{") edits.push({ start: attribute.start, end: attribute.start, text: `${renamed}=` });
        else edits.push({ start: attribute.start, end: attribute.start + attribute.name.length, text: renamed });
      }
      if (attribute.type === "Attribute" && attribute.name === "style" && content.startsWith("style", attribute.start)) {
        edits.push({ start: attribute.start, end: attribute.start + "style".length, text: "nativeStyle" });
      }
      if (attribute.type === "Attribute" && attribute.value === true) {
        edits.push({ start: attribute.end, end: attribute.end, text: "={true}" });
      }
      if (attribute.type === "UseDirective" && !actions.has(attribute.name)) {
        warn(`${options.filename ?? "component"}: use:${attribute.name} on <${node.name}> is passed to <${tag}> unchanged; native elements do not run DOM actions`);
      }
    }
    edits.push({ start: node.start + 1, end: node.start + 1 + node.name.length, text: tag + (lowered?.attributes ?? "") });
    const source = content.slice(node.start, node.end);
    if (source.endsWith("/>")) {
      edits.push({ start: node.end - 2, end: node.end, text: `></${tag}>` });
    } else if (lowered?.isVoid) {
      edits.push({ start: node.end, end: node.end, text: `</${tag}>` });
    } else {
      const close = content.lastIndexOf(`</${node.name}`, node.end - 1);
      if (close < node.start) return;
      edits.push({ start: close + 2, end: close + 2 + node.name.length, text: tag });
    }
  });
  if (!edits.length) return unchanged();
  const script = ast.instance ?? ast.module;
  const names = [...helpers].sort().map((helper) => `${HELPER_EXPORTS[helper]} as ${helper}`);
  const setup = html?.setup ?? [];
  const injected = [...names.length ? [`import { ${names.join(", ")} } from "${RENDERER}";`] : [], ...html?.imports ?? [], ...setup].join(" ");
  if (injected && script && (ast.instance || !setup.length)) edits.push({ start: script.content.start, end: script.content.start, text: ` ${injected}` });
  else if (injected) edits.push({ start: 0, end: 0, text: `<script>${injected}</script>` });
  edits.sort((a, b) => b.start - a.start || b.end - a.end);
  let output = content;
  for (const edit of edits) output = output.slice(0, edit.start) + edit.text + output.slice(edit.end);
  return { code: output, original: (line, column) => positionIn(content, output, edits, line, column) };
}
function offsetAt(text, line, column) {
  let offset = 0;
  for (let at = 1; at < line; at++) {
    const next = text.indexOf("\n", offset);
    if (next < 0) return text.length;
    offset = next + 1;
  }
  return offset + column;
}
function lineAndColumn(text, offset) {
  const before2 = text.slice(0, offset);
  const line = before2.split("\n").length;
  return { line, column: offset - (before2.lastIndexOf("\n") + 1) };
}
function positionIn(content, lowered, edits, line, column) {
  const target = offsetAt(lowered, line, column);
  let delta = 0;
  for (let at = edits.length - 1; at >= 0; at--) {
    const edit = edits[at];
    const from = edit.start + delta;
    if (target < from) break;
    if (target < from + edit.text.length) return lineAndColumn(content, edit.start);
    delta += edit.text.length - (edit.end - edit.start);
  }
  return lineAndColumn(content, Math.max(0, Math.min(content.length, target - delta)));
}

// src/svelte-compiler.ts
var nodeModule = __toESM(require("node:module"), 1);
var import_node_fs4 = require("node:fs");
var import_node_path4 = require("node:path");
var import_node_url = require("node:url");

// src/svelte-build.ts
var import_node_fs3 = require("node:fs");
var import_node_module = require("node:module");
var import_node_path3 = require("node:path");
var requiredSvelte = {
  version: "5.59.1",
  /** The first release with custom renderers. */
  firstWithRenderer: "5.59.0"
};
function before(version, release) {
  const parse4 = (v) => {
    const match = /^(\d+)\.(\d+)\.(\d+)(-)?/.exec(v);
    return match ? [Number(match[1]), Number(match[2]), Number(match[3]), match[4] ? 0 : 1] : null;
  };
  const a = parse4(version);
  const b = parse4(release);
  if (!a) return true;
  for (let i = 0; i < 4; i++) if (a[i] !== b[i]) return a[i] < b[i];
  return false;
}
function inspectSvelte(from) {
  let manifestPath;
  try {
    manifestPath = from ?? (0, import_node_module.createRequire)(__importMetaUrl).resolve("svelte/package.json");
  } catch {
    return { ok: false, version: null, directory: null, reason: "missing" };
  }
  const directory = (0, import_node_path3.dirname)(manifestPath);
  const manifest = JSON.parse((0, import_node_fs3.readFileSync)(manifestPath, "utf8"));
  const version = manifest.version ?? null;
  const exported = manifest.exports !== void 0 && "./renderer" in manifest.exports;
  if (!exported || !(0, import_node_fs3.existsSync)((0, import_node_path3.join)(directory, "src/renderer/index.js"))) return { ok: false, version, directory, reason: "no-renderer" };
  if (version === null || before(version, requiredSvelte.firstWithRenderer)) return { ok: false, version, directory, reason: "before-release" };
  return { ok: true, version: version ?? "unknown", directory };
}
function customRendererMessage(inspection, what) {
  const installed = `The installed svelte${inspection.version ? ` ${inspection.version}` : ""} (${inspection.directory})`;
  const found = inspection.reason === "missing" ? "No `svelte` package can be resolved from it." : inspection.reason === "no-renderer" ? `${installed} has no \`./renderer\` export: custom renderers came with Svelte ${requiredSvelte.firstWithRenderer}.` : `${installed} is from before Svelte ${requiredSvelte.firstWithRenderer}, the release with custom renderers: a build of the pull request (pkg.pr.new or a tarball) has a \`./renderer\` export with other method names.`;
  return [`${what} needs Svelte ${requiredSvelte.version}, with custom renderers. ${found}`, "Install it from the registry:", `  pnpm add svelte@${requiredSvelte.version}`].join("\n");
}
function assertCustomRenderer(what, from) {
  const inspection = inspectSvelte(from);
  if (!inspection.ok) throw new Error(customRendererMessage(inspection, what));
}

// src/svelte-compiler.ts
var require2 = nodeModule.createRequire(__importMetaUrl);
var compiler = null;
function svelteCompiler() {
  if (compiler) return compiler;
  const root = (0, import_node_path4.dirname)(require2.resolve("svelte/package.json"));
  acceptDirectivesIn(root);
  compiler = require2((0, import_node_path4.join)(root, "src/compiler/index.js"));
  return compiler;
}
var VISITORS = "src/compiler/phases/2-analyze/visitors";
var REFUSAL = "incompatible_with_custom_renderer";
var REFUSALS = {
  "TransitionDirective.js": "	if (custom_renderer) {\n		const directive = node.intro && node.outro ? '`transition:`' : node.intro ? '`in:`' : '`out:`';\n		e.incompatible_with_custom_renderer(node, directive);\n	}\n\n",
  "AnimateDirective.js": "	if (custom_renderer) {\n		e.incompatible_with_custom_renderer(node, '`animate:`');\n	}\n\n"
};
function acceptDirectives(file, source) {
  if (!source.includes(REFUSAL)) return source;
  const block = REFUSALS[file];
  if (block === void 0) throw new Error(`${file} is not one of the Svelte files whose refusal of the transition directives is removed (${Object.keys(REFUSALS).join(", ")})`);
  if (!source.includes(block)) {
    throw new Error(
      `expo-svelte: ${file} of the installed Svelte refuses \`transition:\`, \`in:\`, \`out:\` and \`animate:\` on a custom renderer in a form this version of the library does not know how to remove (Svelte was updated: the library is written against Svelte ${requiredSvelte.version}, which the guide installs).`
    );
  }
  const accepted = source.replace(block, "");
  if (accepted.includes(`${REFUSAL}(`)) throw new Error(`expo-svelte: ${file} of the installed Svelte refuses a directive in more than one place`);
  return accepted;
}
var hookedFor;
function acceptDirectivesIn(root) {
  if (hookedFor !== void 0) return;
  const needed = Object.keys(REFUSALS).map((file) => (0, import_node_fs4.realpathSync)((0, import_node_path4.join)(root, VISITORS, file))).filter((path) => (0, import_node_fs4.readFileSync)(path, "utf8").includes(REFUSAL));
  if (needed.length === 0) return;
  const register = nodeModule.registerHooks;
  if (typeof register !== "function") {
    throw new Error(
      `expo-svelte: Svelte's compiler refuses \`transition:\`, \`in:\`, \`out:\` and \`animate:\` on native elements, and the Metro transformer removes the refusal as the compiler loads (\`module.registerHooks\`), which Node ${process.version} does not have: use Node 22.15 or newer (the library asks for 22.17, 24.3 or 26).`
    );
  }
  register({
    load(url, context, next) {
      const result = next(url, context);
      if (!url.startsWith("file:") || result.source === void 0 || result.source === null) return result;
      let path;
      try {
        path = (0, import_node_fs4.realpathSync)((0, import_node_url.fileURLToPath)(url));
      } catch {
        return result;
      }
      if (!needed.includes(path)) return result;
      const text = typeof result.source === "string" ? result.source : Buffer.from(result.source).toString("utf8");
      return { ...result, source: acceptDirectives((0, import_node_path4.basename)(path), text) };
    }
  });
  hookedFor = root;
}

// src/transformer-cache.ts
function cacheKeyFiles(transformer, directory) {
  const files = [transformer];
  if (directory === sourceDirectory) {
    files.push(
      sourceFile("transformer-cache.ts"),
      sourceFile("lower.ts"),
      sourceFile("lower-html.ts"),
      sourceFile("html-tags.ts"),
      ...["inline", "properties", "values", "color", "parse", "table"].map((name) => sourceFile(`css/${name}.ts`)),
      sourceFile("remote/transform.ts"),
      sourceFile("compile-options.ts"),
      sourceFile("svelte-compiler.ts"),
      sourceFile("vendored.ts")
    );
  }
  return files;
}

// src/vendored.ts
var import_node_fs5 = require("node:fs");
var import_node_path5 = require("node:path");

// src/optional-libraries.ts
var react = "react-native";
var expo = "expo";
var optionalLibraries = [
  // Expo modules: found by Expo's autolinker through `expo-module.config.json`, which lists the Android class and the Swift module, so they have no `android` or `ios` entry here.
  { name: "expo-blur", version: "58.0.6", optional: { kind: expo } },
  { name: "expo-conic-gradient", version: "0.2.1", optional: { kind: expo } },
  { name: "expo-image", version: "58.0.18", optional: { kind: expo, plugin: "app.plugin.js" } },
  { name: "expo-linear-gradient", version: "58.0.4", optional: { kind: expo } },
  { name: "expo-video", version: "58.0.14", optional: { kind: expo, plugin: "app.plugin.js" } },
  // React Native packages: an entry of the autolinking config for each platform.
  {
    name: "@react-native-community/datetimepicker",
    version: "9.2.1",
    android: { packageImportPath: "import com.reactcommunity.rndatetimepicker.RNDateTimePickerPackage;", packageInstance: "new RNDateTimePickerPackage()" },
    ios: { podspec: "RNDateTimePicker.podspec" },
    optional: { kind: react, plugin: "app.plugin.js" }
  },
  {
    name: "lottie-react-native",
    version: "7.5.0",
    android: { packageImportPath: "import com.airbnb.android.react.lottie.LottiePackage;", packageInstance: "new LottiePackage()", componentDescriptors: ["LottieAnimationViewComponentDescriptor"] },
    ios: { podspec: "lottie-react-native.podspec" },
    optional: { kind: react }
  },
  {
    name: "react-native-animateable-text",
    version: "0.19.3",
    android: {
      packageImportPath: "import com.reactnativereanimatedtext.ReanimatedTextPackage;",
      packageInstance: "new ReanimatedTextPackage()",
      libraryName: "JBAnimatedText",
      componentDescriptors: ["CParagraphComponentDescriptor"],
      cmakeListsPath: "android/src/main/jni/CMakeLists.txt"
    },
    ios: { podspec: "react-native-animateable-text.podspec" },
    optional: { kind: react }
  },
  {
    name: "react-native-blob-util",
    version: "0.24.9",
    android: { packageImportPath: "import com.ReactNativeBlobUtil.ReactNativeBlobUtilPackage;", packageInstance: "new ReactNativeBlobUtilPackage()" },
    ios: { podspec: "react-native-blob-util.podspec" },
    optional: { kind: react }
  },
  {
    // No iOS code: `ShadowedView` is React Native's own `View` there (the layer's shadow), so the library has no podspec.
    name: "react-native-fast-shadow",
    version: "0.1.1",
    android: { packageImportPath: "import com.reactnativefastshadow.FastShadowPackage;", packageInstance: "new FastShadowPackage()" },
    optional: { kind: react }
  },
  {
    name: "react-native-maps",
    version: "1.29.11",
    android: {
      packageImportPath: "import com.rnmaps.maps.MapsPackage;",
      packageInstance: "new MapsPackage()",
      componentDescriptors: [
        "RNMapsCalloutComponentDescriptor",
        "RNMapsCircleComponentDescriptor",
        "RNMapsGoogleMapViewComponentDescriptor",
        "RNMapsGooglePolygonComponentDescriptor",
        "RNMapsMapViewComponentDescriptor",
        "RNMapsMarkerComponentDescriptor",
        "RNMapsOverlayComponentDescriptor",
        "RNMapsPolylineComponentDescriptor",
        "RNMapsUrlTileComponentDescriptor",
        "RNMapsWMSTileComponentDescriptor"
      ],
      cmakeListsPath: "android/src/main/jni/CMakeLists.txt"
    },
    ios: { podspec: "react-native-maps.podspec" },
    optional: { kind: react, plugin: "app.plugin.js" }
  },
  {
    // The PDF view reads its files through react-native-blob-util's native module, so turning it on turns that one on.
    name: "react-native-pdf",
    version: "7.0.3",
    android: { packageImportPath: "import org.wonday.pdf.RNPDFPackage;", packageInstance: "new RNPDFPackage()", componentDescriptors: ["RNPDFPdfViewComponentDescriptor"] },
    ios: { podspec: "react-native-pdf.podspec" },
    optional: { kind: react, requires: ["react-native-blob-util"] }
  },
  {
    name: "react-native-video",
    version: "6.19.3",
    android: { packageImportPath: "import com.brentvatne.react.ReactVideoPackage;", packageInstance: "new ReactVideoPackage()" },
    ios: { podspec: "react-native-video.podspec" },
    optional: { kind: react, plugin: "app.plugin.js" }
  },
  {
    name: "react-native-view-shot",
    version: "6.1.1",
    android: { packageImportPath: "import fr.greweb.reactnativeviewshot.RNViewShotPackage;", packageInstance: "new RNViewShotPackage()" },
    ios: { podspec: "react-native-view-shot.podspec" },
    optional: { kind: react }
  },
  {
    name: "react-native-webview",
    version: "14.0.1",
    android: { packageImportPath: "import com.reactnativecommunity.webview.RNCWebViewPackage;", packageInstance: "new RNCWebViewPackage()", componentDescriptors: ["RNCWebViewComponentDescriptor"] },
    ios: { podspec: "react-native-webview.podspec" },
    optional: { kind: react }
  },
  {
    name: "rive-react-native",
    version: "9.7.1",
    android: { packageImportPath: "import com.rivereactnative.RiveReactNativePackage;", packageInstance: "new RiveReactNativePackage()" },
    ios: { podspec: "rive-react-native.podspec" },
    optional: { kind: react }
  }
];

// src/vendored.ts
var vendoredPackages = [
  // The optional view libraries (`optional-libraries.ts`).
  ...optionalLibraries,
  {
    name: "react-native-nitro-modules",
    version: "0.35.10",
    android: { packageImportPath: "import com.margelo.nitro.NitroModulesPackage;", packageInstance: "new NitroModulesPackage()" },
    ios: { podspec: "NitroModules.podspec" }
  },
  {
    name: "react-native-mmkv",
    version: "4.3.2",
    android: { packageImportPath: "import com.margelo.nitro.mmkv.NitroMmkvPackage;", packageInstance: "new NitroMmkvPackage()" },
    ios: { podspec: "NitroMmkv.podspec" }
  },
  {
    // The base64 module quick-crypto and its Buffer ask for (`libraryName` QuickBase64 is the `react { }` block of its build.gradle).
    name: "react-native-quick-base64",
    version: "2.2.2",
    android: { packageImportPath: "import com.reactnativequickbase64.QuickBase64Package;", packageInstance: "new QuickBase64Package()" },
    ios: { podspec: "react-native-quick-base64.podspec" }
  },
  {
    // `crypto` and `crypto.subtle`: a Nitro module over OpenSSL (and libsodium, when the plugin's `sodiumEnabled` is on). It links the vendored Nitro runtime by its project name and pod.
    name: "react-native-quick-crypto",
    version: "1.1.3",
    android: { packageImportPath: "import com.margelo.nitro.quickcrypto.QuickCryptoPackage;", packageInstance: "new QuickCryptoPackage()" },
    ios: { podspec: "QuickCrypto.podspec" }
  },
  {
    // The `Intl` constructors Hermes lacks: a pure C++ TurboModule (no view, no module class: the `ReactPackage` is empty), so Android adds its CMake module to the app's build.
    name: "hermes-intl",
    version: "0.1.2",
    android: { packageImportPath: "import dev.hermesintl.HermesIntlPackage;", packageInstance: "new HermesIntlPackage()", cxxModule: { cmakeListsModuleName: "hermesintl", cmakeListsPath: "android/CMakeLists.txt", headerName: "NativeHermesIntl" } },
    ios: { podspec: "HermesIntl.podspec" }
  },
  {
    name: "react-native-gesture-handler",
    version: "3.3.0",
    // The one component descriptor and the CMake file its `react-native.config.js` names (`RNGestureHandlerDetector`: the shadow node of `shared/shadowNodes`, and `android/CMakeLists.txt`
    // builds it with the codegen's); the button and the root view are the codegen's alone and need no registration. `libraryName` is `codegenConfig.name`.
    android: { packageImportPath: "import com.swmansion.gesturehandler.RNGestureHandlerPackage;", packageInstance: "new RNGestureHandlerPackage()", componentDescriptors: ["RNGestureHandlerDetectorComponentDescriptor"], cmakeListsPath: "android/CMakeLists.txt" },
    ios: { podspec: "RNGestureHandler.podspec" }
  },
  {
    name: "react-native-worklets",
    version: "0.13.0",
    android: { packageImportPath: "import com.swmansion.worklets.WorkletsPackage;", packageInstance: "new WorkletsPackage()" },
    ios: { podspec: "RNWorklets.podspec" }
  },
  {
    name: "react-native-reanimated",
    version: "4.7.1",
    // The one component of its `react-native.config.js` (the shared-transition boundary) and its codegen CMake file, which is in the sources and not below `android/build/` (a test reads both from the copy).
    android: {
      packageImportPath: "import com.swmansion.reanimated.ReanimatedPackage;",
      packageInstance: "new ReanimatedPackage()",
      componentDescriptors: ["REASharedTransitionBoundaryComponentDescriptor"],
      cmakeListsPath: "Common/NativeView/CMakeLists.txt"
    },
    ios: { podspec: "RNReanimated.podspec" }
  },
  {
    name: "react-native-svg",
    version: "15.16.0",
    // The 29 components of its `react-native.config.js`, and its codegen CMake file, which is in the sources and not below `android/build/` (a test reads both from the copy).
    android: {
      packageImportPath: "import com.horcrux.svg.SvgPackage;",
      packageInstance: "new SvgPackage()",
      componentDescriptors: [
        "RNSVGCircleComponentDescriptor",
        "RNSVGClipPathComponentDescriptor",
        "RNSVGDefsComponentDescriptor",
        "RNSVGFeBlendComponentDescriptor",
        "RNSVGFeColorMatrixComponentDescriptor",
        "RNSVGFeCompositeComponentDescriptor",
        "RNSVGFeFloodComponentDescriptor",
        "RNSVGFeGaussianBlurComponentDescriptor",
        "RNSVGFeMergeComponentDescriptor",
        "RNSVGFeOffsetComponentDescriptor",
        "RNSVGFilterComponentDescriptor",
        "RNSVGEllipseComponentDescriptor",
        "RNSVGForeignObjectComponentDescriptor",
        "RNSVGGroupComponentDescriptor",
        "RNSVGImageComponentDescriptor",
        "RNSVGLinearGradientComponentDescriptor",
        "RNSVGLineComponentDescriptor",
        "RNSVGMarkerComponentDescriptor",
        "RNSVGMaskComponentDescriptor",
        "RNSVGPathComponentDescriptor",
        "RNSVGPatternComponentDescriptor",
        "RNSVGRadialGradientComponentDescriptor",
        "RNSVGRectComponentDescriptor",
        "RNSVGSvgViewAndroidComponentDescriptor",
        "RNSVGSymbolComponentDescriptor",
        "RNSVGTextComponentDescriptor",
        "RNSVGTextPathComponentDescriptor",
        "RNSVGTSpanComponentDescriptor",
        "RNSVGUseComponentDescriptor"
      ],
      cmakeListsPath: "android/src/main/jni/CMakeLists.txt"
    },
    ios: { podspec: "RNSVG.podspec" }
  }
];
var vendoredNames = vendoredPackages.map((vendored) => vendored.name);
var optionalPackages = vendoredPackages.filter((vendored) => vendored.optional !== void 0);
var alwaysLinkedPackages = vendoredPackages.filter((vendored) => vendored.optional === void 0);
var vendorDirectory = (root = packageRoot) => (0, import_node_path5.join)(root, "vendor");
var vendoredRoot = (name, root = packageRoot) => (0, import_node_path5.join)(vendorDirectory(root), name);
var real = (path) => {
  try {
    return (0, import_node_fs5.realpathSync)(path);
  } catch {
    return path;
  }
};
var spellings = /* @__PURE__ */ new Map();
function vendorSpellings(root) {
  let found = spellings.get(root);
  if (found === void 0) {
    found = [.../* @__PURE__ */ new Set([vendorDirectory(root), real(vendorDirectory(root))])];
    spellings.set(root, found);
  }
  return found;
}
function vendoredFileAs(path, root = packageRoot) {
  for (const directory of vendorSpellings(root)) {
    const relativePath = (0, import_node_path5.relative)(directory, path);
    if (relativePath !== "" && !relativePath.startsWith("..") && !(0, import_node_path5.isAbsolute)(relativePath)) {
      const inside = relativePath.split(import_node_path5.sep).join("/");
      if (vendoredPackages.some((vendored) => inside === vendored.name || inside.startsWith(`${vendored.name}/`))) return inside;
    }
  }
  return void 0;
}

// src/remote/transform.ts
var import_node_path7 = require("node:path");
var import_parser = require("@babel/parser");

// src/remote/kit.ts
var import_node_module2 = require("node:module");
var import_node_path6 = require("node:path");
var require3 = (0, import_node_module2.createRequire)(__importMetaUrl);
var kitRootCache;
function findKitRoot() {
  if (kitRootCache === void 0) {
    try {
      kitRootCache = (0, import_node_path6.dirname)(require3.resolve("@sveltejs/kit/package.json"));
    } catch {
      kitRootCache = null;
    }
  }
  return kitRootCache;
}
function kitMissingMessage(what) {
  return `${what} needs \`@sveltejs/kit\`, which is not installed (an optional peer dependency of expo-svelte: only remote functions and the web target use it). Install the version the package was written against: \`pnpm add @sveltejs/kit@3.4.0\`, and copy its patch (README, "Apply the patches").`;
}
function kitRoot(what = "The remote function runtime (`expo-svelte/remote`)") {
  const found = findKitRoot();
  if (found === null) throw new Error(kitMissingMessage(what));
  return found;
}

// src/remote/transform.ts
var REMOTE_RUNTIME = "expo-svelte/remote/runtime";
var REMOTE_GLOBALS = "expo-svelte/remote/globals";
var remoteModulePattern = /[/.]remote\.[^/]+$/;
var posix = (path) => path.replaceAll("\\", "/");
function isRemoteModule(filename) {
  const path = posix(filename);
  return remoteModulePattern.test(path) && /\.[cm]?[jt]s$/.test(path) && !path.includes("/node_modules/");
}
function hash(value) {
  let result = 5381;
  let index = value.length;
  while (index) result = result * 33 ^ value.charCodeAt(--index);
  return (result >>> 0).toString(36);
}
function remoteHash(filename, root) {
  return hash(posix((0, import_node_path7.relative)(root, filename)));
}
var RemoteModuleError = class extends Error {
  constructor(filename, message, node) {
    super(`${filename}${node?.loc ? `:${node.loc.start.line}:${node.loc.start.column + 1}` : ""}: ${message}`);
    this.name = "RemoteModuleError";
  }
};
var FUNCTIONS = /* @__PURE__ */ new Set(["query", "command", "form", "prerender"]);
var WRAPPERS = /* @__PURE__ */ new Set(["TSAsExpression", "TSSatisfiesExpression", "TSNonNullExpression", "TSTypeAssertion", "TSInstantiationExpression", "ParenthesizedExpression"]);
var unwrap = (node) => WRAPPERS.has(node.type) ? unwrap(node.expression) : node;
var propertyName = (member) => !member.computed && member.property.type === "Identifier" ? member.property.name : member.computed && member.property.type === "StringLiteral" ? member.property.value : void 0;
var exportedName = (node) => node.type === "Identifier" ? node.name : String(node.value);
function serverImports(program) {
  const functions = /* @__PURE__ */ new Map();
  const namespaces = /* @__PURE__ */ new Set();
  for (const statement of program.body) {
    if (statement.type !== "ImportDeclaration" || statement.importKind === "type" || statement.source.value !== "$app/server") continue;
    for (const specifier of statement.specifiers) {
      if (specifier.type === "ImportNamespaceSpecifier") namespaces.add(specifier.local.name);
      else if (specifier.type === "ImportSpecifier" && specifier.importKind !== "type") {
        const imported = exportedName(specifier.imported);
        if (FUNCTIONS.has(imported)) functions.set(specifier.local.name, imported);
      }
    }
  }
  return { functions, namespaces };
}
function kindOf(expression, imports) {
  const call = unwrap(expression);
  if (call.type !== "CallExpression") return void 0;
  const callee = unwrap(call.callee);
  const named = (node) => {
    const target = unwrap(node);
    if (target.type === "Identifier") return imports.functions.get(target.name);
    if (target.type === "MemberExpression" && unwrap(target.object).type === "Identifier" && imports.namespaces.has(unwrap(target.object).name)) {
      const name = propertyName(target);
      return name !== void 0 && FUNCTIONS.has(name) ? name : void 0;
    }
    return void 0;
  };
  if (callee.type === "MemberExpression") {
    const member = propertyName(callee);
    if ((member === "batch" || member === "live") && named(callee.object) === "query") return member === "batch" ? "query_batch" : "query_live";
  }
  return named(callee);
}
function remoteExports(source, filename) {
  const typescript = /\.[cm]?tsx?$/.test(filename);
  let ast;
  try {
    ast = (0, import_parser.parse)(source, { sourceType: "module", plugins: typescript ? ["typescript"] : [] });
  } catch (error) {
    throw new RemoteModuleError(filename, `cannot be parsed: ${error instanceof Error ? error.message : String(error)}`);
  }
  const { program } = ast;
  const imports = serverImports(program);
  const declared = /* @__PURE__ */ new Map();
  for (const statement of program.body) {
    if (statement.type === "VariableDeclaration") {
      for (const declarator of statement.declarations) if (declarator.id.type === "Identifier" && declarator.init) declared.set(declarator.id.name, declarator.init);
    }
  }
  const found = [];
  const add = (name, expression, at) => {
    const kind = expression && kindOf(expression, imports);
    if (!kind) throw new RemoteModuleError(filename, `\`${name}\` is exported from a remote module but is not the result of a call to \`query\`, \`query.batch\`, \`query.live\`, \`command\`, \`form\` or \`prerender\` imported from "$app/server". All exports from this file must be remote functions, and Metro finds them in the source, so create them in the export itself (\`export const ${name} = query(...)\`).`, at);
    found.push({ name, kind });
  };
  for (const statement of program.body) {
    if (statement.type === "ExportDefaultDeclaration") throw new RemoteModuleError(filename, "Cannot export `default` from a remote module: use named exports instead", statement);
    if (statement.type === "ExportAllDeclaration") {
      if (statement.exportKind === "type") continue;
      throw new RemoteModuleError(filename, "`export *` cannot be used in a remote module: the exports are found in the source of this file", statement);
    }
    if (statement.type !== "ExportNamedDeclaration" || statement.exportKind === "type") continue;
    if (statement.source) throw new RemoteModuleError(filename, "A remote module cannot re-export from another module: the exports are found in the source of this file", statement);
    const declaration = statement.declaration;
    if (declaration) {
      if (declaration.type === "TSTypeAliasDeclaration" || declaration.type === "TSInterfaceDeclaration") continue;
      if (declaration.type !== "VariableDeclaration") throw new RemoteModuleError(filename, `\`${declaration.id?.name ?? "default"}\` exported from a remote module is invalid: all exports from this file must be remote functions`, declaration);
      for (const declarator of declaration.declarations) {
        if (declarator.id.type !== "Identifier") throw new RemoteModuleError(filename, "A remote module cannot export a destructured declaration: each export is one remote function", declarator);
        add(declarator.id.name, declarator.init, declarator);
      }
      continue;
    }
    for (const specifier of statement.specifiers) {
      if (specifier.exportKind === "type") continue;
      add(exportedName(specifier.exported), declared.get(specifier.local.name), specifier);
    }
  }
  return found;
}
var RESERVED = /* @__PURE__ */ new Set(["do", "if", "in", "for", "let", "new", "try", "var", "case", "else", "enum", "eval", "null", "this", "true", "void", "with", "await", "break", "catch", "class", "const", "false", "super", "throw", "while", "yield", "delete", "export", "import", "public", "return", "static", "switch", "typeof", "default", "extends", "finally", "package", "private", "continue", "debugger", "function", "arguments", "interface", "protected", "implements", "instanceof"]);
var VALID_IDENTIFIER = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/;
function remoteStub(exports2, moduleHash) {
  const names = new Set(exports2.map((entry) => entry.name));
  let namespace = "__remote";
  for (let index = 0; names.has(namespace); index++) namespace = `__remote${index}`;
  let alias = 0;
  const declarations = [];
  const reexports = [];
  for (const { name, kind } of exports2) {
    const expression = `${namespace}.${kind}(${JSON.stringify(`${moduleHash}/${name}`)})`;
    if (VALID_IDENTIFIER.test(name) && !RESERVED.has(name)) {
      declarations.push(`export const ${name} = ${expression};`);
      continue;
    }
    let local = `_${alias++}`;
    while (names.has(local)) local = `_${alias++}`;
    declarations.push(`const ${local} = ${expression};`);
    reexports.push(`${local} as ${VALID_IDENTIFIER.test(name) ? name : JSON.stringify(name)}`);
  }
  return `import * as ${namespace} from ${JSON.stringify(REMOTE_RUNTIME)};

${declarations.join("\n")}${reexports.length > 0 ? `
export { ${reexports.join(", ")} };` : ""}
`;
}
function transformRemoteModule(source, filename, root) {
  return remoteStub(remoteExports(source, filename), remoteHash(filename, root));
}
var SHADOWS = [
  { pattern: /\/node_modules\/@sveltejs\/kit\/src\/runtime\/client\/remote-functions\//, names: ["fetch", "location", "navigator", "window", "FinalizationRegistry", "WeakRef", "__SVELTEKIT_DEV__"] },
  { pattern: /\/node_modules\/@sveltejs\/kit\/src\/runtime\/form-utils\.js$/, names: ["Blob"] },
  { pattern: /\/node_modules\/@sveltejs\/kit\/src\/runtime\/utils\.js$/, names: ["btoa", "atob"] }
];
function kitGlobalsImport(filename) {
  const path = posix(filename);
  const shadow = SHADOWS.find(({ pattern }) => pattern.test(path));
  return shadow && `
import { ${shadow.names.join(", ")} } from ${JSON.stringify(REMOTE_GLOBALS)};
`;
}

// src/transformer.ts
var import_trace_mapping = require("@jridgewell/trace-mapping");
var require4 = (0, import_node_module3.createRequire)(__importMetaUrl);
function upstreamTransformerPath(searchFrom = [process.cwd(), __dirname]) {
  let expoManifest;
  try {
    expoManifest = require4.resolve("expo/package.json", { paths: [...searchFrom] });
  } catch (cause) {
    throw new Error("The Metro transformer of expo-svelte needs `expo`, which it could not resolve (from the app's directory or from the package). Install it: `npx expo install expo`.", { cause });
  }
  return require4.resolve("@expo/metro-config/babel-transformer", { paths: [(0, import_node_path8.dirname)(expoManifest)] });
}
var upstream = require4(upstreamTransformerPath());
var workletsPluginFile = () => (0, import_node_path8.join)(vendoredRoot("react-native-worklets"), "plugin/index.js");
var pluginFiles = {
  "react-native-worklets/plugin": workletsPluginFile,
  "react-native-reanimated/plugin": () => (0, import_node_path8.join)(vendoredRoot("react-native-reanimated"), "plugin/index.js")
};
var redirected = /* @__PURE__ */ Symbol.for("expo-svelte/worklets-plugin");
var internals = import_node_module3.default;
if (process.versions.bun !== void 0 && process.env.NODE_ENV !== "test") {
  console.warn("expo-svelte: Metro runs under Bun, where the library cannot give Babel its copy of the Worklets plugin; animations and gestures need Metro on Node (`expo start`, not `bun --bun expo start`)");
}
if (process.versions.bun === void 0 && internals._resolveFilename[redirected] !== true) {
  const resolveFilename = internals._resolveFilename;
  const redirect = function(request, ...rest) {
    const plugin = pluginFiles[request];
    return plugin ? plugin() : resolveFilename.call(this, request, ...rest);
  };
  redirect[redirected] = true;
  internals._resolveFilename = redirect;
}
function sourceOf(input) {
  const { filename, src } = input;
  if (isRemoteModule(filename)) {
    const root = input.options.projectRoot;
    if (!root) throw new Error(`${filename}: Metro did not pass its project root, which the ids of remote functions are relative to`);
    kitRoot(`${filename} is a remote function module (\`*.remote.ts\`), which`);
    return transformRemoteModule(src, filename, root);
  }
  return src + (kitGlobalsImport(filename) ?? "");
}
var rendererChecked = false;
function requireCustomRenderer() {
  if (rendererChecked) return;
  assertCustomRenderer("The Metro transformer of expo-svelte");
  rendererChecked = true;
}
function assertWorkletsReadNoState(filename, code, runes) {
  if (!/["']worklet["']/.test(code)) return;
  const state = /* @__PURE__ */ new Set();
  let reached = false;
  (0, import_types.traverseFast)((0, import_parser2.parse)(code, { sourceType: "module" }), (node) => {
    if (!(0, import_types.isFunction)(node) || !(0, import_types.isBlockStatement)(node.body) || !node.body.directives.some((directive) => directive.value.value === "worklet")) return;
    (0, import_types.traverseFast)(node.body, (inner) => {
      if ((0, import_types.isMemberExpression)(inner) && (0, import_types.isIdentifier)(inner.object, { name: "$" })) reached = true;
      if ((0, import_types.isCallExpression)(inner) && (0, import_types.isMemberExpression)(inner.callee) && (0, import_types.isIdentifier)(inner.callee.object, { name: "$" }) && (0, import_types.isIdentifier)(inner.arguments[0])) state.add(inner.arguments[0].name);
    });
  });
  if (!reached) return;
  const names = [...state].map((name) => `\`${name}\``).join(", ");
  const what = names ? `${names}, which Svelte compiled into reactive state` : "reactive state (Svelte's runtime, `$`)";
  throw new Error(`${filename}: a worklet reads ${what}. A worklet runs on the UI runtime, which has no Svelte, so it cannot read state; on the device it would throw "Tried to synchronously call a Remote Function" when the screen mounts. ${runes ? "State in runes mode is `$state`, `$derived` and props: copy the value into a shared value (`createSharedValue`) on the JavaScript side and read that in the worklet." : "This component is not in runes mode (the library compiles the app's components in runes mode unless the file has `<svelte:options runes={false} />`, the app sets `runes: false`, or the file is a library below `node_modules`), where a variable that the markup mutates (`count.value = ...` in a handler) is state even when it is a `const`. Put the component in runes mode with `<svelte:options runes />`: there a `const` shared value stays a plain constant."}`);
}
function frameOf(source, line, column) {
  const lines2 = source.split("\n").map((text) => text.replace(/\r$/, ""));
  const last = Math.min(lines2.length, line + 2);
  const width = String(last).length;
  const frame = [];
  for (let at = Math.max(1, line - 2); at <= last; at++) {
    const text = lines2[at - 1] ?? "";
    frame.push(`${at === line ? ">" : " "} ${String(at).padStart(width)} | ${text}`);
    if (at === line) frame.push(`  ${" ".repeat(width)} | ${text.slice(0, column).replace(/[^\t]/g, " ")}^`);
  }
  return frame.join("\n");
}
function metroError(error, source, locate) {
  if (!(error instanceof Error) || error.name !== "CompileError") return error;
  const { start, code } = error;
  const failure = Object.assign(new Error(error.message), { name: error.name, ...code === void 0 ? {} : { code } });
  const at = start ? locate(start.line, start.column) : void 0;
  if (!at) return failure;
  return Object.assign(failure, { type: "CompileError", loc: { line: at.line, column: at.column }, codeFrame: frameOf(source, at.line, at.column) });
}
function compiling(compile, source, locate) {
  try {
    return compile();
  } catch (error) {
    throw metroError(error, source, locate);
  }
}
function transform(input) {
  const { filename } = input;
  const src = sourceOf(input);
  let code = src;
  let runes = true;
  const maps = [];
  const compiledBySvelte = /\.svelte(\.[jt]s)?$/.test(filename);
  if (filename.endsWith(".svelte")) {
    requireCustomRenderer();
    const lowering = lowerWithMap(src, { filename, html: lowersHtml(filename) });
    const result = compiling(() => svelteCompiler().compile(lowering.code, componentOptions(filename)), src, lowering.original);
    if (result.css?.code.trim()) throw new Error(`${filename}: use native style props; browser CSS is not supported`);
    code = result.js.code;
    runes = result.metadata.runes;
    if (result.js.map) maps.push(new import_trace_mapping.TraceMap(result.js.map.toString()));
  } else {
    const svelteModule = /\.svelte\.[jt]s$/.test(filename);
    const stripTypes = /\.tsx?$/.test(filename) && (svelteModule || !filename.includes("/node_modules/") && vendoredFileAs(filename) === void 0) && !src.includes("codegenNativeComponent") && !src.includes("codegenNativeCommands");
    if (stripTypes) {
      const stripped = (0, import_esbuild.transformSync)(src, { loader: filename.endsWith(".tsx") ? "tsx" : "ts", jsx: "preserve", target: "es2022", sourcemap: "external", sourcefile: filename });
      code = stripped.code;
      maps.push(new import_trace_mapping.TraceMap(stripped.map));
    }
    if (svelteModule) {
      const typeMap = maps[0];
      const result = compiling(() => svelteCompiler().compileModule(code, moduleOptions(filename)), src, (line, column) => {
        if (!typeMap) return { line, column };
        const original = (0, import_trace_mapping.originalPositionFor)(typeMap, { line, column });
        return original.line === null || original.column === null ? void 0 : { line: original.line, column: original.column };
      });
      code = result.js.code;
      if (result.js.map) maps.unshift(new import_trace_mapping.TraceMap(result.js.map.toString()));
    }
  }
  if (compiledBySvelte) assertWorkletsReadNoState(filename, code, runes);
  const output = upstream.transform({ ...input, src: code });
  if (maps.length && output.ast) (0, import_types.traverseFast)(output.ast, (node) => {
    if (!node.loc) return;
    for (const position of [node.loc.start, node.loc.end]) {
      for (const map of maps) {
        const original = (0, import_trace_mapping.originalPositionFor)(map, position);
        if (original.line === null || original.column === null) break;
        position.line = original.line;
        position.column = original.column;
      }
    }
  });
  return output;
}
function getCacheKey(options) {
  const files = cacheKeyFiles(__filename, __dirname);
  const hash2 = (0, import_node_crypto.createHash)("sha256");
  for (const file of files) hash2.update((0, import_node_fs6.readFileSync)(file));
  hash2.update((0, import_node_fs6.readFileSync)(workletsPluginFile()));
  hash2.update(`runes-default:${runesDefaultEnabled()}`);
  hash2.update(`async:${asyncEnabled()}`);
  return hash2.update(upstream.getCacheKey(options)).digest("hex");
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  getCacheKey,
  sourceOf,
  transform,
  upstreamTransformerPath
});
