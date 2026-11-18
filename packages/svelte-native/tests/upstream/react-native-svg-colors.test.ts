import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "bun:test";
import { vendorRoot } from "../support/paths.ts";

/**
 * A colour in `animatedProps` reaches react-native-svg's native views as the platform's ARGB integer (`foreign/svg/colors.test.ts` runs Reanimated's `processColorsInProps` on our elements).
 * That the library's views read a number as a solid colour is a property of the library's Java and Objective-C, which this reads as text: a change to it fails here until the colours are looked at again.
 */
const modules = vendorRoot;

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
