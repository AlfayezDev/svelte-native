import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { loadOracle, type Oracle } from "./support/oracle.ts";
import { svgWorld, type SvgLoaded } from "./support/harness.ts";
import type { Platform } from "../../support/rn-reference.ts";
import { resolve } from "node:path";

// The harnesses are made in `beforeAll`, outside the per-test restore of `support/preload.ts`: the file puts the global object back when it is done.
const world = svgWorld();
const fixture = (name: string) => resolve(import.meta.dirname, "fixtures", name);

/**
 * What the port keeps of the extractors that are written against React children (`foreign-svg-extract.ts`: fonts and text, gradient stops, filter
 * primitives), run on the same inputs as the library's own functions, which the oracle bundles with React.
 */
const platforms: Platform[] = ["android", "ios"];
type Props = Record<string, unknown>;

const fonts: Props[] = [
  {}, { font: "italic bold 12px Helvetica" }, { font: "bold 12px/1.2 'Foo Bar', serif" }, { font: "12px" }, { font: "normal" }, { font: "???" },
  { fontFamily: '"Helvetica Neue", Arial', fontSize: 12, fontWeight: 600, textAnchor: "middle", letterSpacing: 1, wordSpacing: 2, kerning: 0.5 },
  { font: { fontSize: 3, fontFamily: "Menlo" }, fontSize: 5 }, { font: "italic 9px Georgia", fontStyle: "normal", textDecoration: "underline", fontVariant: "small-caps", fontStretch: "condensed" },
  { fontFeatureSettings: '"liga" 0', fontVariantLigatures: "none", fontVariationSettings: '"wght" 700', fontFamily: "  'A',B " }, { fontSize: null, fontWeight: undefined },
];
const texts: Props[] = [
  {}, { x: 1, y: [2, 3], dx: "4 5", dy: "6,7", rotate: "10", inlineSize: 50, baselineShift: "super", verticalAlign: 3, alignmentBaseline: "middle", fontSize: 12 },
  { x: [1, "2%"], rotate: [1, 2, 3], font: "bold 10px Arial" }, { x: "a b", y: 5 },
];
const stops = (...list: Props[]) => list;
const gradients: { props: Props; stops: Props[] }[] = [
  { props: { id: "g" }, stops: stops({ offset: 0, stopColor: "red" }, { offset: 1, stopColor: "#0000ff", stopOpacity: 0.5 }) },
  { props: { id: "g", gradientUnits: "userSpaceOnUse", gradientTransform: "rotate(30)" }, stops: stops({ offset: "50%", stopColor: "lime" }, { offset: "0%", stopColor: "white" }, { offset: "100%", stopColor: "rgba(0,0,0,0.5)" }) },
  { props: { id: "g", transform: [{ scale: 2 }], rotation: 5 }, stops: stops({ offset: 0.25, style: { stopColor: "#ff00ff", stopOpacity: "0.25" } }, { offset: "bad", stopColor: "red" }, { offset: 0.5, stopColor: "not a colour" }, { stopColor: "#123456" }, {}) },
  { props: { id: "g", x: 4, y: 5, scale: 2 }, stops: stops({ offset: 0.5, stopColor: "red", stopOpacity: "50%" }, { offset: 0.5, stopColor: "blue", stopOpacity: 5 }) },
  { props: { id: "g" }, stops: [] },
  { props: {}, stops: stops({ offset: 0 }) },
];
const filterInputs: Record<string, Props[]> = {
  extractFilter: [{}, { x: 1, y: "2%", width: 3, height: 4, result: "r", in: "x" }],
  extractIn: [{}, { in: "SourceGraphic" }, { in: "" }],
  extractFeBlend: [{}, { in2: "b", mode: "screen" }, { mode: "" }],
  extractFeColorMatrix: [{}, { values: "1 0 0  0 1 0 x", type: "matrix" }, { values: [1, "2", "x"] }, { values: 3 }, { values: { a: 1 } }, { values: "" }, { type: "luminanceToAlpha" }],
  extractFeComposite: [{}, { in: "a", in2: "b", operator: "xor", k1: 1, k2: "2", k3: "x", k4: 0 }],
  extractFeFlood: [{}, { floodColor: "red", floodOpacity: 0.5 }, { floodColor: "", floodOpacity: "20%" }, { floodColor: "not a colour" }, { floodColor: "currentColor" }, { floodColor: 0 }],
  extractFeGaussianBlur: [{}, { stdDeviation: 3 }, { stdDeviation: "4" }, { stdDeviation: "4 5" }, { stdDeviation: [6, "7"] }, { stdDeviation: "x", edgeMode: "wrap" }, { stdDeviation: [] }],
};

// Fonts, text and the merge node do not depend on the platform; a colour does (the integer a platform's native view takes), so the stops of a gradient and the flood of a
// filter run on both, and the rest on Android.
for (const platform of platforms) {
  describe(platform, () => {
    let loaded: SvgLoaded;
    let oracle: Oracle;
    beforeAll(async () => {
      const harness = await world.harness(platform);
      oracle = await loadOracle(platform);
      loaded = await harness.load(fixture("svg-cases-fixture.svelte")) as SvgLoaded;
    }, 60_000);
    const quiet = <T,>(run: () => T): T => {
      const warn = console.warn;
      console.warn = () => {};
      try { return run(); } finally { console.warn = warn; }
    };
    const element = (props: Props) => oracle.create("stop", props);

    if (platform === "android") test("extractFont is the library's on font strings, font objects and the font props", () => {
      for (const props of fonts) expect(loaded.extract.extractFont(props), JSON.stringify(props)).toEqual(oracle.extractFont(props));
    });

    if (platform === "android") test("extractText is the library's, without the children", () => {
      for (const props of texts) {
        const theirs: Props = { ...oracle.extractText(props, true) };
        delete theirs.children;
        expect(loaded.extract.extractText(props), JSON.stringify(props)).toEqual(theirs);
      }
    });

    test("extractGradient is the library's on the stops it is given", () => {
      for (const { props, stops: list } of gradients) {
        const theirs = quiet(() => oracle.extractGradient({ ...props, children: list.map((stop) => element(stop)) }, undefined));
        const ours = quiet(() => loaded.extract.extractGradient(props, list));
        if (theirs === null) { expect(ours).toBeNull(); continue; }
        const rest = { ...(theirs as unknown as Props) };
        delete rest.children;
        expect(ours, JSON.stringify(props)).toEqual(rest);
      }
    });

    test("the filter primitives' extractors are the library's", () => {
      for (const [name, inputs] of Object.entries(filterInputs)) {
        for (const props of inputs) {
          const theirs = quiet(() => (oracle.filters as unknown as Record<string, (props: Props) => unknown>)[name](props));
          const ours = quiet(() => (loaded.extract as unknown as Record<string, (props: Props) => unknown>)[name](props));
          expect(ours, `${name} ${JSON.stringify(props)}`).toEqual(theirs);
        }
      }
    });

    if (platform === "android") test("extractFeMerge names the `in` of each node, empty when it has none", () => {
      const nodes = [{ in: "a" }, {}, { in: "SourceGraphic" }];
      const theirs = (oracle.filters.extractFeMerge as unknown as (props: Props, parent: unknown) => unknown)({ children: nodes.map((node) => oracle.create("feMergeNode", node)) }, undefined);
      expect(loaded.extract.extractFeMerge(nodes.map((node) => (node as { in?: string }).in))).toEqual(theirs);
    });
  });
}

afterAll(() => world.restore());
