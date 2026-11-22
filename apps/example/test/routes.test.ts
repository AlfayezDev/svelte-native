import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { coreFeatures } from "../src/lib/features/core.ts";
import { groups, type Feature } from "../src/lib/features/feature.ts";
import { nativeFeatures } from "../src/lib/features/native.ts";

/**
 * The home screen lists what the two registries (`src/lib/features/core.ts` and `native.ts`) say, and a screen exists only as a folder of
 * `src/routes`. These tests keep the two together: every route of the app is listed in a registry, and every listed route is a folder.
 * They also keep the screens short and made of the library's public entries only.
 */
const app = join(import.meta.dirname, "..");
const routesRoot = join(app, "src/routes");
const features: Feature[] = [...coreFeatures, ...nativeFeatures];

/** `/layout`, `/navigation/tabs/feed`, `/navigation/stack/[id]`: the folder's path without its route groups, for every folder that is a screen. */
function routesOnDisk(): string[] {
  const routes = new Set<string>();
  for (const entry of readdirSync(routesRoot, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const folder = entry.parentPath.slice(routesRoot.length).split("/").filter((part) => part !== "" && !part.startsWith("("));
    const route = `/${folder.join("/")}`;
    if (entry.name === "+mobile.svelte") routes.add(route);
    // A layout that exports `navigator` is a screen of its parent (a tab bar, a nested stack); any other layout only wraps screens.
    if (entry.name === "+layout.mobile.svelte" && /export const navigator = "(?:tabs|stack)"/.test(readFileSync(join(entry.parentPath, entry.name), "utf8"))) routes.add(route);
  }
  routes.delete("/");
  return [...routes].sort();
}

const routeFiles = (): string[] => (readdirSync(routesRoot, { recursive: true, withFileTypes: true }))
  .filter((entry) => entry.isFile() && entry.name.endsWith(".svelte"))
  .map((entry) => join(entry.parentPath, entry.name));

describe("the feature registries", () => {
  const listed = features.flatMap((feature) => [feature.route, ...(feature.also ?? [])]);

  test("every route of src/routes is listed in a registry, once", () => {
    expect(listed.toSorted()).toEqual(routesOnDisk());
  });

  test("every listed route is a folder of src/routes (the home screen is the one route that is not listed)", () => {
    const onDisk = new Set(routesOnDisk());
    expect(listed.filter((route) => !onDisk.has(route))).toEqual([]);
  });

  test("an entry has a title, a one-line summary and a known group, and no two entries share a title", () => {
    for (const feature of features) {
      expect([feature.route, feature.title.trim().length > 0]).toEqual([feature.route, true]);
      expect([feature.route, feature.summary.trim().length > 0 && !feature.summary.includes("\n")]).toEqual([feature.route, true]);
      expect([feature.route, (groups as readonly string[]).includes(feature.group)]).toEqual([feature.route, true]);
    }
    const titles = features.map((feature) => feature.title);
    expect(new Set(titles).size).toBe(titles.length);
  });
});

describe("the screens", () => {
  /** The library's entries an app is meant to import (`packages/expo-svelte/README.md`): not `/app`, `/core` or `/renderer`, which are its inside. */
  const publicEntries = ["expo-svelte", "expo-svelte/router", "expo-svelte/foreign", "expo-svelte/updates", "expo-svelte/remote", "expo-svelte/platform"];
  const sourceFiles = (): string[] => readdirSync(join(app, "src"), { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.(?:svelte|ts)$/.test(entry.name))
    .map((entry) => join(entry.parentPath, entry.name));

  test("a screen is short: the route files stay under 140 lines", () => {
    const long = routeFiles().map((file) => [file.slice(app.length + 1), readFileSync(file, "utf8").split("\n").length] as const).filter(([, lines]) => lines > 140);
    expect(long).toEqual([]);
  });

  test("the app imports only the library's public entries, and nothing from the QA app or the lab", () => {
    for (const file of sourceFiles()) {
      const source = readFileSync(file, "utf8");
      const specifiers = [...source.matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)].map((match) => match[1] ?? "");
      for (const specifier of specifiers) {
        const where = `${file.slice(app.length + 1)}: ${specifier}`;
        if (specifier.startsWith("expo-svelte")) expect([where, publicEntries.includes(specifier)]).toEqual([where, true]);
        expect([where, /apps\/qa|__dev|packages\/expo-svelte/.test(specifier)]).toEqual([where, false]);
      }
    }
  });
});
