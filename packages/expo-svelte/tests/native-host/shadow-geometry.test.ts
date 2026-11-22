import { readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { expect, test } from "bun:test";
import { createHarness, find, settle } from "../foreign/support/harness.ts";
import { cppHost } from "../support/native-host.ts";
import { nodeModules } from "../support/paths.ts";

/**
 * `ShadowedView` on Android (SPEC.md, "Six more native-view libraries"): the container keeps the border widths, so the native `FastShadowView` that paints the
 * box fills the container's border box, and Yoga puts an absolute child inside the container's padding box, inset by those widths. The native view is placed
 * with negative insets equal to the widths, and this test asks Yoga itself (React Native's `ReactCommon/yoga`, compiled for the host with `g++` as the
 * navigation records test compiles its encoder) where the view lands for each way of spelling a border: it must cover the whole border box.
 */
const yoga = resolve(nodeModules, "react-native/ReactCommon/yoga");
const driver = resolve(import.meta.dirname, "fixtures/yoga-host.cpp");
const fixture = resolve(import.meta.dirname, "fixtures/shadow-geometry-fixture.svelte");
const sources = (directory: string): string[] => readdirSync(directory).flatMap((name) => {
  const path = join(directory, name);
  return statSync(path).isDirectory() ? sources(path) : path.endsWith(".cpp") ? [path] : [];
});

let host: ReturnType<typeof cppHost> | undefined;
const yogaHost = () => (host ??= cppHost({ name: "yoga-host", sources: [...sources(join(yoga, "yoga")), driver], flags: ["-std=c++20", "-O0", "-I", yoga] }));

const borderKeys = ["borderWidth", "borderLeftWidth", "borderRightWidth", "borderTopWidth", "borderBottomWidth", "borderStartWidth", "borderEndWidth"] as const;
const size = { width: 100, height: 50 };

type Case = { name: string; style: Record<string, unknown>; rtl?: boolean };
const cases: Case[] = [
  { name: "no border", style: {} },
  { name: "borderWidth", style: { borderWidth: 3 } },
  { name: "borderWidth 0", style: { borderWidth: 0, borderTopWidth: 2 } },
  { name: "four sides", style: { borderTopWidth: 1, borderRightWidth: 2, borderBottomWidth: 3, borderLeftWidth: 4 } },
  { name: "a side over the width", style: { borderWidth: 2, borderTopWidth: 6, borderLeftWidth: 0 } },
  { name: "start and end, left to right", style: { borderStartWidth: 5, borderEndWidth: 2 } },
  { name: "start and end, right to left", style: { borderStartWidth: 5, borderEndWidth: 2 }, rtl: true },
  { name: "start over left, left to right", style: { borderLeftWidth: 1, borderStartWidth: 7, borderRightWidth: 2, borderEndWidth: 4 } },
  { name: "start over left, right to left", style: { borderLeftWidth: 1, borderStartWidth: 7, borderRightWidth: 2, borderEndWidth: 4 }, rtl: true },
  { name: "start with the width", style: { borderWidth: 2, borderStartWidth: 6 }, rtl: true },
  { name: "end with the width", style: { borderWidth: 2, borderEndWidth: 6 } },
  // The widths of the block edges and the colours are painted by the native view and take no room in Yoga.
  { name: "block widths and colours", style: { borderBlockWidth: 4, borderBlockStartWidth: 5, borderColor: "#cccccc", borderLeftWidth: 1 } },
];

const number = (value: unknown) => (typeof value === "number" ? String(value) : "-");

for (const { name, style, rtl = false } of cases) {
  test(`the native view covers the container's border box: ${name}`, async () => {
    const harness = createHarness("android", { natives: { rtl } });
    const loaded = await harness.load(fixture);
    loaded.startSurface(rtl ? 91 : 90, loaded.Fixture, { style: { ...size, backgroundColor: "#ffffff", shadowColor: "#000000", shadowOpacity: 0.3, ...style } });
    await settle(loaded);
    const roots = harness.roots()[rtl ? 91 : 90] ?? [];
    const container = find(roots, "RCTView")[0];
    const box = find(roots, "FastShadowView")[0];
    expect(container && box, "both views are mounted").toBeTruthy();
    // What Yoga lays the container out with: the widths the payload carries, in Yoga's order of edges.
    const widths = borderKeys.map((key) => number(container?.props[key]));
    const line = [rtl ? "rtl" : "ltr", size.width, size.height, ...widths, ...(["left", "top", "right", "bottom"] as const).map((edge) => number(box?.props[edge]))].join(" ");
    const [left, top, width, height] = yogaHost().run(`${line}\n`).trim().split(" ").map(Number);
    expect({ left, top, width, height }, line).toEqual({ left: 0, top: 0, width: size.width, height: size.height });
  }, 60_000);
}
