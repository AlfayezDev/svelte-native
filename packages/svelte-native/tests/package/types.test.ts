import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import ts from "typescript";
import { buildTypes, declarationOf, packageRoot, renamedForCase, typeEntries, typesDirectory } from "../../scripts/build-types.ts";

// `dist/types/` is committed: a git dependency is not built when an app installs it, and an app's type checker reads these declarations instead of the sources
// (`types` condition of each entry in `package.json`). So it has to be what `pnpm --dir packages/svelte-native build` writes for the sources, and this fails when it
// is not. `type-budget.test.ts` is what keeps them cheap to read.
const repositoryRoot = resolve(packageRoot, "../..");
const manifest = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")) as {
  exports: Record<string, string | Record<string, string>>;
  files: string[];
  scripts: Record<string, string>;
};
/** The condition of the exports map that names the sources: a name of its own, because a `source` condition is what many React Native libraries have for theirs (`react-native-builder-bob`), and an app that took it would check those too. */
const condition = "svelte-native-source";
const built = await buildTypes();

/** The files under `directory` (relative paths, sorted). */
const filesUnder = (directory: string): string[] =>
  readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter((item) => item.isFile())
    .map((item) => relative(directory, join(item.parentPath, item.name)))
    .sort();

describe("dist/types is what the build writes for the sources", () => {
  test("it holds the same files", () => {
    expect(filesUnder(typesDirectory)).toEqual([...built.keys()].sort());
  });

  test("with the same bytes; after a change to a public type, run `pnpm --dir packages/svelte-native build` and commit dist/types", () => {
    for (const [name, text] of built) expect([name, readFileSync(join(typesDirectory, name), "utf8") === text]).toEqual([name, true]);
  });

  test("the build is deterministic: no absolute path of this machine is in it", () => {
    for (const [name, text] of built) expect([name, text.includes(packageRoot), text.includes(repositoryRoot), /\/home\/|\/Users\/|\bC:\\/.test(text)]).toEqual([name, false, false, false]);
  });

  test("no two files differ only in case (a case-insensitive file system, macOS or Windows, holds one of them): `router.svelte.d.ts` is `router.svelte-module.d.ts` beside `Router.svelte.d.ts`", () => {
    const names = [...built.keys()];
    expect(names.filter((name, index) => names.findIndex((other) => other.toLowerCase() === name.toLowerCase()) !== index)).toEqual([]);
    expect(renamedForCase).toEqual({ "router.svelte.d.ts": "router.svelte-module.d.ts" });
    for (const [from, to] of Object.entries(renamedForCase)) expect([from, built.has(from), to, built.has(to)]).toEqual([from, false, to, true]);
  });

  test("every relative specifier names a declaration that is in it: `.js` for a `.d.ts`, `.svelte` for a component's `.svelte.d.ts` (never `.ts`)", () => {
    const missing: string[] = [];
    for (const [name, text] of built) {
      for (const match of text.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)["'](\.\.?\/[^"']+)["']/g)) {
        const specifier = match[1] ?? "";
        const target = join(dirname(name), specifier);
        const wanted = specifier.endsWith(".svelte") ? `${target}.d.ts` : specifier.endsWith(".js") ? `${target.slice(0, -3)}.d.ts` : `(not .js or .svelte) ${target}`;
        if (!built.has(wanted)) missing.push(`${name}: ${specifier}`);
      }
    }
    expect(missing).toEqual([]);
  });

  test("a component's declaration is a Svelte component type and its props are the ones the source declares", () => {
    const view = built.get("components/View.svelte.d.ts") ?? "";
    expect(view).toContain('declare const View: import("svelte").Component<$$ComponentProps, {}, "">;');
    expect(view).toContain("export default View;");
    expect(built.get("components/AnimatedView.svelte.d.ts")).toContain("entering?: BaseAnimationBuilder");
  });

  test("`/vite` and `/router` carry the reference to the declaration that adds `mobile` to `$app/env` (TypeScript drops a `/// <reference path>` from a declaration)", () => {
    for (const name of ["vite.d.ts", "router.svelte-module.d.ts"]) expect([name, (built.get(name) ?? "").startsWith('/// <reference path="./kit/modules.d.ts" />\n')]).toEqual([name, true]);
    expect(built.get("kit/modules.d.ts")).toContain('declare module "$app/env"');
  });

  test("the declarations name none of React Native's internal modules, and the ambient declarations of those are not shipped (they are for the source)", () => {
    expect([...built.keys()].filter((name) => name.endsWith("react-native-internals.d.ts"))).toEqual([]);
    for (const [name, text] of built) expect([name, /reference path="[^"]*react-native-internals/.test(text)]).toEqual([name, false]);
  });

  test("the declarations of the primitives do not load Reanimated or react-native-svg (`AnimatedView`, the animation and the SVG components name them, and the main entry exports those)", () => {
    const heavy = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)["']react-native-(?:reanimated|worklets|svg)/;
    for (const name of ["core.d.ts", "elements.d.ts", "components/View.svelte.d.ts", "components/Text.svelte.d.ts", "components/Pressable.svelte.d.ts", "gestures/types.d.ts"]) expect([name, heavy.test(built.get(name) ?? "")]).toEqual([name, false]);
  });
});

describe("package.json points at the declarations", () => {
  const withTypes = Object.entries(manifest.exports).flatMap(([entry, target]) => (typeof target === "string" || target.types === undefined ? [] : [[entry, target] as const]));

  test("each entry with a `types` condition has a `svelte-native-source` (what this repository checks against), `types` (the declaration) and `default` (what runs), in that order", () => {
    expect(withTypes.length).toBeGreaterThan(15);
    for (const [entry, target] of withTypes) expect(Object.keys(target), entry).toEqual([condition, "types", "default"]);
  });

  test("`types` is the declaration of `svelte-native-source` in dist/types, and both are files", () => {
    for (const [entry, target] of withTypes) {
      expect([entry, target.types]).toEqual([entry, `./dist/types/${declarationOf((target[condition] ?? "").replace(/^\.\//, ""))}`]);
      expect([entry, existsSync(join(packageRoot, target[condition] ?? ""))]).toEqual([entry, true]);
      expect([entry, existsSync(join(packageRoot, target.types ?? ""))]).toEqual([entry, true]);
    }
  });

  test("the entries tsconfig.types.json lists are the sources of the exports, and the other way round", () => {
    expect(typeEntries().map((entry) => `./${entry}`).sort()).toEqual([...new Set(withTypes.map(([, target]) => target[condition] ?? ""))].sort());
  });

  test("the declarations ship (`files`) and git does not ignore them (the repository's .gitignore ignores dist/ elsewhere)", () => {
    expect(manifest.files).toContain("dist/types");
    const git = Bun.which("git");
    if (!git) return;
    const inside = Bun.spawnSync([git, "rev-parse", "--is-inside-work-tree"], { cwd: packageRoot, stdout: "pipe", stderr: "pipe" });
    if (inside.exitCode !== 0) return;
    const ignored = Bun.spawnSync([git, "check-ignore", ...[...built.keys()].map((name) => join("dist/types", name))], { cwd: packageRoot, stdout: "pipe" });
    expect(ignored.stdout.toString()).toBe("");
  });

  test("the build writes them with the Node entries: `pnpm build` is build-node.ts, which calls build-types.ts", () => {
    expect(manifest.scripts.build).toBe("node scripts/build-node.ts");
    expect(readFileSync(join(packageRoot, "scripts/build-node.ts"), "utf8")).toContain('await import("./build-types.ts")');
  });
});

describe("this repository checks the library against its sources", () => {
  // The apps and the package's own files take the `svelte-native-source` condition of the exports map, so an edit to `src/` needs no rebuild of `dist/types`; an app outside the repository
  // does not set it and reads the declarations.
  const configs = ["packages/svelte-native/tsconfig.json", "apps/example/tsconfig.json", "apps/example/test/tsconfig.json", "apps/qa/tsconfig.json", "apps/qa/qa/tsconfig.json"];

  for (const config of configs)
    test(`${config} has customConditions: ["${condition}"]`, () => {
      const parsed = ts.parseConfigFileTextToJson(config, readFileSync(join(repositoryRoot, config), "utf8"));
      expect(parsed.error).toBeUndefined();
      expect((parsed.config as { compilerOptions: { customConditions?: string[] } }).compilerOptions.customConditions).toEqual([condition]);
    });

  test("no tsconfig of a fixture that stands for an app outside the repository sets it", () => {
    for (const fixture of ["package/fixtures/bare-app", "package/fixtures/installed-app", "kit/fixtures/kit-app", "kit/fixtures/web-mobile-app", "cli/fixtures/sv-minimal"]) {
      const directory = join(import.meta.dirname, "..", fixture);
      for (const file of readdirSync(directory).filter((name) => /^tsconfig.*\.json$/.test(name)))
        expect([fixture, file, readFileSync(join(directory, file), "utf8").includes("customConditions")]).toEqual([fixture, file, false]);
    }
  });
});
