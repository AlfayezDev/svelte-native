/**
 * Builds the JavaScript of the entries Node itself loads, into `dist/node/` (committed: `pnpm --dir packages/svelte-native build`), and then the type
 * declarations of the public entries, into `dist/types/` (`build-types.ts`).
 *
 * The package ships TypeScript, which is right for the code Metro and Vite compile (the React Native runtime) and wrong for the code a Node process
 * loads: Node refuses to strip types from a file under `node_modules` (`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`), and the tools that load a
 * plugin or a config (Metro, `@expo/config`, Vite) hand the file to Node. So the entries below are bundled to plain JavaScript: each is one file
 * with its relative imports inlined and every package left as an import (the app installs them). `tests/package/dist.test.ts` fails when `dist/node/` is
 * not what this script writes for the sources, and `tests/package/node-modules.test.ts` loads the built files from a `node_modules`.
 *
 * Deterministic: the same sources and the same esbuild give the same bytes (no timestamps, no absolute paths, sorted files).
 */
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { build } from "esbuild";

export const packageRoot = resolve(import.meta.dirname, "..");
export const outputDirectory = join(packageRoot, "dist/node");

type Entry = {
  /** The file name in `dist/node/`, without its extension. */
  name: string;
  source: string;
  /** `cjs` for what a tool `require`s (Metro's config and transformer, `@expo/config`'s plugin loader), `esm` for what is imported or run. */
  format: "cjs" | "esm";
};

/**
 * The Node-side entries. What loads each, and why it is not left as TypeScript, is in the package README ("Set up an app"); the exports map
 * of `package.json` points at these files, and a test checks that every entry here is named there and the other way round.
 */
export const entries: readonly Entry[] = [
  { name: "cli", source: "src/cli.ts", format: "esm" },
  { name: "expo", source: "src/expo.ts", format: "cjs" },
  { name: "lower", source: "src/lower.ts", format: "esm" },
  { name: "metro", source: "src/metro.ts", format: "cjs" },
  { name: "push-server", source: "src/push/server.ts", format: "esm" },
  { name: "routes", source: "src/routes-table.ts", format: "esm" },
  { name: "transformer", source: "src/transformer.ts", format: "cjs" },
  { name: "vite", source: "src/vite.ts", format: "esm" },
];

/** The extension of a built entry. */
export const extensionOf = (format: Entry["format"]): string => (format === "cjs" ? ".cjs" : ".js");

/** The files that run (are executable) in `dist/node/`. */
export const executables: readonly string[] = ["cli.js"];

/**
 * A CommonJS file has no `import.meta`: the three properties the sources read are the module's own `__filename`, `__dirname` and URL. (The
 * sources read `import.meta.url` for `createRequire`, `.dirname` and `.filename` for paths.)
 */
const commonJsMeta = {
  // Strict, as the modules were (esbuild's own "use strict" comes after a banner and so is no directive).
  banner: { js: '"use strict";\nvar __importMetaUrl = require("node:url").pathToFileURL(__filename).href;' },
  define: { "import.meta.url": "__importMetaUrl", "import.meta.dirname": "__dirname", "import.meta.filename": "__filename" },
};

/** What `dist/node/` should hold: file name to text, in the order of the names. */
export async function buildNode(): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  for (const format of ["cjs", "esm"] as const) {
    const group = entries.filter((entry) => entry.format === format);
    const result = await build({
      absWorkingDir: packageRoot,
      entryPoints: Object.fromEntries(group.map((entry) => [entry.name, entry.source])),
      outdir: "dist/node",
      outExtension: { ".js": extensionOf(format) },
      write: false,
      bundle: true,
      // Every package (node:, svelte, esbuild, @babel/*, expo, @sveltejs/kit…) stays an import: the app installs them, as peers or dependencies.
      packages: "external",
      platform: "node",
      format,
      target: "node22",
      charset: "utf8",
      legalComments: "none",
      logLevel: "silent",
      ...(format === "cjs" ? commonJsMeta : {}),
    });
    for (const file of result.outputFiles) files.set(relative(join(packageRoot, "dist/node"), file.path), file.text);
  }
  return new Map([...files].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

/** Replaces the contents of `directory` with the build. */
export async function writeNode(directory: string = outputDirectory): Promise<string[]> {
  const files = await buildNode();
  rmSync(directory, { recursive: true, force: true });
  mkdirSync(directory, { recursive: true });
  for (const [name, text] of files) {
    const path = join(directory, name);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
    if (executables.includes(name)) chmodSync(path, 0o755);
  }
  return [...files.keys()];
}

/** The files under `directory` (relative paths, sorted), or none when it does not exist. */
export function filesUnder(directory: string): string[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter((item) => item.isFile())
    .map((item) => relative(directory, join(item.parentPath, item.name)))
    .sort();
}

if (import.meta.main) {
  const names = await writeNode();
  for (const name of names) console.log(`dist/node/${name}  ${readFileSync(join(outputDirectory, name)).length} bytes`);
  // The type declarations (`dist/types/`) are the other half of the build: `pnpm build` writes both, and `tests/package/types.test.ts` checks them. Loaded here so that
  // a test that imports this file for `writeNode` does not load TypeScript and svelte2tsx.
  const { writeTypes } = await import("./build-types.ts");
  const declarations = await writeTypes();
  console.log(`dist/types/  ${declarations.length} files`);
}
