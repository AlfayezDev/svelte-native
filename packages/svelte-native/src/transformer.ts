import { createRequire } from "node:module";
import { compile, compileModule } from "svelte/compiler";
import { transformSync } from "esbuild";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { traverseFast } from "@babel/types";
import { lowerPrimitives } from "./lower.ts";
import { isRemoteModule, kitGlobalsImport, transformRemoteModule } from "./remote/transform.ts";
import { TraceMap, originalPositionFor } from "@jridgewell/trace-mapping";

const require = createRequire(import.meta.url);
const upstream = require("@expo/metro-config/babel-transformer");
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
    return transformRemoteModule(src, filename, root);
  }
  return src + (kitGlobalsImport(filename) ?? "");
}

export function transform(input: TransformInput) {
  const { filename } = input;
  const src = sourceOf(input);
  let code = src;
  const maps: TraceMap[] = [];
  if (filename.endsWith(".svelte")) {
    const result = compile(lowerPrimitives(src, { filename }), {
      filename,
      dev: false,
      css: "external",
      experimental: { customRenderer: "@rasheed/svelte-native/renderer" },
    });
    if (result.css?.code.trim()) throw new Error(`${filename}: use native style props; browser CSS is not supported`);
    code = result.js.code;
    if (result.js.map) maps.push(new TraceMap(result.js.map.toString()));
  } else {
    // RN component codegen needs the original TypeScript declarations.
    const stripTypes = /\.tsx?$/.test(filename) && !filename.includes("/node_modules/") && !src.includes("codegenNativeComponent") && !src.includes("codegenNativeCommands");
    if (stripTypes) {
      const stripped = transformSync(src, { loader: filename.endsWith(".tsx") ? "tsx" : "ts", jsx: "preserve", target: "es2022", sourcemap: "external", sourcefile: filename });
      code = stripped.code;
      maps.push(new TraceMap(stripped.map));
    }
    if (/\.svelte\.[jt]s$/.test(filename)) {
      const result = compileModule(code, { filename, dev: false, generate: "client" });
      code = result.js.code;
      if (result.js.map) maps.unshift(new TraceMap(result.js.map.toString()));
    }
  }
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

export function getCacheKey(options?: unknown): string {
  return createHash("sha256").update(readFileSync(import.meta.filename)).update(readFileSync(new URL("./lower.ts", import.meta.url))).update(readFileSync(new URL("./remote/transform.ts", import.meta.url))).update(upstream.getCacheKey(options)).digest("hex");
}
