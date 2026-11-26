import Module, { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { transformSync } from "esbuild";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { parse } from "@babel/parser";
import { isBlockStatement, isCallExpression, isFunction, isIdentifier, isMemberExpression, traverseFast } from "@babel/types";
import { asyncEnabled, componentOptions, lowersHtml, moduleOptions, runesDefaultEnabled } from "./compile-options.ts";
import { lowerWithMap } from "./lower.ts";
import { svelteCompiler } from "./svelte-compiler.ts";
import { cacheKeyFiles } from "./transformer-cache.ts";
import { assertCustomRenderer } from "./svelte-build.ts";
import { vendoredFileAs, vendoredRoot } from "./vendored.ts";
import { isRemoteModule, kitGlobalsImport, kitRoot, transformRemoteModule } from "./remote/transform.ts";
import { TraceMap, originalPositionFor } from "@jridgewell/trace-mapping";

const require = createRequire(import.meta.url);

/**
 * `@expo/metro-config/babel-transformer`, which this transformer wraps. `@expo/metro-config` is a dependency of `expo`, and of neither the app nor
 * this package, so it is found through `expo`, as `expo/metro-config` finds it: `expo` is a required peer, which both the app and this package see in
 * any layout. A hoisted install has `@expo/metro-config` at the top of `node_modules`; pnpm's default layout has it only beside `expo`'s own copy,
 * where a plain `require` from here (or from the app) cannot reach it. The app's directory is asked first (Metro runs there), then this package's.
 */
export function upstreamTransformerPath(searchFrom: readonly string[] = [process.cwd(), import.meta.dirname]): string {
  let expoManifest: string;
  try {
    expoManifest = require.resolve("expo/package.json", { paths: [...searchFrom] });
  } catch (cause) {
    throw new Error("The Metro transformer of expo-svelte needs `expo`, which it could not resolve (from the app's directory or from the package). Install it: `npx expo install expo`.", { cause });
  }
  return require.resolve("@expo/metro-config/babel-transformer", { paths: [dirname(expoManifest)] });
}

const upstream = require(upstreamTransformerPath());

/**
 * The Worklets Babel plugin, which `babel-preset-expo` puts in every bundle that has Worklets: it asks Node to resolve `react-native-worklets/plugin` from the app's directory and, when
 * that finds a package, adds the plugin in the place where the other plugins of the preset end and React Native's own begin. Worklets is the library's own copy (`vendor/`,
 * `vendored.ts`) and not a package of the app, so nothing of the app's would answer, and one that does (pnpm installs `react-native-worklets` beside Expo Router, which peer-depends on it) is
 * another version than the native code the library links and the runtime it bundles. So that name resolves to the copy's plugin, for the preset and for anything else that asks for it
 * (an app's own Babel config that lists it): the plugin is added once, where the preset adds it, and it is the copy's. `react-native-reanimated/plugin`, which an app's Babel config from
 * before Reanimated 4 lists, resolves to Reanimated's copy, which re-exports it.
 * `Module._resolveFilename` is what `require.resolve` ends in on every Node the library supports (a resolve hook of `module.registerHooks` is not documented to reach it).
 */
const workletsPluginFile = (): string => join(vendoredRoot("react-native-worklets"), "plugin/index.js");
const pluginFiles: Readonly<Record<string, () => string>> = {
  "react-native-worklets/plugin": workletsPluginFile,
  "react-native-reanimated/plugin": () => join(vendoredRoot("react-native-reanimated"), "plugin/index.js"),
};
const redirected = Symbol.for("expo-svelte/worklets-plugin");
type ResolveFilename = ((request: string, ...rest: unknown[]) => string) & { [redirected]?: true };
const internals = Module as unknown as { _resolveFilename: ResolveFilename };
// Not under Bun, which the repository's own tests run the transformer in: after the wrapper, a `require` of a relative file by a module that is not the first one fails there ("Cannot find module './x.ts' from ''"). The preset
// finds whatever the app's `node_modules` has in such a run, which in this repository is Worklets 0.10.1, the version the copy is. An app's Metro under Bun (`bun --bun expo start`) gets
// no Worklets plugin at all, so its worklets fail on the device: it is told once.
if (process.versions.bun !== undefined && process.env.NODE_ENV !== "test") {
  console.warn("expo-svelte: Metro runs under Bun, where the library cannot give Babel its copy of the Worklets plugin; animations and gestures need Metro on Node (`expo start`, not `bun --bun expo start`)");
}
if (process.versions.bun === undefined && internals._resolveFilename[redirected] !== true) {
  const resolveFilename = internals._resolveFilename;
  const redirect: ResolveFilename = function (this: unknown, request, ...rest) {
    const plugin = pluginFiles[request];
    return plugin ? plugin() : resolveFilename.call(this, request, ...rest);
  };
  redirect[redirected] = true;
  internals._resolveFilename = redirect;
}
type TransformInput = { filename: string; src: string; options: { dev: boolean; projectRoot?: string }; [key: string]: unknown };

/**
 * The source the rest of the transform works on. A `*.remote.ts` module (it imports `$app/server` and the app's server code) is replaced by the client
 * stubs SvelteKit's Vite plugin would generate, and the SvelteKit client files that run remote functions get the globals a browser would (an import at
 * the end of the file, so no line moves).
 */
export function sourceOf(input: TransformInput): string {
  const { filename, src } = input;
  if (isRemoteModule(filename)) {
    const root = input.options.projectRoot;
    if (!root) throw new Error(`${filename}: Metro did not pass its project root, which the ids of remote functions are relative to`);
    kitRoot(`${filename} is a remote function module (\`*.remote.ts\`), which`);
    return transformRemoteModule(src, filename, root);
  }
  return src + (kitGlobalsImport(filename) ?? "");
}

let rendererChecked = false;
/** The first `.svelte` file of a worker fails with the fix when the installed Svelte is older than 5.59.0 (no custom renderers), instead of with the compiler's message about an unknown `customRenderer` option. */
function requireCustomRenderer(): void {
  if (rendererChecked) return;
  assertCustomRenderer("The Metro transformer of expo-svelte");
  rendererChecked = true;
}

/**
 * Fails the build when a function marked `"worklet"` in a file Svelte compiled reads reactive state. Such a function is written for the UI runtime (`animatedStyle`,
 * `animatedProps`, `runOnUI`), where Svelte does not exist; state is read through Svelte's runtime (`$.get(count)`), so the Worklets plugin gives it `$`, the namespace of
 * `svelte/internal/client`, in its closure, and the UI runtime turns each function of that into a remote function that throws when called ("Tried to synchronously call a Remote
 * Function. Called "anonymous""): the screen throws when it mounts. Outside runes mode a shared value is state too when the markup mutates it (`count.value = ...` in a
 * handler), so the message for that mode names `<svelte:options runes />`. The callbacks of a `Gesture.X().onY(...)` chain are workletized without the directive and may run on
 * the JavaScript thread (`.runOnJS(true)`), where reading state is fine; the gestures' own check (`gestures/guards.ts`) judges those when they attach.
 */
function assertWorkletsReadNoState(filename: string, code: string, runes: boolean): void {
  if (!/["']worklet["']/.test(code)) return;
  const state = new Set<string>();
  let reached = false;
  traverseFast(parse(code, { sourceType: "module" }), (node) => {
    if (!isFunction(node) || !isBlockStatement(node.body) || !node.body.directives.some((directive) => directive.value.value === "worklet")) return;
    traverseFast(node.body, (inner) => {
      if (isMemberExpression(inner) && isIdentifier(inner.object, { name: "$" })) reached = true;
      if (isCallExpression(inner) && isMemberExpression(inner.callee) && isIdentifier(inner.callee.object, { name: "$" }) && isIdentifier(inner.arguments[0])) state.add(inner.arguments[0].name);
    });
  });
  if (!reached) return;
  const names = [...state].map((name) => `\`${name}\``).join(", ");
  const what = names ? `${names}, which Svelte compiled into reactive state` : "reactive state (Svelte's runtime, `$`)";
  throw new Error(`${filename}: a worklet reads ${what}. A worklet runs on the UI runtime, which has no Svelte, so it cannot read state; on the device it would throw "Tried to synchronously call a Remote Function" when the screen mounts. ${
    runes
      ? "State in runes mode is `$state`, `$derived` and props: copy the value into a shared value (`createSharedValue`) on the JavaScript side and read that in the worklet."
      : "This component is not in runes mode (the library compiles the app's components in runes mode unless the file has `<svelte:options runes={false} />`, the app sets `runes: false`, or the file is a library below `node_modules`), where a variable that the markup mutates (`count.value = ...` in a handler) is state even when it is a `const`. Put the component in runes mode with `<svelte:options runes />`: there a `const` shared value stays a plain constant."
  }`);
}

type SvelteDiagnostic = Error & { code?: string; start?: { line: number; column: number } };
/** Where a position of the text Svelte compiled is in the file the developer wrote, or nothing when it is nowhere in it. */
type Locate = (line: number, column: number) => { line: number; column: number } | undefined;

/**
 * A code frame in Babel's shape: the lines around [line] (1-based), numbered, and a caret under [column] (0-based) of it, of the text the developer wrote.
 */
function frameOf(source: string, line: number, column: number): string {
  // A file with CRLF line endings: the `\r` is not part of the line (the frame is text, and a caret under a carriage return would be a column too far).
  const lines = source.split("\n").map((text) => text.replace(/\r$/, ""));
  const last = Math.min(lines.length, line + 2);
  const width = String(last).length;
  const frame: string[] = [];
  for (let at = Math.max(1, line - 2); at <= last; at++) {
    const text = lines[at - 1] ?? "";
    frame.push(`${at === line ? ">" : " "} ${String(at).padStart(width)} | ${text}`);
    // Tabs stay tabs, so that the caret is under the column whatever the editor's tab width is.
    if (at === line) frame.push(`  ${" ".repeat(width)} | ${text.slice(0, column).replace(/[^\t]/g, " ")}^`);
  }
  return frame.join("\n");
}

/**
 * A compile error of Svelte's, in the shape Metro can print. Svelte clears the stack of its `CompileError` and gives it no `loc`, so Metro made a `TransformError` of it with an empty stack,
 * and Expo's reporter, which prints the stack of a `SyntaxError` that has no code frame in place of its message, printed the stack: nothing but "SyntaxError" (a `{@const}` in a `<View>`,
 * which the lowering makes a plain element, is one). A Babel error carries its `loc` and its `codeFrame`: Metro puts the message, the file, the line and the column of such an error
 * together and prints the frame under it, and Expo leaves it alone. Svelte's error has the line and the column of the text it compiled, which is not the file: the lowering moves the columns of a
 * line that has a lowered tag or a `class` (`lowerWithMap`), and a module's TypeScript was stripped of its types before Svelte read it (the map of that step). So the position goes back through
 * [locate] to the text the developer wrote, and the frame is made of that text, not of Svelte's own (which shows `<native-view nativeClass={...}>` for a `<View class="...">`). The error keeps its
 * `code` and its name. An error with no position is a plain `Error` with a stack of its own, that Metro gives the file's name.
 */
function metroError(error: unknown, source: string, locate: Locate): unknown {
  if (!(error instanceof Error) || error.name !== "CompileError") return error;
  const { start, code } = error as SvelteDiagnostic;
  const failure = Object.assign(new Error(error.message), { name: error.name, ...(code === undefined ? {} : { code }) });
  const at = start ? locate(start.line, start.column) : undefined;
  if (!at) return failure;
  return Object.assign(failure, { type: "CompileError", loc: { line: at.line, column: at.column }, codeFrame: frameOf(source, at.line, at.column) });
}

/** Runs one of Svelte's compiles and has its error, when it fails, reach Metro with its message, the file and the position in [source] ([metroError]). */
function compiling<T>(compile: () => T, source: string, locate: Locate): T {
  try {
    return compile();
  } catch (error) {
    throw metroError(error, source, locate);
  }
}

export function transform(input: TransformInput) {
  const { filename } = input;
  const src = sourceOf(input);
  let code = src;
  let runes = true;
  const maps: TraceMap[] = [];
  const compiledBySvelte = /\.svelte(\.[jt]s)?$/.test(filename);
  if (filename.endsWith(".svelte")) {
    // Runes mode for the app's own components unless the file opts out (`componentOptions`, `compile-options.ts`); a file below `node_modules` keeps Svelte's own default.
    requireCustomRenderer();
    const lowering = lowerWithMap(src, { filename, html: lowersHtml(filename) });
    const result = compiling(() => svelteCompiler().compile(lowering.code, componentOptions(filename)), src, lowering.original);
    if (result.css?.code.trim()) throw new Error(`${filename}: use native style props; browser CSS is not supported`);
    code = result.js.code;
    runes = result.metadata.runes;
    if (result.js.map) maps.push(new TraceMap(result.js.map.toString()));
  } else {
    // RN component codegen needs the original TypeScript declarations. The TypeScript a package ships under `node_modules` is left to Babel, except a `.svelte.ts`
    // module: Svelte compiles it before Babel sees it, and its compiler reads JavaScript. The library's own (`router.svelte.ts`, `insets.svelte.ts`, ...) is one.
    const svelteModule = /\.svelte\.[jt]s$/.test(filename);
    // A file of a vendored package (`vendor/`) is a package of `node_modules` as far as this goes, whether the library is installed or linked from the workspace.
    const stripTypes = /\.tsx?$/.test(filename) && (svelteModule || (!filename.includes("/node_modules/") && vendoredFileAs(filename) === undefined)) && !src.includes("codegenNativeComponent") && !src.includes("codegenNativeCommands");
    if (stripTypes) {
      const stripped = transformSync(src, { loader: filename.endsWith(".tsx") ? "tsx" : "ts", jsx: "preserve", target: "es2022", sourcemap: "external", sourcefile: filename });
      code = stripped.code;
      maps.push(new TraceMap(stripped.map));
    }
    if (svelteModule) {
      // A Svelte module is always in runes mode: `compileModule` has no `runes` option.
      const typeMap = maps[0];
      const result = compiling(() => svelteCompiler().compileModule(code, moduleOptions(filename)), src, (line, column) => {
        // Without a map the module had no types to strip: the compiled text is the file.
        if (!typeMap) return { line, column };
        const original = originalPositionFor(typeMap, { line, column });
        return original.line === null || original.column === null ? undefined : { line: original.line, column: original.column };
      });
      code = result.js.code;
      if (result.js.map) maps.unshift(new TraceMap(result.js.map.toString()));
    }
  }
  if (compiledBySvelte) assertWorkletsReadNoState(filename, code, runes);
  // Worklets reads this real filename when generating its source maps.
  const output = upstream.transform({ ...input, src: code });
  if (maps.length && output.ast) traverseFast(output.ast, (node) => {
    if (!node.loc) return;
    for (const position of [node.loc.start, node.loc.end]) {
      for (const map of maps) {
        const original = originalPositionFor(map, position);
        if (original.line === null || original.column === null) break;
        position.line = original.line;
        position.column = original.column;
      }
    }
  });
  return output;
}

/**
 * Metro's cache key for what this transformer produces: the code that runs, the app's `runes` and `async` settings, and upstream's key. Built (`dist/node/transformer.cjs`), the one file
 * holds the modules it imports; run from the sources, those that make the output (`cacheKeyFiles`: `lower.ts` and what it imports, `remote/transform.ts`, `compile-options.ts`) are hashed next to this one.
 */
export function getCacheKey(options?: unknown): string {
  const files = cacheKeyFiles(import.meta.filename, import.meta.dirname);
  const hash = createHash("sha256");
  for (const file of files) hash.update(readFileSync(file));
  // The Worklets plugin is part of what the library produces: a copy of another version generates other code.
  hash.update(readFileSync(workletsPluginFile()));
  // The mode an app's components are compiled in is not in any file: `withExpoSvelte(config, { runes, async })` hands it over in the environment.
  hash.update(`runes-default:${runesDefaultEnabled()}`);
  hash.update(`async:${asyncEnabled()}`);
  return hash.update(upstream.getCacheKey(options)).digest("hex");
}
