import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { demos } from "../src/lib/features/demos.ts";
import { coreFeatures } from "../src/lib/features/core.ts";
import { nativeFeatures } from "../src/lib/features/native.ts";

/**
 * The demo manifest (`src/lib/features/demos.ts`) says which docs page each recording is for. These tests keep it in step with the docs, the
 * registries and the screens: a page or a route it names exists, every screen that has a script is in it, and a recording is 6 to 12 seconds.
 */
const app = join(import.meta.dirname, "..");
const docs = join(app, "../../docs");
const routesRoot = join(app, "src/routes");

/** The routes whose screen calls `useDemo`: `/layout`, `/native-views/blur`, `/navigation/tabs/feed`. */
function scriptedRoutes(): string[] {
  const routes: string[] = [];
  for (const entry of readdirSync(routesRoot, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !/^\+(?:layout\.)?mobile\.svelte$/.test(entry.name)) continue;
    if (!readFileSync(join(entry.parentPath, entry.name), "utf8").includes("useDemo(")) continue;
    routes.push(`/${entry.parentPath.slice(routesRoot.length + 1)}`);
  }
  return routes.sort();
}

describe("the demo manifest", () => {
  const listed = new Set([...coreFeatures, ...nativeFeatures].flatMap((feature) => [feature.route, ...(feature.also ?? [])]));

  test("names a docs page that exists and a route of the app, once each", () => {
    for (const demo of demos) {
      if (demo.doc !== null) expect([demo.doc, existsSync(join(docs, demo.doc))]).toEqual([demo.doc, true]);
      expect([demo.route, listed.has(demo.route)]).toEqual([demo.route, true]);
    }
    const pairs = demos.map((demo) => `${demo.doc} ${demo.route}`);
    expect(new Set(pairs).size).toBe(pairs.length);
  });

  test("has an entry for every screen that has a script, and a script for every entry", () => {
    expect([...new Set(demos.map((demo) => demo.route))].sort()).toEqual(scriptedRoutes());
  });

  test("a recording is 6 to 12 seconds, and every entry says what it shows", () => {
    for (const demo of demos) {
      expect([demo.route, demo.durationMs >= 6000 && demo.durationMs <= 12000]).toEqual([demo.route, true]);
      expect([demo.route, demo.notes.trim().length > 0]).toEqual([demo.route, true]);
    }
  });

  test("the same route has the same recording for every page that uses it", () => {
    for (const demo of demos) {
      const same = demos.filter((other) => other.route === demo.route);
      expect(same.map((other) => other.durationMs)).toEqual(same.map(() => demo.durationMs));
      expect(same.map((other) => other.touch ?? false)).toEqual(same.map(() => demo.touch ?? false));
    }
  });

  test("a recording that needs touch input describes the touches, inside the recording, in fractions of the screen", () => {
    for (const demo of demos) {
      expect([demo.route, demo.touch === true, (demo.touches?.length ?? 0) > 0]).toEqual([demo.route, demo.touch === true, demo.touch === true]);
      for (const touch of demo.touches ?? []) {
        expect([demo.route, touch.at >= 0 && touch.at + touch.durationMs <= demo.durationMs]).toEqual([demo.route, true]);
        expect(touch.fingers.length).toBeGreaterThan(0);
        for (const finger of touch.fingers) for (const point of [...finger.from, ...finger.to]) expect([demo.route, point >= 0 && point <= 1]).toEqual([demo.route, true]);
      }
    }
  });

  test("the screen with nothing to play (a host the build does not have) has no script", () => {
    expect(scriptedRoutes().includes("/remote")).toBe(false);
  });
});
