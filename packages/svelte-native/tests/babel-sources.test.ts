import { expect, test } from "bun:test";
import { transformSync } from "@babel/core";
import { createRequire } from "node:module";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";

/**
 * An app that installs the library (a tarball, a git dependency) has its sources under `node_modules`, and Metro's transformer leaves the TypeScript of a file there to Babel
 * (`transformer.ts` strips types with esbuild only for the app's own files and for `.svelte.ts` modules). Babel with `babel-preset-expo`, the config of an app (`apps/example`), rejects
 * TypeScript that esbuild and `tsc` accept: a `declare` field (`class InlineStyle { declare overflow: string }`) fails the whole bundle with "The 'declare' modifier is only allowed when
 * the 'allowDeclareFields' option...". Every source file the app bundle can reach is put through that Babel, with a filename under `node_modules/@rasheed/svelte-native/`, so TypeScript it
 * cannot take fails here and not in a consumer's `bundle`.
 */
const require = createRequire(import.meta.url);
const root = resolve(import.meta.dirname, "..");
const preset = (() => {
  try {
    return require.resolve("babel-preset-expo", { paths: [dirname(require.resolve("expo/package.json"))] });
  } catch {
    return require.resolve("babel-preset-expo");
  }
})();

const sources = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sources(path);
    return entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts") ? [path] : [];
  });

test("every TypeScript source of the library compiles with the Babel config of an app, as a file under node_modules", () => {
  // The Worklets plugin reads the file it compiles from disk, so the path under `node_modules` is a real one: the package is linked into a fake app.
  const app = mkdtempSync(join(tmpdir(), "svelte-native-babel-"));
  try {
    mkdirSync(join(app, "node_modules", "@rasheed"), { recursive: true });
    symlinkSync(root, join(app, "node_modules", "@rasheed", "svelte-native"));
    const files = sources(join(root, "src"));
    expect(files.length).toBeGreaterThan(100);
    const failures: string[] = [];
    for (const file of files) {
      const filename = join(app, "node_modules", "@rasheed", "svelte-native", relative(root, file));
      try {
        transformSync(readFileSync(file, "utf8"), {
          filename,
          babelrc: false,
          configFile: false,
          presets: [preset],
          caller: { name: "metro", bundler: "metro", platform: "android", engine: "hermes", isDev: false, isServer: false } as never,
        });
      } catch (error) {
        failures.push(`${relative(root, file)}: ${String((error as Error).message).split("\n")[0]?.slice(-220)}`);
      }
    }
    expect(failures).toEqual([]);
  } finally {
    rmSync(app, { recursive: true, force: true });
  }
}, 120_000);
