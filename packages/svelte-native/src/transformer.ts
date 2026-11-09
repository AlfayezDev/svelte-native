import { createRequire } from "node:module";
import { dirname } from "node:path";
import { compile, compileModule } from "svelte/compiler";
import { transformSync } from "esbuild";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { parse } from "@babel/parser";
import { isBlockStatement, isCallExpression, isFunction, isIdentifier, isMemberExpression, traverseFast } from "@babel/types";
import { lowerPrimitives } from "./lower.ts";
import { sourceDirectory, sourceFile } from "./package-root.ts";
import { assertCustomRenderer } from "./svelte-build.ts";
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
    throw new Error("The Metro transformer of @rasheed/svelte-native needs `expo`, which it could not resolve (from the app's directory or from the package). Install it: `npx expo install expo`.", { cause });
  }
  return require.resolve("@expo/metro-config/babel-transformer", { paths: [dirname(expoManifest)] });
}

const upstream = require(upstreamTransformerPath());
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
/** The first `.svelte` file of a worker fails with the fix when the installed Svelte is the stock release, instead of with the compiler's message about an unknown `customRenderer` option. */
function requireCustomRenderer(): void {
  if (rendererChecked) return;
  assertCustomRenderer("The Metro transformer of @rasheed/svelte-native");
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
      : "This component is not in runes mode, where a variable that the markup mutates (`count.value = ...` in a handler) is state even when it is a `const`. Add `<svelte:options runes />` to the component: there a `const` shared value stays a plain constant."
  }`);
}

export function transform(input: TransformInput) {
  const { filename } = input;
  const src = sourceOf(input);
  let code = src;
  let runes = true;
  const maps: TraceMap[] = [];
  const compiledBySvelte = /\.svelte(\.[jt]s)?$/.test(filename);
  if (filename.endsWith(".svelte")) {
    requireCustomRenderer();
    const result = compile(lowerPrimitives(src, { filename }), {
      filename,
      dev: false,
      css: "external",
      experimental: { customRenderer: "@rasheed/svelte-native/renderer" },
    });
    if (result.css?.code.trim()) throw new Error(`${filename}: use native style props; browser CSS is not supported`);
    code = result.js.code;
    runes = result.metadata.runes;
    if (result.js.map) maps.push(new TraceMap(result.js.map.toString()));
  } else {
    // RN component codegen needs the original TypeScript declarations. The TypeScript a package ships under `node_modules` is left to Babel, except a `.svelte.ts`
    // module: Svelte compiles it before Babel sees it, and its compiler reads JavaScript. The library's own (`router.svelte.ts`, `insets.svelte.ts`, ...) is one.
    const svelteModule = /\.svelte\.[jt]s$/.test(filename);
    const stripTypes = /\.tsx?$/.test(filename) && (svelteModule || !filename.includes("/node_modules/")) && !src.includes("codegenNativeComponent") && !src.includes("codegenNativeCommands");
    if (stripTypes) {
      const stripped = transformSync(src, { loader: filename.endsWith(".tsx") ? "tsx" : "ts", jsx: "preserve", target: "es2022", sourcemap: "external", sourcefile: filename });
      code = stripped.code;
      maps.push(new TraceMap(stripped.map));
    }
    if (svelteModule) {
      const result = compileModule(code, { filename, dev: false, generate: "client" });
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
 * Metro's cache key for what this transformer produces: the code that runs, and upstream's key. Built (`dist/node/transformer.cjs`), the one file
 * holds `lower.ts` and `remote/transform.ts`; run from the sources, those two are hashed next to this one.
 */
export function getCacheKey(options?: unknown): string {
  const files = [import.meta.filename];
  if (import.meta.dirname === sourceDirectory) files.push(sourceFile("lower.ts"), sourceFile("remote/transform.ts"));
  const hash = createHash("sha256");
  for (const file of files) hash.update(readFileSync(file));
  return hash.update(upstream.getCacheKey(options)).digest("hex");
}
