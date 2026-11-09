import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { indexOfBlock, parsePatch } from "../src/doctor/hunks.ts";
import { patchFiles, patchKey, patchSpecs } from "../src/doctor/patches.ts";

/**
 * A fake app for `svelte-native doctor`: a directory with a package.json, Metro and Expo configs, and a `node_modules` that holds stubs of the
 * library's peers. The packages the library patches hold only the files its patches change, taken from the repository's own install (which
 * pnpm patched), or, for an unpatched package, the same files with the patch taken out again (each hunk's result replaced by what the hunk
 * found, a file the patch creates left out): the shape of the package before pnpm applied anything.
 */
export const repository = resolve(import.meta.dirname, "../../..");
export const library = JSON.parse(readFileSync(join(repository, "packages/svelte-native/package.json"), "utf8")) as { name: string; peerDependencies: Record<string, string>; peerDependenciesMeta: Record<string, { optional?: boolean }> };

/** `text` as it was before the patch's hunks: each hunk's result found in the lines and replaced by what the hunk found. */
export function reversePatch(patch: string, path: string, text: string): string | undefined {
  const file = parsePatch(patch).find((candidate) => candidate.path === path);
  if (!file) return text;
  if (file.created) return undefined;
  const lines = text.split("\n");
  const places = file.hunks.map((hunk) => ({ hunk, start: indexOfBlock(lines, hunk.after) })).sort((a, b) => b.start - a.start);
  for (const { hunk, start } of places) {
    if (start < 0) throw new Error(`${path}: a hunk of the patch is not in the installed file`);
    lines.splice(start, hunk.after.length, ...hunk.before);
  }
  return lines.join("\n");
}

export type FakeApp = {
  /** Patched packages that are left unpatched (by name), or `"all"`. */
  unpatched?: readonly string[] | "all";
  /** Packages left out of node_modules. */
  without?: readonly string[];
  /** Installed versions that differ from the peer's range or the patch's. */
  versions?: Record<string, string>;
  /** Files written over the generated ones, by path from the app (a `null` removes a generated file). */
  files?: Record<string, string | null>;
  /** Declare the patches in a pnpm-workspace.yaml (the app's own copies in patches/svelte-native). Default true. */
  declared?: boolean;
  /** The stock Svelte: no ./renderer export. */
  stockSvelte?: boolean;
};

const concreteVersion = (range: string) => range.replace(/^[~^]/, "");

export function makeFakeApp(options: FakeApp = {}): string {
  const root = mkdtempSync(join(tmpdir(), "doctor-app-"));
  const put = (path: string, text: string) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  };
  const without = new Set(options.without ?? []);
  const unpatched = (name: string) => options.unpatched === "all" || (options.unpatched ?? []).includes(name);
  const version = (name: string, wanted: string) => options.versions?.[name] ?? wanted;
  const stub = (name: string, wanted: string, extra: Record<string, unknown> = {}) => {
    if (!without.has(name)) put(`node_modules/${name}/package.json`, JSON.stringify({ name, version: version(name, wanted), ...extra }));
  };

  const patched = new Map(patchFiles().map((patch) => [patch.package, patch]));
  for (const [name, range] of Object.entries(library.peerDependencies)) {
    if (name === "svelte") continue;
    stub(name, patched.get(name)?.version ?? concreteVersion(range));
  }
  // The runtime `polyfills.ts` imports from expo by path.
  if (!without.has("expo")) for (const file of ["index.ts", "runtime.native.ts"]) put(`node_modules/expo/src/winter/${file}`, "export {};\n");
  stub("svelte", "5.56.7", options.stockSvelte ? { exports: { ".": "./src/index.js" } } : { exports: { ".": "./src/index.js", "./renderer": { default: "./src/renderer/index.js" } } });
  put("node_modules/svelte/src/compiler/validate-options.js", options.stockSvelte ? "export const options = {};\n" : "export const options = { experimental: { customRenderer: true } };\n");
  if (!options.stockSvelte) put("node_modules/svelte/src/renderer/index.js", "export {};\n");

  for (const patch of patchFiles()) {
    if (without.has(patch.package)) continue;
    const spec = patchSpecs.find((candidate) => candidate.package === patch.package);
    const text = readFileSync(patch.path, "utf8");
    // The installed package: the repository's (patched by pnpm), file by file.
    const source = join(repository, "node_modules", patch.package);
    for (const file of parsePatch(text)) {
      const installed = readFileSync(join(source, file.path), "utf8");
      const content = unpatched(patch.package) ? reversePatch(text, file.path, installed) : installed;
      if (content !== undefined) put(`node_modules/${patch.package}/${file.path}`, content);
    }
    if (spec?.via) put(`node_modules/${patch.package}/package.json`, JSON.stringify({ name: patch.package, version: version(patch.package, patch.version) }));
  }

  // `hermes-intl` is a required peer with a native module, which React Native's autolinking links only when the app depends on it itself.
  put("package.json", JSON.stringify({ name: "fake-app", version: "1.0.0", dependencies: { [library.name]: "*", "hermes-intl": "*" } }));
  put("metro.config.cjs", `const { getDefaultConfig } = require("expo/metro-config");\nconst { withSvelteNative } = require("${library.name}/metro");\nmodule.exports = withSvelteNative(getDefaultConfig(__dirname));\n`);
  put("app.json", JSON.stringify({ expo: { name: "fake", plugins: [[`${library.name}/expo`, {}]] } }));
  if (options.declared !== false) {
    put("pnpm-workspace.yaml", `packages: []\npatchedDependencies:\n${patchFiles().map((patch) => `  ${patchKey(patch)}: patches/svelte-native/${patch.file}`).join("\n")}\n`);
    for (const patch of patchFiles()) put(`patches/svelte-native/${patch.file}`, readFileSync(patch.path, "utf8"));
  }
  for (const [path, text] of Object.entries(options.files ?? {})) {
    if (text === null) rmSync(join(root, path), { force: true });
    else put(path, text);
  }
  return root;
}
