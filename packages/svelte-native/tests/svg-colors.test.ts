import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "bun:test";
import { find, type FakeNode } from "./foreign-harness.ts";
import { settle, svgHarness, type SvgLoaded } from "./svg-harness.ts";
import type { AnimLog } from "./reanimated-stubs.ts";
import { importWithReactNative, type Platform } from "./rn-reference.ts";

/**
 * A colour in `animatedProps` (SPEC.md, "react-native-svg", Animation). Reanimated 4.5.1's `updateProps` runs `processColorsInProps` on animated props
 * (`updateProps.ts`), which turns a CSS string or an RGBA number into the platform's ARGB integer and throws "Invalid color value" for anything else, such as
 * the `{ type: 0, payload }` the library sends for a brush. The tests below run that function itself (not a stub) on the colour props of our elements.
 */
const modules = resolve(import.meta.dirname, "../../../node_modules");
const anim = () => (globalThis as { __anim: AnimLog }).__anim;
type Shared<T> = { value: T; _isReanimatedSharedValue: true };
const shared = <T>(value: T): Shared<T> => ({ value, _isReanimatedSharedValue: true });

const colors = ["#00f", "red", "#ff8000", "rgba(0, 128, 255, 0.5)", "hsl(120, 100%, 25%)", "transparent", "rebeccapurple", "#11223344"];

async function mount(platform: Platform, root: number) {
  const fill = shared<string>("red");
  const flood = shared<string>("#00ff00");
  const harness = await svgHarness(platform, { colors: true });
  const loaded = await harness.load("svg-colors-fixture.svelte") as SvgLoaded;
  loaded.startSurface(root, loaded.Fixture, { fill, flood });
  // React Native's own `processColor`, which is what the library's `extractBrush` puts in `payload`.
  const { processColor } = await importWithReactNative<{ processColor(color: unknown): number }>(platform, `export { default as processColor } from "react-native/Libraries/StyleSheet/processColor";`);
  const tree = () => harness.roots()[root] ?? [];
  return { fill, flood, loaded, harness, processColor, node: (name: string) => find(tree(), name)[0] as FakeNode };
}

for (const platform of ["android", "ios"] as const) {
  test(`${platform}: the first values and every write carry the integer the library's own brush would (processColor's), not the string the worklet returned`, async () => {
    const { fill, flood, loaded, harness, processColor, node } = await mount(platform, platform === "android" ? 160 : 161);
    // What the library sends for the same colour: `fill={{ type: 0, payload: processColor(c) }}` (extractBrush), whose `payload` is the integer the native view takes.
    const payloadOf = (color: string) => processColor(color);
    expect(node("RNSVGCircle").props.fill).toBe(payloadOf("red"));
    expect(node("RNSVGCircle").props.stroke).toBe(payloadOf("#0000ff"));
    expect(node("RNSVGFeFlood").props.floodColor).toBe(payloadOf("#00ff00"));
    expect(typeof node("RNSVGCircle").props.fill).toBe("number");

    const A = anim();
    const mapperOf = (index: number) => A.mappers.filter((entry) => !entry.stopped)[index];
    const circleMapper = A.mappers.filter((entry) => !entry.stopped).length - 2;
    for (const color of colors) {
      A.updates.length = 0;
      fill.value = color;
      flood.value = color;
      mapperOf(circleMapper)?.worklet();
      mapperOf(circleMapper + 1)?.worklet();
      expect(Object.assign({}, ...A.updates.map((update) => update.values)), color).toEqual({ fill: payloadOf(color), stroke: payloadOf("#0000ff"), r: 3, floodColor: payloadOf(color) });
      expect(A.updates.every((update) => update.animatedProps), color).toBe(true);
    }
    // The signed integer Android's `Dynamic.asInt()` reads; the unsigned one on iOS (`RNSVGColor:`).
    expect(payloadOf("red")).toBe(platform === "android" ? -65536 : 0xffff0000);
    void harness; void loaded;
  });
}

test("the shape the docs used to give, { type: 0, payload }, throws in Reanimated's processColorsInProps; an ARGB number is not what it takes either (a number is RGBA)", async () => {
  const { loaded } = await mount("android", 162);
  const { processColorsInProps } = loaded.colors;
  expect(() => processColorsInProps({ fill: { type: 0, payload: 0xffff0000 } })).toThrow("Invalid color value");
  // A number is read as 0xRRGGBBAA: opaque red is 0xff0000ff there, and 0xffff0000 (ARGB) is a transparent-ish yellow.
  const red: Record<string, unknown> = { fill: 0xff0000ff };
  processColorsInProps(red);
  expect(red.fill).toBe(-65536);
  const argb: Record<string, unknown> = { fill: 0xffff0000 };
  processColorsInProps(argb);
  expect(argb.fill).not.toBe(-65536);
  // Only the colour props are touched: the rest of the animated props go through as they are.
  const mixed: Record<string, unknown> = { r: 4, d: "M0 0", fill: "red", opacity: 0.5 };
  processColorsInProps(mixed);
  expect(mixed).toEqual({ r: 4, d: "M0 0", fill: -65536, opacity: 0.5 });
});

test("the native views take that integer: RenderableView.setFill/setStroke and FeFlood.setFloodColor read a number, and iOS's RNSVGBrush converts an NSNumber", () => {
  const library = resolve(modules, "react-native-svg");
  const read = (file: string) => (existsSync(resolve(library, file)) ? readFileSync(resolve(library, file), "utf8") : "");
  const java = (name: string, method: string) => {
    const source = read(`android/src/main/java/com/horcrux/svg/${name}.java`);
    const start = source.indexOf(`public void ${method}(@Nullable Dynamic`);
    expect(start, `${name}.${method}(Dynamic)`).toBeGreaterThan(-1);
    return source.slice(start, source.indexOf("\n  }\n", start));
  };
  // A number becomes `[0, asInt()]`, the solid colour of `{ type: 0, payload }`.
  expect(java("RenderableView", "setFill")).toMatch(/ReadableType\.Number\)\) \{\s*this\.fill = JavaOnlyArray\.of\(0, fill\.asInt\(\)\)/);
  expect(java("RenderableView", "setStroke")).toMatch(/ReadableType\.Number\)\) \{\s*stroke = JavaOnlyArray\.of\(0, strokeColors\.asInt\(\)\)/);
  expect(java("FeFloodView", "setFloodColor")).toMatch(/ReadableType\.Number\)\) \{\s*floodColor = JavaOnlyArray\.of\(0, color\.asInt\(\)\)/);
  const convert = read("apple/Utils/RCTConvert+RNSVG.mm");
  expect(convert).toMatch(/\[json isKindOfClass:\[NSNumber class\]\]\) \{\s*return \[\[RNSVGSolidColorBrush alloc\] initWithNumber:json\]/);
  // The Fabric props that carry these colours are the library's `UnsafeMixed<ColorValue | ColorStruct>`: a number reaches the views unparsed.
  expect(read("src/fabric/PathNativeComponent.ts")).toContain("fill?: UnsafeMixed<ColorValue | ColorStruct>");
  expect(read("src/fabric/FeFloodNativeComponent.ts")).toContain("floodColor?: UnsafeMixed<ColorValue | ColorStruct>");
});
