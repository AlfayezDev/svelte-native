import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { entries, extensionOf, filesUnder, outputDirectory, packageRoot, writeNode } from "../scripts/build-node.ts";

// `dist/node/` is committed: a git dependency is not built when an app installs it, and Node cannot load the package's TypeScript from under
// `node_modules`. So it has to be what `pnpm --dir packages/svelte-native build` writes for the sources, and this fails when it is not.
const manifest = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")) as {
  exports: Record<string, string | Record<string, string>>;
  bin: Record<string, string>;
  scripts: Record<string, string>;
};
const temporary: string[] = [];
afterAll(() => { for (const directory of temporary) rmSync(directory, { recursive: true, force: true }); });

const built = await (async () => {
  const directory = mkdtempSync(join(tmpdir(), "svelte-native-dist-"));
  temporary.push(directory);
  await writeNode(directory);
  return directory;
})();

describe("dist/node is what the build writes for the sources", () => {
  test("it holds the same files", () => {
    expect(filesUnder(outputDirectory)).toEqual(filesUnder(built));
  });

  test("with the same bytes; after a change to the Node-side code, run `pnpm --dir packages/svelte-native build` and commit dist/node", () => {
    for (const name of filesUnder(built)) expect([name, readFileSync(join(outputDirectory, name)).equals(readFileSync(join(built, name)))]).toEqual([name, true]);
  });

  test("the command line is executable and starts with its shebang", () => {
    for (const directory of [outputDirectory, built]) {
      expect((statSync(join(directory, "cli.js")).mode & 0o111) !== 0).toBe(true);
      expect(readFileSync(join(directory, "cli.js"), "utf8").startsWith("#!/usr/bin/env node\n")).toBe(true);
    }
  });

  test("the build is deterministic: no absolute path of this machine and no timestamp is in it", () => {
    for (const name of filesUnder(outputDirectory)) {
      const text = readFileSync(join(outputDirectory, name), "utf8");
      expect([name, text.includes(packageRoot), text.includes(resolve(packageRoot, "../..")), /\/home\/|\/Users\/|\bC:\\/.test(text)]).toEqual([name, false, false, false]);
    }
  });
});

describe("dist/node holds the Node-side code and none of the React Native runtime", () => {
  // esbuild marks each module it inlines with a `// <path>` comment: the sources a file was built from.
  const inlined = (name: string) => [...readFileSync(join(outputDirectory, name), "utf8").matchAll(/^\/\/ (src\/\S+)$/gm)].map((match) => match[1]);

  test("every file is built from the files of src/ and nothing else", () => {
    for (const entry of entries) {
      const modules = inlined(`${entry.name}${extensionOf(entry.format)}`);
      if (entry.name !== "routes") expect(modules).toContain(entry.source);
      expect(modules.filter((module) => !/^src\/.+\.ts$/.test(module))).toEqual([]);
    }
  });

  test("none of them reaches the Fabric host, the components or a Svelte file: those are Metro's and stay TypeScript", () => {
    for (const entry of entries) expect(inlined(`${entry.name}${extensionOf(entry.format)}`).filter((module) => /^src\/(fabric|components|gestures|updates)\/|\.svelte/.test(module))).toEqual([]);
  });

  test("a CommonJS file has no import.meta (the build replaces it with the module's own __filename and __dirname)", () => {
    for (const entry of entries.filter((candidate) => candidate.format === "cjs"))
      expect([entry.name, /import\.meta/.test(readFileSync(join(outputDirectory, `${entry.name}.cjs`), "utf8"))]).toEqual([entry.name, false]);
  });
});

describe("package.json points at the built files", () => {
  const built = Object.entries(manifest.exports).flatMap(([entry, target]) => (typeof target === "string" ? [] : [[entry, target] as const]));
  const files = entries.map((entry) => `./dist/node/${entry.name}${extensionOf(entry.format)}`);

  test("every built entry is the `default` of an export (or the bin, or the config plugin's file), with the TypeScript source as its `types`", () => {
    // `expo.cjs` is not an export of its own (`@alfayez/svelte-native/expo` was removed in 0.4.0-rc.7): `app.plugin.js`, the `./app.plugin` export, imports it.
    expect(readFileSync(join(packageRoot, "app.plugin.js"), "utf8")).toContain('import plugin from "./dist/node/expo.cjs";');
    const targets = [...built.map(([, target]) => target.default), manifest.bin["svelte-native"], "./dist/node/expo.cjs"].sort();
    expect(targets).toEqual([...files].sort());
    for (const [entry, target] of built) {
      expect(Object.keys(target), entry).toEqual(["types", "default"]);
      expect(target.types, entry).toMatch(/^\.\/src\/.+\.ts$/);
    }
  });

  test("each export is built from the source its `types` names", () => {
    for (const [entry, target] of built) {
      const name = target.default.replace(/^\.\/dist\/node\//, "").replace(/\.c?js$/, "");
      expect([entry, entries.find((candidate) => candidate.name === name)?.source]).toEqual([entry, target.types.replace(/^\.\//, "")]);
    }
  });

  test("a runtime entry stays the TypeScript Metro compiles: a path, not built", () => {
    for (const entry of [".", "./core", "./app", "./renderer", "./foreign", "./router", "./updates", "./remote", "./remote/runtime", "./remote/globals"])
      expect([entry, typeof manifest.exports[entry]]).toEqual([entry, "string"]);
  });
});

describe("an app installs the package as a git dependency, where nothing is built", () => {
  // pnpm builds nothing for a git dependency unless the package has a script it prepares with, and then refuses the install (ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED,
  // and ERR_PNPM_IGNORED_BUILDS for an install script) until the app allows the package to build; allowed, it installs the package's development dependencies in a
  // clone and runs the script. So the built files are committed and the package has no script that would build them.
  test("the package has no prepare, prepack, prepublish, publish, preinstall, install or postinstall script", () => {
    expect(Object.keys(manifest.scripts).filter((name) => ["prepare", "prepack", "prepublish", "publish", "preinstall", "install", "postinstall"].includes(name))).toEqual([]);
    expect(manifest.scripts.build).toBe("node scripts/build-node.ts");
  });

  test("dist/node is not ignored by git (the repository's .gitignore ignores dist/ elsewhere)", () => {
    const git = Bun.which("git");
    if (!git) return;
    const inside = Bun.spawnSync([git, "rev-parse", "--is-inside-work-tree"], { cwd: packageRoot, stdout: "pipe", stderr: "pipe" });
    if (inside.exitCode !== 0) return;
    const ignored = Bun.spawnSync([git, "check-ignore", ...filesUnder(outputDirectory).map((name) => join("dist/node", name))], { cwd: packageRoot, stdout: "pipe" });
    expect(ignored.stdout.toString()).toBe("");
  });
});
