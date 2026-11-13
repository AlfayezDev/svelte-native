import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import ts from "typescript";

/**
 * What the package's entries export, read from the sources (no bundler, no device): the main entry carries what `/animation`, `/gestures` and `/svg` exported, the
 * deprecated entries still export what they did (each name marked `@deprecated`, so an editor strikes it through), `/platform` has the two native module lookups, and
 * `/app` is the one import of the generated entry. `exports-runtime.test.ts` loads the entries and compares what they export.
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

const without = (names: string[], leave: readonly string[]) => names.filter((name) => !leave.includes(name));
/** The SVG elements the main entry names differently from react-native-svg (and from the deprecated `/svg` entry): the views' names, and the names of `/foreign`'s components. */
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

describe("the entries that were folded in are deprecated aliases that keep their names", () => {
  const entry = (name: string) => {
    const target = manifest.exports[name];
    return join(root, typeof target === "string" ? target : (target.types as string));
  };

  test("each is still in the exports map, and exports what it did", () => {
    expect(Object.keys(manifest.exports)).toEqual(expect.arrayContaining(["./animation", "./gestures", "./svg", "./native-modules", "./expo", "./init", "./polyfills", "./fabric", "./app", "./app.plugin", "./remote/runtime", "./remote/globals"]));
    expect(all(exportsOf(entry("./animation")))).toEqual(all(animation));
    // `types.ts` also lists some of RNGH's internals (`BaseGesture`, `MountRegistry`, ...) as type exports that the checker does not resolve: nothing imports them from the entry.
    const internals = ["BaseGesture", "BaseGestureConfig", "CALLBACK_TYPE", "GestureObjects", "HandlerCallbacks", "MountRegistry", "findHandler", "registerHandler", "unregisterHandler"];
    expect(all(exportsOf(entry("./gestures")))).toEqual(without(all(gestures), internals));
    // The svg entry has the old names: its Text and Image, and Svg as its default.
    expect(all(exportsOf(entry("./svg")))).toEqual([...without(all(svg), Object.keys(renamed)), ...Object.values(renamed), "default"].sort());
    expect(all(exportsOf(entry("./native-modules")))).toEqual(["nativeModule", "turboModule"]);
    expect(all(exportsOf(entry("./fabric")))).toEqual(["createFabricApp", "fabricStats", "flush", "remountSurfaces", "showError"]);
  });

  test("`/native-modules` is folded into `/platform`: the same two functions", () => {
    expect(readFileSync(src("platform.ts"), "utf8")).toContain('export { nativeModule, turboModule } from "./native-modules.ts";');
    expect(exportsOf(src("platform.ts")).values.has("turboModule")).toBe(true);
    expect(exportsOf(src("platform.ts")).values.has("nativeModule")).toBe(true);
    expect(readFileSync(src("deprecated/native-modules.ts"), "utf8")).toContain('from "../native-modules.ts"');
  });

  test("`/init` and `/polyfills` are the modules the entry runs, and `/app` runs them in order before the Fabric host, then exports what the entry calls", () => {
    expect(manifest.exports["./init"]).toBe("./src/init.ts");
    expect(manifest.exports["./polyfills"]).toBe("./src/polyfills.ts");
    expect(manifest.exports["./app"]).toBe("./src/app.ts");
    const imports = readFileSync(src("app.ts"), "utf8").split("\n").filter((line) => line.startsWith("import "));
    expect(imports).toEqual(['import "./init.ts";', 'import "./polyfills.ts";', expect.stringMatching(/^import \{ .* \} from "\.\/fabric\/index\.ts";$/)]);
    expect(all(exportsOf(src("app.ts")))).toEqual(["createFabricApp", "fabricStats", "flush", "remountSurfaces", "showError"]);
  });

  test("`/expo` and the package's own name are the config plugin: app.plugin.js, built at dist/node/expo.cjs", () => {
    expect(manifest.exports["./app.plugin"]).toBe("./app.plugin.js");
    expect(manifest.exports["./expo"]).toEqual({ types: "./src/expo.ts", default: "./dist/node/expo.cjs" });
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

describe("an editor strikes through the deprecated names", () => {
  // The suggestion diagnostic 6385 ("'x' is deprecated") the TypeScript language service raises for a use of a name whose declaration has `@deprecated`.
  function deprecatedUses(statements: string): string[] {
    const consumer = src("consumer-of-entries.ts");
    const ambient = src("svelte-modules-ambient.d.ts");
    const options: ts.CompilerOptions = { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, allowImportingTsExtensions: true, noEmit: true, strict: true, skipLibCheck: true, types: ["node"] };
    const virtual: Record<string, string> = { [consumer]: statements, [ambient]: 'declare module "*.svelte" { const component: unknown; export default component; }\n' };
    const service = ts.createLanguageService({
      getScriptFileNames: () => [consumer, ambient],
      getScriptVersion: () => "1",
      getScriptSnapshot: (file) => { const text = virtual[file] ?? (existsSync(file) ? readFileSync(file, "utf8") : undefined); return text === undefined ? undefined : ts.ScriptSnapshot.fromString(text); },
      getCurrentDirectory: () => root,
      getCompilationSettings: () => options,
      getDefaultLibFileName: (settings) => ts.getDefaultLibFilePath(settings),
      fileExists: (file) => file in virtual || ts.sys.fileExists(file),
      readFile: (file) => virtual[file] ?? ts.sys.readFile(file),
      directoryExists: ts.sys.directoryExists,
      getDirectories: ts.sys.getDirectories,
    });
    const found = service.getSuggestionDiagnostics(consumer).filter((diagnostic) => diagnostic.code === 6385 && diagnostic.reportsDeprecated);
    service.dispose();
    return [...new Set(found.map((diagnostic) => String(diagnostic.messageText).replace(/^'(.*)' is deprecated\.?$/, "$1")))].sort();
  }
  const importAll = (specifier: string, names: string[], kind = "") => `import ${kind}{ ${names.join(", ")} } from "${specifier}";\n`;

  test("every name of the deprecated entries is flagged, and the same names from the main entry are not", () => {
    const animationNames = [...animation.values];
    const gestureNames = [...gestures.values, "ComposedGesture", "GestureType", "GestureRef", "GestureProps"];
    const svgNames = [...svg.values].filter((name) => !(name in renamed));
    const deprecated = deprecatedUses([
      importAll("./deprecated/animation.ts", animationNames),
      importAll("./deprecated/gestures.ts", gestureNames.filter((name) => !["runOnJS", "scheduleOnRN"].includes(name))),
      importAll("./deprecated/svg.ts", [...svgNames, ...Object.values(renamed)]),
      importAll("./deprecated/native-modules.ts", ["nativeModule", "turboModule"]),
      importAll("./deprecated/fabric.ts", ["createFabricApp", "remountSurfaces"]),
    ].join(""));
    expect(deprecated).toEqual([...new Set([...animationNames, ...gestureNames.filter((name) => !["runOnJS", "scheduleOnRN"].includes(name)), ...svgNames, ...Object.values(renamed), "nativeModule", "turboModule", "createFabricApp", "remountSurfaces"])].sort());
    expect(deprecatedUses(importAll("./index.ts", [...animationNames, ...gestureNames, ...svgNames, ...Object.keys(renamed), "BlurView"]))).toEqual([]);
  }, 60_000);
});
