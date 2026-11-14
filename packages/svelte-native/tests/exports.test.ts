import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import ts from "typescript";
import { animation as removedAnimation, fabric as removedFabric, gestures as removedGestures, keptEntries, nativeModules as removedNativeModules, removedEntries, removedSpecifiers, svg as removedSvg, svgRenamed } from "./removed-entries.ts";

/**
 * What the package's entries export, read from the sources (no bundler, no device): the main entry carries what `/animation`, `/gestures` and `/svg` exported (and
 * 0.4.0-rc.7 removed), `/platform` has the two native module lookups, and `/app` is the one import of the generated entry. `removed-entries.ts` lists the removed paths and
 * their names; `exports-runtime.test.ts` loads the entries and compares what they export.
 */
const root = resolve(import.meta.dirname, "..");
const src = (path: string) => join(root, "src", path);
const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { exports: Record<string, string | Record<string, string>>; peerDependencies: Record<string, string>; peerDependenciesMeta: Record<string, { optional?: boolean }> };

type Names = { values: Set<string>; types: Set<string> };
const all = (names: Names): string[] => [...names.values, ...names.types].sort();

/** The names a module exports, following `export *` into other TypeScript files (a `default` is not carried by `export *`). `skip` leaves out the files it names. */
function exportsOf(file: string, skip: readonly string[] = []): Names {
  const found: Names = { values: new Set(), types: new Set() };
  const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.ES2022, true);
  const add = (name: string, type: boolean) => (type ? found.types : found.values).add(name);
  for (const statement of source.statements) {
    if (ts.isExportDeclaration(statement)) {
      const specifier = statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier) ? statement.moduleSpecifier.text : undefined;
      if (statement.exportClause && ts.isNamedExports(statement.exportClause)) {
        for (const element of statement.exportClause.elements) add(element.name.text, statement.isTypeOnly || element.isTypeOnly);
      } else if (specifier !== undefined) {
        const target = resolve(dirname(file), specifier);
        if (skip.includes(target) || !existsSync(target) || !/\.ts$/.test(target)) continue;
        const inner = exportsOf(target, skip);
        for (const name of inner.values) if (name !== "default") add(name, statement.isTypeOnly);
        for (const name of inner.types) add(name, true);
      }
      continue;
    }
    if (!ts.canHaveModifiers(statement) || !ts.getModifiers(statement)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) continue;
    if (ts.getModifiers(statement)?.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword)) { found.values.add("default"); continue; }
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) if (ts.isIdentifier(declaration.name)) found.values.add(declaration.name.text);
    } else if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) && statement.name) {
      found.values.add(statement.name.text);
    } else if ((ts.isTypeAliasDeclaration(statement) || ts.isInterfaceDeclaration(statement)) && statement.name) {
      found.types.add(statement.name.text);
    }
  }
  return found;
}

/** The SVG elements the main entry names differently from react-native-svg (and from the `/svg` entry that was removed): the views' names, and the names of `/foreign`'s components. */
const renamed = { SvgText: "Text", SvgImage: "Image", SvgLinearGradient: "LinearGradient", SvgMarker: "Marker" } as const;
const main = exportsOf(src("index.ts"));
const animation = exportsOf(src("animation.ts"));
const gestures = exportsOf(src("gestures/index.ts"));
const svg = exportsOf(src("svg.ts"));

describe("the main entry exports the animation, the gestures, the SVG components and BlurView", () => {
  test("everything `/animation`, `/gestures` and `/svg` export is there, under the same name and kind (the four SVG elements whose names clash are SvgText, SvgImage, SvgLinearGradient and SvgMarker)", () => {
    for (const [group, names] of [["animation", animation], ["gestures", gestures], ["svg", svg]] as const) {
      for (const name of names.values) expect([group, name, main.values.has(name)]).toEqual([group, name, true]);
      for (const name of names.types) expect([group, name, main.types.has(name)]).toEqual([group, name, true]);
    }
    expect(animation.values.size + animation.types.size).toBe(15);
    expect(svg.values.size + svg.types.size).toBe(34 + 2 + 8);
    expect(["Svg", "SvgText", "SvgImage", "SvgXml", "SvgUri", "withSpring", "withTiming", "createSharedValue", "AnimatedView", "Gesture", "GestureDetector", "gesture", "runOnJS", "BlurView"].filter((name) => !main.values.has(name))).toEqual([]);
    expect([main.types.has("SharedValue"), main.types.has("SvgHandle"), main.types.has("GestureType")]).toEqual([true, true, true]);
  });

  test("react-native-svg's Text, Image, LinearGradient and Marker are SvgText, SvgImage, SvgLinearGradient and SvgMarker in the main entry; no SVG export is called by a view's or a `/foreign` component's name", () => {
    for (const [name, old] of Object.entries(renamed)) expect([name, svg.values.has(name), svg.values.has(old)]).toEqual([name, true, false]);
    expect(svg.values.has("default")).toBe(false);
    expect([main.values.has("Text"), main.values.has("Image")]).toEqual([true, true]);
    // Text and Image of the main entry are the views of core.ts, not the SVG elements.
    expect(readFileSync(src("core.ts"), "utf8")).toContain('export { default as Text } from "./components/Text.svelte";');
    expect(readFileSync(src("svg.ts"), "utf8")).toContain('export { default as SvgText } from "./components/svg/Text.svelte";');
    expect(readFileSync(src("svg.ts"), "utf8")).toContain('export { default as SvgLinearGradient } from "./components/svg/LinearGradient.svelte";');
    expect(readFileSync(src("svg.ts"), "utf8")).toContain('export { default as SvgMarker } from "./components/svg/Marker.svelte";');
  });

  test("the main entry exports no name that `/foreign` exports for another component (BlurView, which both export, is one component)", () => {
    const foreign = exportsOf(src("foreign.ts"));
    const shared = (a: Names, b: Names) => [...a.values].filter((name) => b.values.has(name));
    expect(shared(main, foreign)).toEqual(["BlurView"]);
    const line = 'export { default as BlurView } from "./components/BlurView.svelte";';
    expect([readFileSync(src("index.ts"), "utf8").includes(line), readFileSync(src("foreign.ts"), "utf8").includes(line)]).toEqual([true, true]);
    // The types too: a type of the same name from two entries is as confusing as a component.
    expect([...main.types].filter((name) => foreign.types.has(name))).toEqual([]);
  });

  test("no name is exported twice with two meanings: the groups share nothing, but the two worklets exports the gestures entry takes from the animation module", () => {
    const rest = exportsOf(src("index.ts"), [src("animation.ts"), src("gestures/index.ts"), src("svg.ts")]);
    const shared = (a: Names, b: Names) => all(a).filter((name) => all(b).includes(name));
    expect([shared(rest, animation), shared(rest, gestures), shared(rest, svg), shared(animation, svg), shared(gestures, svg)]).toEqual([[], [], [], [], []]);
    expect(shared(animation, gestures)).toEqual(["runOnJS", "scheduleOnRN"]);
    expect(readFileSync(src("gestures/index.ts"), "utf8")).toContain('export { runOnJS, scheduleOnRN } from "../animation.ts";');
  });

  test("BlurView is the library's own: the main entry and `/foreign` export the same component", () => {
    const line = 'export { default as BlurView } from "./components/BlurView.svelte";';
    expect(readFileSync(src("index.ts"), "utf8")).toContain(line);
    expect(readFileSync(src("foreign.ts"), "utf8")).toContain(line);
  });
});

describe("the entries 0.4.0-rc.7 deprecated are removed, and what they exported is exported by the entries that stay", () => {
  const app = exportsOf(src("app.ts"));
  const platform = exportsOf(src("platform.ts"));
  const has = (names: Names, wanted: { values: readonly string[]; types: readonly string[] }) =>
    [...wanted.values.filter((name) => !names.values.has(name)), ...wanted.types.filter((name) => !names.types.has(name)).map((name) => `type ${name}`)];

  test("none of them is in the exports map, and an import of one does not resolve (from the package and from an app that depends on it)", () => {
    expect(removedEntries).toHaveLength(8);
    for (const name of removedEntries) expect([name, Object.keys(manifest.exports).includes(name)]).toEqual([name, false]);
    expect(existsSync(src("deprecated"))).toBe(false);
    for (const dir of [root, resolve(root, "../../apps/example")]) {
      for (const specifier of removedSpecifiers) expect(() => Bun.resolveSync(specifier, dir), specifier).toThrow(/Cannot find module/);
    }
  });

  test("the other entries are all still there", () => {
    expect(Object.keys(manifest.exports)).toEqual(expect.arrayContaining([...keptEntries]));
    for (const name of keptEntries) expect(() => Bun.resolveSync(name === "." ? "@alfayez/svelte-native" : `@alfayez/svelte-native/${name.slice(2)}`, root), name).not.toThrow();
  });

  test("`/animation`, `/gestures` and `/svg` are the main entry: every name they exported is there, under the same name and kind", () => {
    expect(has(main, removedAnimation)).toEqual([]);
    expect(has(main, removedGestures)).toEqual([]);
    expect(has(main, removedSvg)).toEqual([]);
    // The four SVG elements whose names clash with the views' and `/foreign`'s, and the default export, are `SvgText`, `SvgImage`, `SvgLinearGradient`, `SvgMarker` and `Svg`.
    expect(Object.values(svgRenamed).filter((name) => !main.values.has(name))).toEqual([]);
    expect(Object.keys(svgRenamed).filter((name) => name !== "default" && !["Text", "Image"].includes(name) && main.values.has(name))).toEqual([]);
    // The lists are what the sources export, not a subset of them: a name added to `animation.ts` or `svg.ts` is added to the list.
    expect(removedAnimation.values.length + removedAnimation.types.length).toBe(animation.values.size + animation.types.size);
    expect(removedSvg.values.length + removedSvg.types.length + Object.keys(svgRenamed).length - 1).toBe(svg.values.size + svg.types.size);
  });

  test("`/native-modules` is `/platform`: the same two functions", () => {
    expect(has(platform, removedNativeModules)).toEqual([]);
    expect(readFileSync(src("platform.ts"), "utf8")).toContain('export { nativeModule, turboModule } from "./native-modules.ts";');
  });

  test("`/fabric` is `/app`: the generated entry's import, which exports the five names", () => {
    expect(has(app, removedFabric)).toEqual([]);
    expect(all(app)).toEqual(all({ values: new Set(removedFabric.values), types: new Set(removedFabric.types) }));
  });

  test("`/init` and `/polyfills` are the modules `/app` runs, in order before the Fabric host, and are not entries of their own", () => {
    expect(manifest.exports["./app"]).toEqual({ "svelte-native-source": "./src/app.ts", types: "./dist/types/app.d.ts", default: "./src/app.ts" });
    expect(existsSync(src("init.ts")) && existsSync(src("polyfills.ts"))).toBe(true);
    const imports = readFileSync(src("app.ts"), "utf8").split("\n").filter((line) => line.startsWith("import "));
    expect(imports).toEqual(['import "./init.ts";', 'import "./polyfills.ts";', expect.stringMatching(/^import \{ .* \} from "\.\/fabric\/index\.ts";$/)]);
    expect(manifest.exports["./init"]).toBeUndefined();
    expect(manifest.exports["./polyfills"]).toBeUndefined();
  });

  test("`/expo` is gone, and the package's own name and `/app.plugin` are the config plugin: app.plugin.js, which imports the built dist/node/expo.cjs", () => {
    expect(manifest.exports["./app.plugin"]).toEqual({ "svelte-native-source": "./src/expo.ts", types: "./dist/types/expo.d.ts", default: "./app.plugin.js" });
    expect(manifest.exports["./expo"]).toBeUndefined();
    expect(readFileSync(join(root, "app.plugin.js"), "utf8")).toContain('import plugin from "./dist/node/expo.cjs";');
    expect(existsSync(join(root, "dist/node/expo.cjs")) && existsSync(src("expo.ts"))).toBe(true);
  });

  test("the remote runtime and its globals stay two entries: the SvelteKit files that import the globals are imported by the runtime", () => {
    expect(manifest.exports["./remote/runtime"]).toBe("./src/remote/runtime.ts");
    expect(manifest.exports["./remote/globals"]).toBe("./src/remote/globals.ts");
    expect(Object.keys(manifest.exports)).not.toContain("./remote/internal");
  });
});

describe("react-native-svg is a required peer", () => {
  test("it has a version and is not optional", () => {
    expect(manifest.peerDependencies["react-native-svg"]).toBe("15.15.4");
    expect(manifest.peerDependenciesMeta["react-native-svg"]).toBeUndefined();
  });
});

describe("the web's `crypto` and `localStorage` are made of required peers", () => {
  test("react-native-quick-crypto, react-native-mmkv, the Nitro runtime they share and quick-crypto's base64 module are peers with a version and not optional", () => {
    for (const name of ["react-native-quick-crypto", "react-native-mmkv", "react-native-nitro-modules", "react-native-quick-base64"]) {
      expect([name, typeof manifest.peerDependencies[name]]).toEqual([name, "string"]);
      expect([name, manifest.peerDependenciesMeta[name]]).toEqual([name, undefined]);
    }
  });

  test("`/mmkv` is an entry with the three conditions, a declaration and a source that exports react-native-mmkv's createMMKV and types and localStorageMMKV", () => {
    expect(manifest.exports["./mmkv"]).toEqual({ "svelte-native-source": "./src/mmkv.ts", types: "./dist/types/mmkv.d.ts", default: "./src/mmkv.ts" });
    expect(existsSync(join(root, "dist/types/mmkv.d.ts"))).toBe(true);
    const names = exportsOf(src("mmkv.ts"));
    expect([...names.values].sort()).toEqual(["createMMKV", "localStorageMMKV"]);
    expect([...names.types].sort()).toEqual(["Configuration", "MMKV", "Mode"]);
    expect(readFileSync(src("mmkv.ts"), "utf8")).toContain('from "react-native-mmkv"');
    // The main entry and the primitives export nothing of it: an app that does not use MMKV directly does not load its types.
    expect(JSON.stringify(manifest.exports["."])).not.toContain("mmkv");
    for (const entry of [src("index.ts"), src("core.ts"), src("app.ts")]) expect(readFileSync(entry, "utf8")).not.toMatch(/mmkv|quick-crypto/);
  });
});
