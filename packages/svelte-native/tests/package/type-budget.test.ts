import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { packageRoot as packageDirectory } from "../support/paths.ts";

/**
 * What the library costs an app's type checker. The package ships declarations (`dist/types`, the `types` condition of each entry) so that an app's `tsc`, `svelte-check` and
 * editor read a few thousand lines of declarations and not the library's implementation (`src/`: eleven thousand lines of TypeScript and Svelte that `skipLibCheck` does not skip).
 * This runs `tsc --extendedDiagnostics` on two apps that do not take this repository's `svelte-native-source` condition, as an installed package is read:
 *
 *   view-text   `import { Text, View } from "@alfayez/svelte-native"`: the smallest app
 *   features    the same, and `withTiming` (an animation), `Gesture` (a gesture) and `Svg` (an SVG component)
 *
 * and fails when the files the checker loads, or the instantiations it makes, grow past the budget below. The two are equal in files because the main entry re-exports the
 * animation, gesture and SVG exports (`export *`), and TypeScript loads every module a barrel names whatever the app imports from it: what the animation exports are typed with
 * (react-native-reanimated, and react-native-svg, which Reanimated's own declarations import) is loaded for the smallest app too. The files of `/core` (the primitives alone)
 * are a third case, which keeps Reanimated and react-native-svg out.
 *
 * Counts, not times: a count is the same on every machine (given the lockfile's versions of React Native, Reanimated and the rest, which are most of the files), a time is not.
 * The budget is what was measured with 15 % to spare. When this fails:
 *
 *   1. Find what grew: `cd packages/svelte-native && bun test tests/type-budget.test.ts` prints the numbers in the failure, and `tsc -p <fixture> --explainFiles` (the fixture's
 *      directory is printed too, with `KEEP_TYPE_BUDGET_FIXTURE=1`) says which declaration imported each file. A new `import` of a package in `dist/types` is the usual cause: a
 *      type of the library that names another package's types makes every app load them.
 *   2. If the growth is wanted (a new dependency's types, a feature), measure again with `KEEP_TYPE_BUDGET_FIXTURE=1 bun test tests/type-budget.test.ts` and put the new numbers
 *      here, rounded up by 15 %.
 */
// Measured 2026-11-13 (TypeScript 6.0.3, React Native 0.86.3, Reanimated 4.5.1): 600 files and 1,146 instantiations; 600 and 2,997; 227 and 1,146. Sources, for the same
// first app: 613 files and 12,997 instantiations.
const budget = {
  "view-text": { files: 690, instantiations: 1320 },
  features: { files: 690, instantiations: 3450 },
  core: { files: 262, instantiations: 1320 },
} as const;

const packageRoot = realpathSync(packageDirectory);
/** `tsc --listFiles` prints real paths: these name the package's sources and its declarations. */
const sourceFiles = `${join(packageRoot, "src")}/`;
const declarationFiles = `${join(packageRoot, "dist/types")}/`;
const require = createRequire(import.meta.url);
const tsc = join(dirname(require.resolve("typescript/package.json")), "bin/tsc");
const node = Bun.which("node");

const scratch = mkdtempSync(join(tmpdir(), "svelte-native-type-budget-"));
afterAll(() => { if (!process.env.KEEP_TYPE_BUDGET_FIXTURE) rmSync(scratch, { recursive: true, force: true }); else console.log(`type budget fixture: ${scratch}`); });

// An app outside this repository: the package is `node_modules/@alfayez/svelte-native` (a link to the package here, whose peers resolve from the repository's `node_modules` as an
// install's would), no `customConditions`, so the entries' `types` condition is what resolves.
const app = join(scratch, "app");
mkdirSync(join(app, "node_modules/@alfayez"), { recursive: true });
symlinkSync(packageRoot, join(app, "node_modules/@alfayez/svelte-native"));
// A SvelteKit project has SvelteKit's declarations in every program (its generated tsconfig loads them): `/remote` types its forms with `$app/server` and `App`.
mkdirSync(join(app, "node_modules/@sveltejs"), { recursive: true });
symlinkSync(dirname(require.resolve("@sveltejs/kit/package.json")), join(app, "node_modules/@sveltejs/kit"));

// Every typed entry, imported whole: the declaration of each is what must resolve.
const manifest = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")) as { exports: Record<string, string | Record<string, string>> };
const typedEntries = Object.entries(manifest.exports).flatMap(([entry, target]) => (typeof target === "string" || target.types === undefined ? [] : [{ specifier: `@alfayez/svelte-native${entry.slice(1)}`, declaration: join(packageRoot, target.types) }]));

const fixtures = {
  "view-text": 'import { Text, View } from "@alfayez/svelte-native";\nexport const used = [View, Text];\n',
  features: 'import { Gesture, Svg, Text, View, withTiming } from "@alfayez/svelte-native";\nexport const used = [View, Text, withTiming, Gesture, Svg];\n',
  core: 'import { Text, View } from "@alfayez/svelte-native/core";\nexport const used = [View, Text];\n',
} as const;
for (const [name, source] of Object.entries(fixtures)) writeFileSync(join(app, `${name}.ts`), source);
writeFileSync(join(app, "entries.ts"), `${typedEntries.map(({ specifier }, index) => `import * as entry${index} from "${specifier}";`).join("\n")}\nexport const all = [${typedEntries.map((_, index) => `entry${index}`).join(", ")}];\n`);

const compilerOptions = { target: "ES2022", module: "ESNext", moduleResolution: "bundler", strict: true, skipLibCheck: true, noEmit: true, types: [] };
const writeConfig = (file: string, name: string, extra: object = {}, more: string[] = []) => writeFileSync(join(app, file), JSON.stringify({ compilerOptions: { ...compilerOptions, ...extra }, files: [`${name}.ts`, ...more] }));
for (const name of [...Object.keys(fixtures), "entries"]) writeConfig(`tsconfig.${name}.json`, name);
// The same entries with the checker's own rule off (`skipLibCheck`): the package's declarations are then checked too, and what is reported in them is the package's to fix.
writeConfig("tsconfig.declarations.json", "entries", { skipLibCheck: false, types: ["@sveltejs/kit"] });
// The same program with what this repository's apps set: the sources are what the package's `svelte-native-source` condition names. `tsc` does not read `.svelte` files (svelte-check does): a shim stands
// in for them, as it does in a plain `tsc` run of an app.
writeFileSync(join(app, "svelte-shim.d.ts"), 'declare module "*.svelte" { const component: import("svelte").Component<any>; export default component; }\n');
writeConfig("tsconfig.source.json", "view-text", { customConditions: ["svelte-native-source"], allowImportingTsExtensions: true }, ["svelte-shim.d.ts"]);

type Measure = { files: number; instantiations: number; listed: string[]; errors: string[]; seconds: number };

/** One `tsc` run per program: three tests read the main entry's. */
const measured = new Map<string, Measure>();
function measure(config: string): Measure {
  let result = measured.get(config);
  if (!result) {
    result = run(config);
    measured.set(config, result);
  }
  return result;
}

function run(config: string): Measure {
  if (!node) throw new Error("node is not on the PATH: tsc runs under it");
  const done = Bun.spawnSync([node, tsc, "-p", join(app, config), "--extendedDiagnostics", "--listFiles"], { cwd: app, stdout: "pipe", stderr: "pipe" });
  const lines = done.stdout.toString().split("\n");
  const number = (label: string) => Number(new RegExp(`^${label}:\\s+([\\d.]+)`, "m").exec(done.stdout.toString())?.[1] ?? Number.NaN);
  return {
    files: number("Files"),
    instantiations: number("Instantiations"),
    seconds: number("Total time"),
    listed: lines.filter((line) => line.startsWith("/")),
    errors: lines.filter((line) => /error TS\d+/.test(line)),
  };
}

const budgetMessage = (name: string, what: string, got: number, limit: number) =>
  `${name}: ${what} ${got} is over the budget of ${limit} (tests/package/type-budget.test.ts: what an app's type checker loads of the package and its peers; its header says how to find what grew and how to re-measure)`;

describe("an app that has the package installed type-checks against dist/types, and the program stays small", () => {
  for (const [name, limit] of Object.entries(budget)) {
    test(`${name}: no error, the declarations and no source are read, and the files and instantiations are within the budget`, () => {
      const result = measure(`tsconfig.${name}.json`);
      if (process.env.KEEP_TYPE_BUDGET_FIXTURE) console.log(`type budget ${name}: ${result.files} files, ${result.instantiations} instantiations, ${result.seconds}s`);
      expect(result.errors).toEqual([]);
      expect(result.listed.filter((file) => file.startsWith(sourceFiles))).toEqual([]);
      expect(result.listed.some((file) => file.startsWith(declarationFiles))).toBe(true);
      expect(result.files, budgetMessage(name, "files", result.files, limit.files)).toBeLessThanOrEqual(limit.files);
      expect(result.instantiations, budgetMessage(name, "instantiations", result.instantiations, limit.instantiations)).toBeLessThanOrEqual(limit.instantiations);
    }, 60_000);
  }

  test("every typed entry of the exports map resolves to its declaration, with no error in an app", () => {
    const { listed, errors } = measure("tsconfig.entries.json");
    expect(errors).toEqual([]);
    expect(typedEntries.length).toBeGreaterThan(15);
    for (const { specifier, declaration } of typedEntries) expect([specifier, listed.includes(declaration)]).toEqual([specifier, true]);
    expect(listed.filter((file) => file.startsWith(sourceFiles))).toEqual([]);
  }, 60_000);

  test("the package's own declarations are free of errors (`skipLibCheck` off: what an app that checks libraries sees; the other packages' errors are theirs)", () => {
    const { errors } = measure("tsconfig.declarations.json");
    expect(errors.filter((line) => line.includes("svelte-native/dist/types/"))).toEqual([]);
  }, 60_000);

  test("the primitives alone (`/core`) load neither Reanimated nor react-native-svg", () => {
    const { listed } = measure("tsconfig.core.json");
    expect(listed.filter((file) => /\/react-native-(?:reanimated|worklets|svg)\//.test(file))).toEqual([]);
  }, 60_000);

  test("the animation, gesture and SVG exports are what bring Reanimated, Worklets, react-native-svg and the gesture handler into the main entry's program", () => {
    const { listed } = measure("tsconfig.view-text.json");
    for (const name of ["react-native-reanimated", "react-native-worklets", "react-native-svg", "react-native-gesture-handler"]) expect([name, listed.some((file) => file.includes(`/${name}/`))]).toEqual([name, true]);
  }, 60_000);

  test("control: with the `svelte-native-source` condition (this repository's apps) the same program reads the library's sources and no declaration, and is the larger", () => {
    const sources = measure("tsconfig.source.json");
    const declarations = measure("tsconfig.view-text.json");
    expect(sources.errors).toEqual([]);
    expect(sources.listed.some((file) => file.startsWith(sourceFiles))).toBe(true);
    expect(sources.listed.filter((file) => file.startsWith(declarationFiles))).toEqual([]);
    expect(sources.instantiations).toBeGreaterThan(declarations.instantiations * 3);
  }, 60_000);
});
