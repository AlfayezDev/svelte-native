import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { convertCss } from "../../src/css/convert.ts";
import type { ClassRule, ClassTable, StyleValue, Unsupported } from "../../src/css/table.ts";

// The CSS converter against what Tailwind 4 really emits: the tests compile a file that imports Tailwind (and has a few classes of its
// own) for a list of candidate classes with the package's `tailwindcss`, and read the class table the converter makes of it.

const require = createRequire(import.meta.url);
const tailwindRoot = dirname(require.resolve("tailwindcss/package.json"));

async function compileTailwind(css: string, candidates: string[]): Promise<string> {
  const { compile } = (await import("tailwindcss")) as { compile: (css: string, options: object) => Promise<{ build: (candidates: string[]) => string }> };
  const loadStylesheet = async (id: string, base: string) => {
    const path = id === "tailwindcss" ? join(tailwindRoot, "index.css") : resolve(base, id);
    return { path, base: dirname(path), content: readFileSync(path, "utf8") };
  };
  const compiled = await compile(css, { base: tailwindRoot, loadStylesheet });
  return compiled.build(candidates);
}

const APP_CSS = `
@import "tailwindcss";
@theme { --color-brand: oklch(60% 0.2 30); }
/* A theme variable with a dark value: classes that read it differ by scheme. */
@layer theme { :root { --color-surface: #ffffff; @media (prefers-color-scheme: dark) { --color-surface: #101010; } } }
@layer components {
  .card { padding: 16px; border-width: 1px; border-color: var(--color-zinc-300); @variant dark { border-color: var(--color-zinc-700); } }
  .surface { background-color: var(--color-surface); }
}
.unlayered { padding: 2px; color: var(--color-brand); }
`;

const CANDIDATES = `
p-4 px-2 py-3 pt-2 ps-4 m-auto mx-auto -mt-2 gap-3 gap-x-2 w-1/2 w-full w-screen w-fit h-12 h-screen size-10 min-h-screen max-w-none
inset-0 inset-x-0 top-1/2 absolute fixed z-10 -z-10 flex-row flex-col flex-wrap flex-1 flex-auto flex-none grow shrink-0 basis-1/2
items-center justify-between self-end hidden flex block overflow-hidden overflow-x-hidden opacity-50
bg-sky-500 bg-sky-500/50 bg-blue-500 bg-white bg-transparent bg-[hsl(200_50%_50%)] bg-[rgb(10,20,30)] text-white text-red-500
text-lg text-xs leading-tight leading-6 tracking-tight tracking-[2px] font-semibold font-mono italic text-center uppercase underline
rounded rounded-3xl rounded-full rounded-t-lg border border-2 border-4 border-x-4 border-sky-500 border-dashed aspect-video
translate-x-2 -translate-y-1 -translate-x-1/2 rotate-45 -rotate-12 scale-75 scale-x-50
shadow-md shadow-none shadow-sky-500 ring-2 dark:shadow-none inset-shadow-none translate-none rotate-none scale-none transform-none
border-none aspect-auto z-auto max-h-none leading-[normal]
md:p-10 max-md:p-2 md:max-lg:p-1 dark:bg-zinc-900 dark:md:bg-red-500 2xl:p-6 !p-8
card surface unlayered pt-[env(safe-area-inset-top)] pb-[calc(env(safe-area-inset-bottom)+16px)] h-[calc(100vh-4rem)] w-[50vw]
hover:bg-sky-600 group-hover:bg-sky-600 space-x-4 placeholder:text-red-500 first:p-2 print:hidden motion-reduce:p-2 transition
`
  .split(/\s+/)
  .filter(Boolean);

const css = await compileTailwind(APP_CSS, CANDIDATES);
const { table, unsupported } = convertCss(css);

// --- Helpers -----------------------------------------------------------------------------------------------------------------

const rulesOf = (name: string, from: ClassTable = table): readonly ClassRule[] => from.classes[name] ?? [];

/** The one rule a class has. */
function ruleOf(name: string, from: ClassTable = table): ClassRule {
  const rules = rulesOf(name, from);
  expect(rules.length).toBe(1);
  return rules[0] as ClassRule;
}

const styleOf = (name: string) => ruleOf(name).style;

const sides = (prefix: string, value: StyleValue | null, suffix = "") => Object.fromEntries(["Top", "Right", "Bottom", "Left"].map((side) => [`${prefix}${side}${suffix}`, value]));

/** The style of a class list in a window, the way the runtime merges it: the rules that apply, by `order`, key by key, a `null` taking the key away. */
function cascade(names: string, scheme: "light" | "dark" = "light", width = 400, from: ClassTable = table): Record<string, StyleValue> {
  const rules = names
    .split(/\s+/)
    .flatMap((name) => [...rulesOf(name, from)])
    .filter((rule) => (rule.when?.scheme ?? scheme) === scheme && width >= (rule.when?.minWidth ?? 0) && width < (rule.when?.maxWidth ?? Number.POSITIVE_INFINITY))
    .sort((a, b) => a.order - b.order);
  const merged: Record<string, StyleValue> = {};
  for (const rule of rules) {
    for (const [key, value] of Object.entries(rule.style)) {
      if (value === null) delete merged[key];
      else merged[key] = value;
    }
  }
  return merged;
}

const unsupportedFor = (name: string): Unsupported[] => unsupported.filter((entry) => entry.className === name);

/** `#rrggbb` as channels. */
const channels = (hex: string) => [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));

function expectColor(actual: StyleValue | null | undefined, expected: string): void {
  expect(typeof actual).toBe("string");
  const got = channels(actual as string);
  const want = channels(expected);
  for (let i = 0; i < 3; i++) expect(Math.abs((got[i] as number) - (want[i] as number))).toBeLessThanOrEqual(1);
}

/** A handwritten stylesheet's table. */
const convert = (source: string, options?: { remPx?: number }) => convertCss(source, options);

/** The style of the class `x` in a one-rule stylesheet. */
const styleOfCss = (declarations: string, options?: { remPx?: number }) => ruleOf("x", convert(`.x { ${declarations} }`, options).table).style;

// --- The table ---------------------------------------------------------------------------------------------------------------

test("a table has a version and one entry per class, unescaped as written in markup", () => {
  expect(table.version).toBe(1);
  for (const name of ["p-4", "md:p-10", "bg-sky-500/50", "w-1/2", "pt-[env(safe-area-inset-top)]", "2xl:p-6", "dark:md:bg-red-500", "h-[calc(100vh-4rem)]"]) {
    expect(table.classes[name]?.length).toBeGreaterThan(0);
  }
  // Nothing from Tailwind's preflight or theme layers is a class.
  expect(Object.keys(table.classes).every((name) => !name.includes("\\"))).toBe(true);
});

test("spacing: padding and margin are written per side, so the cascade works key by key", () => {
  expect(styleOf("p-4")).toEqual(sides("padding", 16));
  expect(styleOf("px-2")).toEqual({ paddingLeft: 8, paddingRight: 8 });
  expect(styleOf("py-3")).toEqual({ paddingTop: 12, paddingBottom: 12 });
  expect(styleOf("pt-2")).toEqual({ paddingTop: 8 });
  expect(styleOf("ps-4")).toEqual({ paddingStart: 16 });
  expect(styleOf("m-auto")).toEqual(sides("margin", "auto"));
  expect(styleOf("mx-auto")).toEqual({ marginLeft: "auto", marginRight: "auto" });
  expect(styleOf("-mt-2")).toEqual({ marginTop: -8 });
  expect(styleOf("gap-3")).toEqual({ rowGap: 12, columnGap: 12 });
  expect(styleOf("gap-x-2")).toEqual({ columnGap: 8 });
});

test("p-4 then px-2 keeps the horizontal padding of px-2, whichever way the table is read", () => {
  expect(cascade("p-4 px-2")).toEqual({ ...sides("padding", 16), paddingLeft: 8, paddingRight: 8 });
  // `px-2` is after `p-4` in Tailwind's order whatever the markup says.
  expect(cascade("px-2 p-4")).toEqual(cascade("p-4 px-2"));
});

test("sizes: percentages are strings, rem is multiplied, the window is dynamic", () => {
  expect(styleOf("w-1/2")).toEqual({ width: "50%" });
  expect(styleOf("w-full")).toEqual({ width: "100%" });
  expect(styleOf("h-12")).toEqual({ height: 48 });
  expect(styleOf("size-10")).toEqual({ width: 40, height: 40 });
  expect(ruleOf("min-h-screen").dynamic).toEqual({ minHeight: { window: "height", scale: 1 } });
  expect(ruleOf("w-screen").dynamic).toEqual({ width: { window: "width", scale: 1 } });
  expect(ruleOf("w-[50vw]").dynamic).toEqual({ width: { window: "width", scale: 0.5 } });
  expect(ruleOf("h-[calc(100vh-4rem)]").dynamic).toEqual({ height: { window: "height", scale: 1, add: -64 } });
  expect(ruleOf("min-h-screen").style).toEqual({});
});

test("remPx sets what 1rem is", () => {
  const ten = convertCss(css, { remPx: 10 }).table;
  expect(ruleOf("p-4", ten).style).toEqual(sides("padding", 10));
  expect(ruleOf("text-lg", ten).style.fontSize).toBe(11.25);
  expect(ruleOf("md:p-10", ten).when?.minWidth).toBe(480);
});

test("positioning: inset-0, absolute, z-index", () => {
  expect(styleOf("absolute")).toEqual({ position: "absolute" });
  expect(styleOf("inset-0")).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
  expect(styleOf("inset-x-0")).toEqual({ left: 0, right: 0 });
  expect(styleOf("top-1/2")).toEqual({ top: "50%" });
  expect(styleOf("z-10")).toEqual({ zIndex: 10 });
  expect(styleOf("-z-10")).toEqual({ zIndex: -10 });
  expect(styleOf("z-auto")).toEqual({ zIndex: null });
  expect(unsupportedFor("fixed").map((entry) => entry.property)).toEqual(["position"]);
  expect(table.classes.fixed).toBeUndefined();
});

test("flex: direction, wrap, grow, shrink and basis", () => {
  expect(styleOf("flex-row")).toEqual({ flexDirection: "row" });
  expect(styleOf("flex-col")).toEqual({ flexDirection: "column" });
  expect(styleOf("flex-wrap")).toEqual({ flexWrap: "wrap" });
  // `flex: 1` is `1 1 0%`, written out so that `grow-0` after it works key by key; a basis of 0% is React Native's 0.
  expect(styleOf("flex-1")).toEqual({ flexGrow: 1, flexShrink: 1, flexBasis: 0 });
  expect(styleOf("flex-auto")).toEqual({ flexGrow: 1, flexShrink: 1, flexBasis: "auto" });
  expect(styleOf("flex-none")).toEqual({ flexGrow: 0, flexShrink: 0, flexBasis: "auto" });
  expect(styleOf("grow")).toEqual({ flexGrow: 1 });
  expect(styleOf("shrink-0")).toEqual({ flexShrink: 0 });
  expect(styleOf("basis-1/2")).toEqual({ flexBasis: "50%" });
});

test("alignment: items, justify, self", () => {
  expect(styleOf("items-center")).toEqual({ alignItems: "center" });
  expect(styleOf("justify-between")).toEqual({ justifyContent: "space-between" });
  expect(styleOf("self-end")).toEqual({ alignSelf: "flex-end" });
});

test("display: flex and none are kept, block is flex (it is how md:block undoes hidden), grid is unsupported; the keyword that was written goes with it, for the host to tell a block from a flex container", () => {
  expect(styleOf("hidden")).toEqual({ display: "none", htmlDisplay: "none" });
  expect(styleOf("flex")).toEqual({ display: "flex", htmlDisplay: "flex" });
  expect(styleOf("block")).toEqual({ display: "flex", htmlDisplay: "block" });
  expect(styleOfCss("display: inline-block")).toEqual({ display: "flex", htmlDisplay: "inline-block" });
  expect(styleOfCss("display: inline-flex")).toEqual({ display: "flex", htmlDisplay: "inline-flex" });
  // A later declaration of `display` replaces the keyword with it, so the two never disagree; `md:block` over `hidden` is the same.
  expect(styleOfCss("display: block; display: flex")).toEqual({ display: "flex", htmlDisplay: "flex" });
  expect(styleOfCss("display: flex; display: grid")).toEqual({ display: "flex", htmlDisplay: "flex" });
});

test("overflow and opacity", () => {
  expect(styleOf("overflow-hidden")).toEqual({ overflow: "hidden" });
  expect(styleOf("opacity-50")).toEqual({ opacity: 0.5 });
  // React Native has one overflow, not one per axis.
  expect(unsupportedFor("overflow-x-hidden")[0]?.property).toBe("overflow-x");
});

test("oklch colors become hex within a channel of Tailwind's own values", () => {
  expectColor(styleOf("bg-sky-500").backgroundColor, "#00a6f4");
  expectColor(styleOf("bg-blue-500").backgroundColor, "#2b7fff");
  expectColor(styleOf("text-red-500").color, "#fb2c36");
  const direct = (oklch: string) => styleOfCss(`color: ${oklch}`).color;
  expectColor(direct("oklch(21% 0.006 285.885)"), "#18181b");
  expectColor(direct("oklch(69.6% 0.17 162.48)"), "#00bc7d");
  expectColor(direct("oklch(55.6% 0 0)"), "#737373");
  expectColor(direct("oklch(20.8% 0.042 265.755)"), "#0f172b");
  expectColor(direct("oklab(0.5 0 0)"), "#636363");
  expect(direct("oklch(1 0 0)")).toBe("#ffffff");
  expect(direct("oklch(0 0 0)")).toBe("#000000");
});

test("colors: named, hex, rgb, hsl, alpha and transparent", () => {
  expect(styleOf("text-white").color).toBe("#ffffff");
  expect(styleOf("bg-transparent").backgroundColor).toBe("rgba(0, 0, 0, 0)");
  expect(styleOf("bg-[rgb(10,20,30)]").backgroundColor).toBe("#0a141e");
  expect(styleOf("bg-[hsl(200_50%_50%)]").backgroundColor).toBe("#4095bf");
  const color = (value: string) => styleOfCss(`color: ${value}`).color;
  expect(color("#f00")).toBe("#ff0000");
  expect(color("#ff000080")).toBe("rgba(255, 0, 0, 0.502)");
  expect(color("rgba(0, 0, 0, 0.5)")).toBe("rgba(0, 0, 0, 0.5)");
  expect(color("rgb(0 0 0 / 25%)")).toBe("rgba(0, 0, 0, 0.25)");
  expect(color("rebeccapurple")).toBe("#663399");
  expect(color("hsl(0 100% 50%)")).toBe("#ff0000");
  expect(convert(".x { color: currentColor }").unsupported[0]?.property).toBe("color");
});

test("color-mix in srgb, oklab and oklch", () => {
  // Tailwind's `bg-sky-500/50`: the srgb mix, then the oklab one inside @supports; the result is the color at half alpha.
  expect(styleOf("bg-sky-500/50").backgroundColor).toBe("rgba(0, 166, 244, 0.5)");
  expect(rulesOf("bg-sky-500/50")).toHaveLength(1);
  const mix = (value: string) => styleOfCss(`color: ${value}`).color;
  expect(mix("color-mix(in srgb, #ff0000 50%, #0000ff)")).toBe("#800080");
  expect(mix("color-mix(in srgb, white 25%, transparent)")).toBe("rgba(255, 255, 255, 0.25)");
  expect(mix("color-mix(in oklab, oklch(68.5% 0.169 237.323) 50%, transparent)")).toBe("rgba(0, 166, 244, 0.5)");
  expect(mix("color-mix(in oklch, #ff0000, #ff0000)")).toBe("#ff0000");
  // Percentages that add up to less than 100 scale the alpha.
  expect(mix("color-mix(in srgb, #000 20%, #000 20%)")).toBe("rgba(0, 0, 0, 0.4)");
});

test("typography: size, line height and letter spacing relative to the font size", () => {
  const lg = ruleOf("text-lg");
  expect(lg.style).toEqual({ fontSize: 18 });
  expect(lg.fontRelative).toEqual({ lineHeight: 1.75 / 1.125 });
  expect(ruleOf("text-xs").style).toEqual({ fontSize: 12 });
  expect(ruleOf("leading-tight").fontRelative).toEqual({ lineHeight: 1.25 });
  expect(ruleOf("leading-tight").style).toEqual({});
  expect(styleOf("leading-6")).toEqual({ lineHeight: 24 });
  expect(ruleOf("tracking-tight").fontRelative).toEqual({ letterSpacing: -0.025 });
  expect(styleOf("tracking-[2px]")).toEqual({ letterSpacing: 2 });
});

test("typography: weight, style, family, alignment, transform and decoration", () => {
  expect(styleOf("font-semibold")).toEqual({ fontWeight: "600" });
  expect(styleOf("italic")).toEqual({ fontStyle: "italic" });
  expect(styleOf("text-center")).toEqual({ textAlign: "center" });
  expect(styleOf("uppercase")).toEqual({ textTransform: "uppercase" });
  expect(styleOf("underline")).toEqual({ textDecorationLine: "underline" });
  // The first family, unquoted; the CSS system keywords become the names React Native knows.
  expect(styleOf("font-mono")).toEqual({ fontFamily: "monospace" });
  expect(styleOfCss(`font-family: "Inter", sans-serif`)).toEqual({ fontFamily: "Inter" });
  expect(styleOfCss("font-weight: bold")).toEqual({ fontWeight: "700" });
});

test("borders: radius, width, color and style", () => {
  expect(styleOf("rounded-3xl")).toEqual({ borderTopLeftRadius: 24, borderTopRightRadius: 24, borderBottomRightRadius: 24, borderBottomLeftRadius: 24 });
  expect(styleOf("rounded-t-lg")).toEqual({ borderTopLeftRadius: 8, borderTopRightRadius: 8 });
  expect(styleOf("rounded-full").borderTopLeftRadius).toBe(9999);
  expect(styleOf("border-2")).toEqual(sides("border", 2, "Width"));
  expect(styleOf("border-x-4")).toEqual({ borderLeftWidth: 4, borderRightWidth: 4 });
  expect(styleOf("border-dashed")).toEqual({ borderStyle: "dashed" });
  const borderColor = styleOf("border-sky-500");
  expect(Object.keys(borderColor).sort()).toEqual(["borderBottomColor", "borderLeftColor", "borderRightColor", "borderTopColor"]);
  expectColor(borderColor.borderTopColor, "#00a6f4");
  // `border-style: var(--tw-border-style)` is Tailwind's slot for another class: `border-2` sets no style of its own.
  expect(styleOf("border-2")).not.toHaveProperty("borderStyle");
});

test("aspect-ratio", () => {
  expect(styleOf("aspect-video")).toEqual({ aspectRatio: 16 / 9 });
});

test("transforms: translate, rotate and scale are separate keys that compose", () => {
  expect(styleOf("translate-x-2")).toEqual({ "transform:translateX": 8 });
  expect(styleOf("-translate-y-1")).toEqual({ "transform:translateY": -4 });
  expect(styleOf("rotate-45")).toEqual({ "transform:rotate": "45deg" });
  expect(styleOf("-rotate-12")).toEqual({ "transform:rotate": "-12deg" });
  expect(styleOf("scale-75")).toEqual({ "transform:scaleX": 0.75, "transform:scaleY": 0.75 });
  expect(styleOf("scale-x-50")).toEqual({ "transform:scaleX": 0.5 });
  // Each class sets only its own axis (the other variable is Tailwind's default), so together they keep both.
  expect(cascade("translate-x-2 -translate-y-1 rotate-45 scale-75")).toEqual({
    "transform:translateX": 8,
    "transform:translateY": -4,
    "transform:rotate": "45deg",
    "transform:scaleX": 0.75,
    "transform:scaleY": 0.75,
  });
  // A percentage is the element's own size.
  expect(table.classes["-translate-x-1/2"]).toBeUndefined();
  expect(unsupportedFor("-translate-x-1/2")[0]?.reason).toContain("percentage");
});

test("box-shadow: Tailwind's shadow variables are resolved into one string, transparent layers dropped", () => {
  expect(styleOf("shadow-md")).toEqual({ boxShadow: "0px 4px 6px -1px rgba(0, 0, 0, 0.1), 0px 2px 4px -2px rgba(0, 0, 0, 0.1)" });
  // Every layer is `0 0 #0000`: no shadow, which takes the key away from earlier rules.
  expect(styleOf("shadow-none")).toEqual({ boxShadow: null });
  expect(styleOf("inset-shadow-none")).toEqual({ boxShadow: null });
  expect(unsupportedFor("shadow-none")).toEqual([]);
  expect(styleOfCss("box-shadow: inset 0 2px 4px 0 rgb(0 0 0 / 0.05), 0 0 #0000")).toEqual({ boxShadow: "inset 0px 2px 4px 0px rgba(0, 0, 0, 0.05)" });
  // A ring is `currentColor` by default; a color class (`shadow-sky-500`) only sets a custom property for another class to read.
  expect(unsupportedFor("ring-2")[0]?.property).toBe("box-shadow");
  expect(unsupportedFor("shadow-sky-500")[0]?.property).toBe("--tw-shadow-color");
});

test("conditions: breakpoints become minWidth and maxWidth in dp", () => {
  expect(ruleOf("md:p-10")).toMatchObject({ when: { minWidth: 768 }, style: sides("padding", 40) });
  expect(ruleOf("max-md:p-2")).toMatchObject({ when: { maxWidth: 768 }, style: sides("padding", 8) });
  expect(ruleOf("md:max-lg:p-1").when).toEqual({ minWidth: 768, maxWidth: 1024 });
  expect(ruleOf("2xl:p-6").when).toEqual({ minWidth: 1536 });
  // `md:p-10` does not apply below 768 and wins above it.
  expect(cascade("p-4 md:p-10", "light", 700)).toEqual(sides("padding", 16));
  expect(cascade("p-4 md:p-10", "light", 768)).toEqual(sides("padding", 40));
  expect(cascade("p-4 max-md:p-2", "light", 767)).toEqual(sides("padding", 8));
});

test("conditions: the color scheme, alone and with a breakpoint", () => {
  expect(ruleOf("dark:bg-zinc-900").when).toEqual({ scheme: "dark" });
  expectColor(styleOf("dark:bg-zinc-900").backgroundColor, "#18181b");
  expect(ruleOf("dark:md:bg-red-500").when).toEqual({ scheme: "dark", minWidth: 768 });
  expect(cascade("bg-white dark:bg-zinc-900", "light").backgroundColor).toBe("#ffffff");
  expectColor(cascade("bg-white dark:bg-zinc-900", "dark").backgroundColor, "#18181b");
});

test("media conditions written by hand: min-width, max-width, range syntax, platform, and what is not supported", () => {
  const rules = (source: string, name = "x") => rulesOf(name, convert(source).table);
  expect(rules("@media (min-width: 640px) { .x { opacity: 1 } }")[0]?.when).toEqual({ minWidth: 640 });
  expect(rules("@media (max-width: 40rem) { .x { opacity: 1 } }")[0]?.when).toEqual({ maxWidth: 640 });
  expect(rules("@media (48rem <= width < 64rem) { .x { opacity: 1 } }")[0]?.when).toEqual({ minWidth: 768, maxWidth: 1024 });
  expect(rules("@media screen and (width >= 100px) and (prefers-color-scheme: light) { .x { opacity: 1 } }")[0]?.when).toEqual({ minWidth: 100, scheme: "light" });
  expect(rules("@media (platform: ios) { .x { opacity: 1 } }")[0]?.when).toEqual({ platform: "ios" });
  // Conditions that cannot both hold leave no rule and no warning.
  expect(convert("@media (prefers-color-scheme: dark) { @media (prefers-color-scheme: light) { .x { opacity: 1 } } }").table.classes).toEqual({});
  const hover = convert("@media (hover: hover) { .x { opacity: 1 } }");
  expect(hover.table.classes).toEqual({});
  expect(hover.unsupported).toEqual([{ className: "x", property: "@media", reason: "media feature (hover: hover) is not supported" }]);
  expect(unsupportedFor("print:hidden")[0]?.property).toBe("@media");
  expect(unsupportedFor("motion-reduce:p-2")[0]?.property).toBe("@media");
});

test("@supports: color-mix holds, any other condition skips its block with a report", () => {
  const blocked = convert("@supports (display: grid) { .x { opacity: 1 } }");
  expect(blocked.table.classes).toEqual({});
  expect(blocked.unsupported[0]).toMatchObject({ className: "x", property: "@supports" });
  const holds = convert(".x { color: red; @supports (color: color-mix(in lab, red, red)) { color: blue } }").table;
  expect(ruleOf("x", holds).style).toEqual({ color: "#0000ff" });
});

test("a custom class in @layer components with a nested dark override is two rules, the dark one later", () => {
  const [base, dark] = rulesOf("card");
  expect(rulesOf("card")).toHaveLength(2);
  expect(base?.when).toBeUndefined();
  expect(base?.style).toMatchObject({ ...sides("padding", 16), ...sides("border", 1, "Width") });
  expectColor(base?.style.borderTopColor, "#d4d4d8");
  expect(dark?.when).toEqual({ scheme: "dark" });
  expectColor(dark?.style.borderTopColor, "#3f3f46");
  expect(dark?.style).not.toHaveProperty("paddingTop");
  expect((dark as ClassRule).order).toBeGreaterThan((base as ClassRule).order);
  expectColor(cascade("card", "dark").borderTopColor, "#3f3f46");
  expectColor(cascade("card", "light").borderTopColor, "#d4d4d8");
});

test("order: layers first, then source; a nested block comes after its parent and declarations after it come after the block", () => {
  const nested = convert(".x { color: red; @media (prefers-color-scheme: dark) { color: blue } opacity: 0.5 }").table;
  const orders = rulesOf("x", nested).map((rule) => rule.order);
  expect(orders).toHaveLength(3);
  expect(orders).toEqual([...orders].sort((a, b) => a - b));
  expect(new Set(orders).size).toBe(3);
  // Layer names rank in the order they first appear, whatever the order of the blocks.
  const layered = convert("@layer a, b; @layer b { .x { opacity: 1 } .y { opacity: 1 } } @layer a { .z { opacity: 1 } }").table;
  expect(ruleOf("z", layered).order).toBeLessThan(ruleOf("x", layered).order);
  expect(ruleOf("x", layered).order).toBeLessThan(ruleOf("y", layered).order);
});

test("every rule in the table has its own order, except the light and dark pair of one rule", () => {
  const all = Object.values(table.classes).flat();
  const withoutPairs = new Set(all.filter((rule) => rule.when?.scheme === undefined).map((rule) => rule.order));
  expect(withoutPairs.size).toBe(all.filter((rule) => rule.when?.scheme === undefined).length);
});

test("an unlayered custom class is above every utility", () => {
  const unlayered = ruleOf("unlayered");
  const topUtility = Math.max(...Object.entries(table.classes).filter(([name]) => name !== "unlayered" && !name.startsWith("!")).flatMap(([, rules]) => rules.map((rule) => rule.order)));
  expect(unlayered.order).toBeGreaterThan(topUtility);
  expect(unlayered.style).toMatchObject({ ...sides("padding", 2) });
  // And so it wins over `p-4`.
  expect(cascade("p-4 unlayered")).toMatchObject(sides("padding", 2));
});

test("!important goes above the unlayered rules", () => {
  expect(ruleOf("!p-8").order).toBeGreaterThan(ruleOf("unlayered").order);
  const important = convert(".x { opacity: 0.5 !important; color: red } .y { opacity: 1 }").table;
  expect(ruleOf("y", important).order).toBeLessThan(rulesOf("x", important).at(-1)?.order as number);
  expect(cascade("x y", "light", 400, important).opacity).toBe(0.5);
});

test("a theme variable redefined for dark: a class that reads it is two rules with the same order", () => {
  const [light, dark] = rulesOf("surface");
  expect(rulesOf("surface")).toHaveLength(2);
  expect(light?.when).toEqual({ scheme: "light" });
  expect(dark?.when).toEqual({ scheme: "dark" });
  expect(light?.style).toEqual({ backgroundColor: "#ffffff" });
  expect(dark?.style).toEqual({ backgroundColor: "#101010" });
  expect((light as ClassRule).order).toBe((dark as ClassRule).order);
  expect(cascade("surface", "dark").backgroundColor).toBe("#101010");
  // A variable that never changes does not split a class.
  expect(rulesOf("unlayered")).toHaveLength(1);
});

test("theme variables overridden in the three usual places", () => {
  const forms = [
    ":root { --c: #fff } @media (prefers-color-scheme: dark) { :root { --c: #000 } }",
    ":root, :host { --c: #fff; @media (prefers-color-scheme: dark) { --c: #000 } }",
    "@layer theme { :root { --c: #fff } } @layer theme { @media (prefers-color-scheme: dark) { :root { --c: #000 } } }",
  ];
  for (const form of forms) {
    const [light, dark] = rulesOf("x", convert(`${form} .x { color: var(--c) }`).table);
    expect([light?.when, dark?.when]).toEqual([{ scheme: "light" }, { scheme: "dark" }]);
    expect([light?.style.color, dark?.style.color]).toEqual(["#ffffff", "#000000"]);
  }
  // Inside a dark rule the variable's value is the dark one, in one rule.
  const inDark = rulesOf("x", convert(":root { --c: #fff } @media (prefers-color-scheme: dark) { :root { --c: #000 } .x { color: var(--c) } }").table);
  expect(inDark).toHaveLength(1);
  expect(inDark[0]).toMatchObject({ when: { scheme: "dark" }, style: { color: "#000000" } });
});

test("var(): fallbacks, nesting and the class's own custom properties", () => {
  expect(styleOfCss("--a: 4px; padding-top: var(--a)")).toEqual({ paddingTop: 4 });
  expect(styleOfCss("padding-top: var(--missing, 6px)")).toEqual({ paddingTop: 6 });
  expect(styleOfCss("padding-top: var(--m1, var(--m2, 7px))")).toEqual({ paddingTop: 7 });
  expect(styleOfCss("--b: var(--a); --a: 2px; padding-top: var(--b)")).toEqual({ paddingTop: 2 });
  const unresolved = convert(".x { padding-top: var(--nope) }");
  expect(unresolved.table.classes).toEqual({});
  expect(unresolved.unsupported[0]).toMatchObject({ className: "x", property: "padding-top", reason: "--nope is not defined" });
  // Custom properties are inputs, not output.
  expect(Object.keys(styleOfCss("--a: 4px; padding-top: var(--a)"))).toEqual(["paddingTop"]);
});

test("calc(): units, percentages, and the safe area and window as dynamic values", () => {
  expect(styleOfCss("padding-top: calc(1rem + 4px)")).toEqual({ paddingTop: 20 });
  expect(styleOfCss("padding-top: calc((2px + 4px) * 2)")).toEqual({ paddingTop: 12 });
  expect(styleOfCss("padding-top: calc(10px / 4)")).toEqual({ paddingTop: 2.5 });
  expect(styleOfCss("width: calc(1 / 3 * 100%)")).toEqual({ width: "33.333333%" });
  expect(styleOfCss("width: calc(50% * 2)")).toEqual({ width: "100%" });
  expect(styleOfCss("padding-top: max(4px, 8px)")).toEqual({ paddingTop: 8 });
  expect(styleOfCss("z-index: calc(10 * -1)")).toEqual({ zIndex: -10 });
  expect(convert(".x { width: calc(50% + 4px) }").unsupported[0]?.property).toBe("width");
  expect(convert(".x { padding-top: calc(4px * 2px) }").unsupported[0]?.property).toBe("padding-top");
  const dynamic = (declarations: string) => ruleOf("x", convert(`.x { ${declarations} }`).table).dynamic;
  expect(dynamic("padding-top: env(safe-area-inset-top)")).toEqual({ paddingTop: { inset: "top" } });
  expect(dynamic("padding-left: calc(env(safe-area-inset-left) + 8px)")).toEqual({ paddingLeft: { inset: "left", add: 8 } });
  expect(dynamic("padding-bottom: calc(env(safe-area-inset-bottom) * 2)")).toEqual({ paddingBottom: { inset: "bottom", scale: 2 } });
  expect(dynamic("height: calc(100vh - 20px)")).toEqual({ height: { window: "height", scale: 1, add: -20 } });
  expect(dynamic("width: 50vw")).toEqual({ width: { window: "width", scale: 0.5 } });
  expect(convert(".x { padding-top: max(env(safe-area-inset-top), 16px) }").unsupported[0]?.property).toBe("padding-top");
});

test("the safe area from a Tailwind arbitrary value", () => {
  expect(ruleOf("pt-[env(safe-area-inset-top)]").dynamic).toEqual({ paddingTop: { inset: "top" } });
  expect(ruleOf("pb-[calc(env(safe-area-inset-bottom)+16px)]").dynamic).toEqual({ paddingBottom: { inset: "bottom", add: 16 } });
});

test("hover, group, space-x, placeholder and the other selectors that are not a single class are reported, with no entry", () => {
  for (const name of ["hover:bg-sky-600", "group-hover:bg-sky-600", "space-x-4", "placeholder:text-red-500", "first:p-2"]) {
    expect(table.classes[name]).toBeUndefined();
    const [entry] = unsupportedFor(name);
    expect(entry?.property).toBe("selector");
    expect(entry?.reason.length).toBeGreaterThan(0);
  }
  expect(unsupportedFor("hover:bg-sky-600")[0]?.reason).toContain("pseudo-class :hover");
  expect(unsupportedFor("placeholder:text-red-500")[0]?.reason).toContain("::placeholder");
  expect(unsupportedFor("space-x-4")[0]?.reason).toContain("combinator");
  const handwritten = convert(".a.b { opacity: 1 } .a .b { opacity: 1 } .a > .b { opacity: 1 } .a:hover { opacity: 1 } .c::before { opacity: 1 } #d { opacity: 1 } h1 { opacity: 1 }");
  expect(handwritten.table.classes).toEqual({});
  expect(handwritten.unsupported.map((entry) => entry.className)).toEqual(["a", "a", "a", "a", "c", "#d", "h1"]);
});

test("Tailwind's own element rules and theme variables make no entries and no warnings", () => {
  expect(unsupported.some((entry) => /^(\*|html|:host|:root|button|hr|abbr|h1|a|b|code|small|sub|table)\b/.test(entry.className))).toBe(false);
  expect(unsupported.some((entry) => entry.className.startsWith(":") || entry.className.startsWith("["))).toBe(false);
});

test("a class whose every declaration is unsupported has no entry; one with some supported ones keeps those", () => {
  expect(table.classes.transition).toBeUndefined();
  expect(unsupportedFor("transition").map((entry) => entry.property)).toEqual(["transition-property", "transition-timing-function", "transition-duration"]);
  const mixed = convert(".x { color: red; cursor: pointer; float: left }");
  expect(ruleOf("x", mixed.table).style).toEqual({ color: "#ff0000" });
  expect(mixed.unsupported.map((entry) => entry.property)).toEqual(["cursor", "float"]);
  expect(unsupportedFor("w-fit")[0]?.property).toBe("width");
  expect(table.classes["w-fit"]).toBeUndefined();
});

test("selector lists, escapes and several rules for one class", () => {
  const listed = convert(".a, .b\\:c { opacity: 1 } .\\32 xl\\:p-4 { padding-top: 4px } .w-1\\/2 { width: 50% } .a { color: red }").table;
  expect(Object.keys(listed.classes).sort()).toEqual(["2xl:p-4", "a", "b:c", "w-1/2"]);
  expect(rulesOf("a", listed)).toHaveLength(2);
  expect(ruleOf("b:c", listed).style).toEqual({ opacity: 1 });
  expect(ruleOf("w-1/2", listed).style).toEqual({ width: "50%" });
});

test("the parser copes with comments, strings, minified CSS and a missing last semicolon", () => {
  const source = `/* head */.a{color:/* inline */red;font-family:"A;B}",serif}@media(min-width:100px){.b{opacity:.5}}/* tail */.c{margin:0 auto}`;
  const parsed = convert(source).table;
  expect(ruleOf("a", parsed).style).toEqual({ color: "#ff0000", fontFamily: "A;B}" });
  expect(ruleOf("b", parsed)).toMatchObject({ when: { minWidth: 100 }, style: { opacity: 0.5 } });
  expect(ruleOf("c", parsed).style).toEqual({ marginTop: 0, marginRight: "auto", marginBottom: 0, marginLeft: "auto" });
  expect(convert("").table).toEqual({ version: 1, classes: {} });
  // Not a stylesheet at all: no throw, no classes.
  expect(convert("}}} .a {{ color red;;").table.version).toBe(1);
});

test("shorthands are written as longhands, in CSS's order of values", () => {
  expect(styleOfCss("margin: 1px 2px 3px 4px")).toEqual({ marginTop: 1, marginRight: 2, marginBottom: 3, marginLeft: 4 });
  expect(styleOfCss("padding: 1px 2px")).toEqual({ paddingTop: 1, paddingRight: 2, paddingBottom: 1, paddingLeft: 2 });
  expect(styleOfCss("padding-inline: 4px; padding-block: 2px 3px")).toEqual({ paddingLeft: 4, paddingRight: 4, paddingTop: 2, paddingBottom: 3 });
  expect(styleOfCss("inset: 1px 2px")).toEqual({ top: 1, right: 2, bottom: 1, left: 2 });
  expect(styleOfCss("gap: 4px 8px")).toEqual({ rowGap: 4, columnGap: 8 });
  expect(styleOfCss("border-radius: 1px 2px 3px")).toEqual({ borderTopLeftRadius: 1, borderTopRightRadius: 2, borderBottomRightRadius: 3, borderBottomLeftRadius: 2 });
  expect(styleOfCss("border: 2px solid #f00")).toEqual({ ...sides("border", 2, "Width"), borderStyle: "solid", ...sides("border", "#ff0000", "Color") });
  expect(styleOfCss("border-start-start-radius: 4px")).toEqual({ borderStartStartRadius: 4 });
  expect(styleOfCss("flex: 2 1 10px")).toEqual({ flexGrow: 2, flexShrink: 1, flexBasis: 10 });
  expect(styleOfCss("flex: 50%")).toEqual({ flexGrow: 1, flexShrink: 1, flexBasis: "50%" });
  expect(styleOfCss("aspect-ratio: 4 / 3")).toEqual({ aspectRatio: 4 / 3 });
  expect(styleOfCss("background: #fff")).toEqual({ backgroundColor: "#ffffff" });
});

test("values with no React Native counterpart are reported with their property", () => {
  const report = (declaration: string) => convert(`.x { ${declaration} }`).unsupported.map((entry) => entry.property);
  expect(report("display: grid")).toEqual(["display"]);
  expect(report("position: sticky")).toEqual(["position"]);
  expect(report("width: fit-content")).toEqual(["width"]);
  expect(report("color: inherit")).toEqual(["color"]);
  expect(report("padding: 1em")).toEqual(["padding"]);
  expect(report("transform: rotate(10deg)")).toEqual(["transform"]);
  expect(report("text-align: end")).toEqual(["text-align"]);
});

test("letter-spacing and line-height in em, percent, px and rem", () => {
  const rule = (declarations: string) => ruleOf("x", convert(`.x { ${declarations} }`).table);
  expect(rule("letter-spacing: 0.1em").fontRelative).toEqual({ letterSpacing: 0.1 });
  expect(rule("letter-spacing: 1rem").style).toEqual({ letterSpacing: 16 });
  expect(rule("letter-spacing: normal").style).toEqual({ letterSpacing: 0 });
  expect(rule("line-height: 1.5em").fontRelative).toEqual({ lineHeight: 1.5 });
  expect(rule("line-height: 150%").fontRelative).toEqual({ lineHeight: 1.5 });
  expect(rule("line-height: 20px").style).toEqual({ lineHeight: 20 });
});

test("cascade: card in components against border-4 in utilities", () => {
  const card = rulesOf("card")[0] as ClassRule;
  const border = ruleOf("border-4");
  expect(border.order).toBeGreaterThan(card.order);
  expect(card.style).toMatchObject(sides("border", 1, "Width"));
  expect(cascade("card border-4")).toMatchObject(sides("border", 4, "Width"));
  // The same classes in the other order of the markup: the cascade is the table's, not the markup's.
  expect(cascade("border-4 card")).toMatchObject(sides("border", 4, "Width"));
  // Padding from card (16, components) is beaten by `px-2` (utilities) on the sides px-2 sets.
  expect(cascade("card px-2")).toMatchObject({ paddingTop: 16, paddingLeft: 8, paddingRight: 8 });
});

test("resets: the initial value of a property is a null that takes the key away from earlier rules", () => {
  expect(styleOf("shadow-none")).toEqual({ boxShadow: null });
  expect(styleOf("translate-none")).toEqual({ "transform:translateX": null, "transform:translateY": null });
  expect(styleOf("scale-none")).toEqual({ "transform:scaleX": null, "transform:scaleY": null });
  expect(styleOf("rotate-none")).toEqual({ "transform:rotate": null, "transform:rotateX": null, "transform:rotateY": null });
  expect(Object.keys(styleOf("transform-none")).sort()).toEqual(["transform:rotate", "transform:rotateX", "transform:rotateY", "transform:scaleX", "transform:scaleY", "transform:translateX", "transform:translateY"]);
  expect(Object.values(styleOf("transform-none")).every((value) => value === null)).toBe(true);
  expect(styleOf("max-w-none")).toEqual({ maxWidth: null });
  expect(styleOf("max-h-none")).toEqual({ maxHeight: null });
  expect(styleOf("aspect-auto")).toEqual({ aspectRatio: null });
  expect(styleOf("z-auto")).toEqual({ zIndex: null });
  expect(styleOf("leading-[normal]")).toEqual({ lineHeight: null });
  // `border-style: none` draws no border: no style and a width of 0 on every side.
  expect(styleOf("border-none")).toEqual({ borderStyle: null, ...sides("border", 0, "Width") });
  // A reset is not a report.
  for (const name of ["shadow-none", "translate-none", "scale-none", "rotate-none", "transform-none", "max-w-none", "aspect-auto", "border-none"]) expect(unsupportedFor(name)).toEqual([]);
});

test("dark:shadow-none after shadow-md is a rule with a null boxShadow for the dark scheme", () => {
  const [rule] = rulesOf("dark:shadow-none");
  expect(rulesOf("dark:shadow-none")).toHaveLength(1);
  expect(rule).toMatchObject({ when: { scheme: "dark" }, style: { boxShadow: null } });
  expect((rule as ClassRule).order).toBeGreaterThan(ruleOf("shadow-md").order);
  expect(cascade("shadow-md dark:shadow-none", "light").boxShadow).toBe("0px 4px 6px -1px rgba(0, 0, 0, 0.1), 0px 2px 4px -2px rgba(0, 0, 0, 0.1)");
  expect(cascade("shadow-md dark:shadow-none", "dark")).not.toHaveProperty("boxShadow");
});

test("resets in a cascade: translate-none removes both axes, border-none the card's border, a null in a stylesheet of your own", () => {
  expect(cascade("translate-x-2 -translate-y-1 translate-none")).toEqual({});
  // The order is the table's (`translate-none` is after `translate-x-2` in Tailwind's CSS), not the markup's.
  expect(cascade("translate-none translate-x-2")).toEqual({});
  expect(cascade("card border-none")).toMatchObject({ ...sides("border", 0, "Width") });
  expect(cascade("card border-none")).not.toHaveProperty("borderStyle");
  const own = convert(".a { max-width: 100px; line-height: 1.5 } .a-reset { max-width: none; line-height: normal }").table;
  expect(cascade("a a-reset", "light", 400, own)).toEqual({});
  // A reset that comes before a value in the stylesheet does not remove it.
  const before = convert(".a-reset { max-width: none } .a { max-width: 100px }").table;
  expect(cascade("a-reset a", "light", 400, before)).toEqual({ maxWidth: 100 });
});

test("the default of a variable inside a composite is still dropped, and is not a reset", () => {
  // `translate: var(--tw-translate-x) var(--tw-translate-y)` with the second at its default: this class sets one axis only.
  expect(styleOf("translate-x-2")).toEqual({ "transform:translateX": 8 });
  expect(styleOf("border-2")).not.toHaveProperty("borderStyle");
  expect(Object.values(styleOf("scale-x-50"))).not.toContain(null);
});
