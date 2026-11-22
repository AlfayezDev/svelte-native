import { test, expect } from "bun:test";
import { build, type Metafile } from "esbuild";
import { resolve } from "node:path";
import { packageRoot, vendoredAliases } from "../support/paths.ts";
import { hostPlugin, load, settle, anim } from "./support/harness.ts";

/**
 * The cost of the gesture host when it is not used, and what it is allowed to import when it is.
 * Metro includes every `require` target in the bundle and evaluates it on first use, so what decides the boot cost is the set of
 * modules a bundle's entry reaches through ES `import` statements (evaluated at start) against `require` calls (evaluated when reached).
 */
const root = packageRoot;
const src = (path: string) => resolve(root, "src", path);

/** The import graph of an entry, built once per run: three tests read the gestures entry's. */
const graphs = new Map<string, Promise<Metafile>>();
function graph(entry: string): Promise<Metafile> {
  let built = graphs.get(entry);
  if (!built) {
    built = build({
      entryPoints: [entry], bundle: true, format: "esm", platform: "neutral", conditions: ["browser"], mainFields: ["main"], write: false, metafile: true, logLevel: "silent",
      alias: vendoredAliases, define: { __DEV__: "true" }, plugins: [hostPlugin({ openStubs: true })],
    }).then((result) => result.metafile);
    graphs.set(entry, built);
  }
  return built;
}
const relative = (path: string) => path.replace(/.*\/packages\/expo-svelte\//, "").replace(/(?:.*\/)?vendor\/react-native-gesture-handler\/src\//, "rngh/");

/** Everything reachable from the entry, optionally only through ES `import` statements (what evaluates at start). */
function reachable(meta: Metafile, entry: string, only?: "import-statement"): string[] {
  const key = Object.keys(meta.inputs).find((path) => resolve(root, path) === entry) as string;
  const seen = new Set<string>([key]);
  const queue = [key];
  while (queue.length) {
    for (const edge of meta.inputs[queue.pop() as string]?.imports ?? []) {
      // `external` edges are the type-only imports TypeScript drops (`import { GestureType } from './gesture'`): nothing is loaded for them.
      if (edge.external || (only && edge.kind !== only) || seen.has(edge.path)) continue;
      seen.add(edge.path);
      queue.push(edge.path);
    }
  }
  return [...seen].map(relative).sort();
}
const gestureCode = (path: string) => path.startsWith("src/gestures/") || path === "src/fabric/gestures.ts" || path.startsWith("rngh/");

test("the Fabric host reaches the gesture host through `require` only: nothing of it evaluates at start", async () => {
  const meta = await graph(src("fabric/host.ts"));
  expect(reachable(meta, src("fabric/host.ts"), "import-statement").filter(gestureCode)).toEqual([]);
  expect(reachable(meta, src("fabric/host.ts")).filter((path) => path === "src/fabric/gestures.ts")).toEqual(["src/fabric/gestures.ts"]);
});

test("neither the Fabric entry nor the animation entry import the gesture host or RNGH at start", async () => {
  for (const entry of ["fabric/index.ts", "animation.ts"]) {
    const meta = await graph(src(entry));
    expect(reachable(meta, src(entry), "import-statement").filter(gestureCode), entry).toEqual([]);
  }
});

test("the package entry re-exports the gestures: at start it imports what the gestures entry does (the sugar and five constants), and not the gesture host or any builder", async () => {
  const gestures = reachable(await graph(src("gestures/index.ts")), src("gestures/index.ts"), "import-statement").filter(gestureCode);
  const main = reachable(await graph(src("index.ts")), src("index.ts"), "import-statement").filter(gestureCode);
  expect(main).toEqual(gestures);
  expect(main.filter((path) => path === "src/fabric/gestures.ts" || path.startsWith("rngh/handlers/") || path === "rngh/mountRegistry.ts")).toEqual([]);
});

test("the public entry imports no builders at start: only RNGH's five constants and the sugar", async () => {
  const meta = await graph(src("gestures/index.ts"));
  const atStart = reachable(meta, src("gestures/index.ts"), "import-statement");
  expect(atStart.filter((path) => path.startsWith("rngh/"))).toEqual(["rngh/ActionType.ts", "rngh/Directions.ts", "rngh/PointerType.ts", "rngh/State.ts", "rngh/TouchEventType.ts"]);
  expect(atStart.filter((path) => path.startsWith("src/gestures/") || path === "src/fabric/gestures.ts").sort()).toEqual(["src/gestures/action.ts", "src/gestures/constants.js", "src/gestures/index.ts"]);
  expect(atStart.filter((path) => /^stub:react-native-(reanimated|worklets)/.test(path))).toEqual([]);
});

test("what the gesture host imports: RNGH's 22 pure modules, no component, no createHandler, no Reanimated wrapper, no react-native but through deps-rn", async () => {
  for (const entry of ["gestures/index.ts", "fabric/gestures.ts"]) {
    const meta = await graph(src(entry));
    const all = reachable(meta, src(entry));
    const upstream = all.filter((path) => path.startsWith("rngh/")).map((path) => path.slice(5));
    expect(upstream, entry).toEqual([
      "ActionType.ts", "Directions.ts", "PointerType.ts", "State.ts", "TouchEventType.ts", "handlers/getNextHandlerTag.ts", "handlers/gestures/flingGesture.ts",
      "handlers/gestures/forceTouchGesture.ts", "handlers/gestures/gesture.ts", "handlers/gestures/gestureComposition.ts", "handlers/gestures/gestureObjects.ts",
      "handlers/gestures/hoverGesture.ts", "handlers/gestures/longPressGesture.ts", "handlers/gestures/manualGesture.ts", "handlers/gestures/nativeGesture.ts",
      "handlers/gestures/panGesture.ts", "handlers/gestures/pinchGesture.ts", "handlers/gestures/rotationGesture.ts", "handlers/gestures/tapGesture.ts",
      "handlers/handlersRegistry.ts", "mountRegistry.ts", "utils.ts",
    ].sort());
    expect(upstream).toHaveLength(22);
    expect(all.filter((path) => /createHandler|rngh\/components\/|reanimatedWrapper|eventReceiver|gestureStateManager|GestureDetector\/|findNodeHandle|rngh\/index|[A-Za-z]GestureHandler\.tsx?$/.test(path)), entry).toEqual([]);
    // `react-native` itself (its `Libraries/...` modules) is imported from deps-rn.ts alone, which loads them on first use.
    const importers = Object.entries(meta.inputs).filter(([, input]) => input.imports.some((edge) => /^stub:react-native(\/|$)/.test(edge.path))).map(([path]) => relative(path));
    expect(importers, entry).toEqual(entry === "fabric/gestures.ts" ? ["src/fabric/deps-rn.ts"] : []);
  }
});

test("an app that never uses a gesture does not load the gesture host, RNGH or Reanimated, and the boot summary has no gestures phase", async () => {
  const m = await load({ fixture: "gesture-fixture.svelte" });
  // The bundle imported the public entry, which evaluated: it loads nothing.
  expect(anim()).toBeUndefined();
  m.startSurface(81, m.Fixture, {});
  await settle(m);
  expect(m.fabricStats().gesturesLoaded).toBe(false);
  expect(m.fabricStats().animationLoaded).toBe(false);
  expect(m.bootSummary()).not.toContain("gestures");
  expect(anim()).toBeUndefined();
});

test("the first read of a Gesture property loads the builders and Reanimated; the first node with a gesture loads the host", async () => {
  const m = await load({ fixture: "gesture-fixture.svelte" });
  expect(anim()).toBeUndefined();
  const app = m.startSurface(82, m.Fixture, {}) as unknown as { set(items: unknown[]): void };
  const G = m.gestures.Gesture;
  expect(anim()).toBeUndefined(); // naming the export reads nothing
  const pan = G.Pan();
  expect(anim()).toBeDefined(); // Reanimated's module evaluated with the first property read
  expect(m.gestures.State.ACTIVE).toBe(4);
  expect("ForceTouch" in G).toBe(false);
  expect(m.fabricStats().gesturesLoaded).toBe(false);
  app.set([{ id: "a", gesture: pan }]);
  await settle(m);
  expect(m.fabricStats().gesturesLoaded).toBe(true);
  expect(m.bootSummary()).toContain("gestures");
});
