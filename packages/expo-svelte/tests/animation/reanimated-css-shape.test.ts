import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// A node with Reanimated CSS keys keeps the plain style that `filterCSSAndStyleProperties` returns last (src/fabric/animation.ts). The tests run on a
// stub of Reanimated (tests/support/reanimated-stubs.ts), so the stub and the declaration must have the vendored copy's shape: with a fifth entry the
// tests passed while a device build, on Reanimated 4.7's four, dropped every style key the CSS keys sat with.
const read = (path: string) => readFileSync(resolve(import.meta.dirname, "../..", path), "utf8");

test("filterCSSAndStyleProperties returns what the vendored Reanimated returns: four entries, the plain style last", () => {
  const source = read("vendor/react-native-reanimated/src/css/utils/props.ts");
  const body = source.slice(source.indexOf("export function filterCSSAndStyleProperties"));
  const returned = /return \[([^\]]*)\];/.exec(body)?.[1]?.split(",").map((entry) => entry.trim()).filter(Boolean);
  expect(returned).toEqual(["finalAnimationConfig", "finalTransitionConfig", "finalPseudoStyles", "filteredStyle"]);
  expect(read("src/fabric/reanimated-internals.d.ts")).toContain(
    "filterCSSAndStyleProperties(style: Record<string, unknown>): [unknown, unknown, unknown, Record<string, unknown>];",
  );
  expect(read("tests/support/reanimated-stubs.ts")).toContain("return [null, null, null, rest];");
  expect(read("src/fabric/animation.ts")).toContain("[filterCSSAndStyleProperties(merged)[3]]");
});
