/**
 * Builds the type declarations an app's type checker reads, into `dist/types/` (committed: `pnpm --dir packages/svelte-native build` writes them
 * after `dist/node/`).
 *
 * The package ships TypeScript and Svelte sources, which Metro and Vite compile. Pointing an app's checker at them as well makes it parse and check the
 * library's implementation (`skipLibCheck` does not apply to a `.ts` file), so the `types` condition of every public entry in `package.json` names a
 * declaration file instead, and the `svelte-native-source` condition (which only this repository turns on, `customConditions` in its tsconfigs) keeps the apps and
 * tests here checking against the sources. `.d.ts` files come from TypeScript's declaration emit, `.svelte.d.ts` files from svelte2tsx (`emitDts`, which
 * `@sveltejs/package` uses): one for each component an entry reaches.
 *
 * What is written is what an entry reaches. `tsconfig.types.json` lists the entries; TypeScript emits every source file they import; the emitted
 * files, and the hand-written `.d.ts` files of `src/`, are then followed from the entries' declarations, and the ones nothing in a declaration names
 * are left out (an import that only a function body used is not in its declaration). Relative specifiers end in `.js`, which every module resolution
 * mode reads as the `.d.ts` beside it (`.svelte` ones stay: `Foo.svelte.d.ts` is what `./Foo.svelte` finds). No two files differ only in case (`renamedForCase`).
 *
 * Deterministic: the same sources and the same TypeScript and svelte2tsx give the same bytes (no timestamps, no absolute paths, sorted files).
 * `tests/package/types.test.ts` fails when `dist/types/` is not what this script writes for the sources.
 */
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, posix, relative, resolve, sep } from "node:path";
import { emitDts } from "svelte2tsx";
import ts from "typescript";

export const packageRoot = resolve(import.meta.dirname, "..");
export const typesDirectory = join(packageRoot, "dist/types");

const require = createRequire(import.meta.url);

/** The tsconfig that lists the entries (its `files`) and the compiler options of the declaration emit. */
export const typesConfig = "tsconfig.types.json";

/** The entry files of the declarations, relative to the package (`src/index.ts`): the `files` of `tsconfig.types.json`. */
export function typeEntries(): string[] {
  const read = ts.readConfigFile(join(packageRoot, typesConfig), ts.sys.readFile);
  if (read.error) throw new Error(`${typesConfig} is not readable: ${ts.flattenDiagnosticMessageText(read.error.messageText, "\n")}`);
  return (read.config as { files: string[] }).files;
}

/**
 * Declarations whose names differ from another's only in case, written under another name (relative to `dist/types/`, `from` to `to`): `Router.svelte` is a component and
 * `router.svelte.ts` the module of the router, so their declarations would be `Router.svelte.d.ts` and `router.svelte.d.ts`, and a case-insensitive file system (macOS and
 * Windows: an app's checkout, the rsync of this repository to a Mac) holds one of the two. The build renames the second and every specifier that names it follows, and fails
 * when a pair is left that is not listed here.
 */
export const renamedForCase: Readonly<Record<string, string>> = { "router.svelte.d.ts": "router.svelte-module.d.ts" };

/** Where an entry's declaration is, relative to `dist/types/`: `src/updates/index.ts` is `updates/index.d.ts`, `src/elements.d.ts` stays as it is. */
export const declarationOf = (entry: string): string => {
  const name = entry.replace(/^src\//, "").replace(/(?<!\.d)\.ts$/, ".d.ts");
  return renamedForCase[name] ?? name;
};

/** Every file under `directory`, relative to it, sorted, with forward slashes. */
function filesUnder(directory: string): string[] {
  return readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter((item) => item.isFile())
    .map((item) => relative(directory, join(item.parentPath, item.name)).split(sep).join("/"))
    .sort();
}

/**
 * A relative specifier of the emitted declarations ends in `.ts` (the sources import `./core.ts`) or `.d.ts` (a hand-written one); `.js` is what every
 * module resolution mode maps to the declaration file beside it. `.svelte` specifiers are left alone, and so are `/// <reference path>` lines (a path,
 * not a specifier).
 */
const specifier = /((?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*)["'])(\.\.?\/[^"']*?)(?:\.d)?\.ts(["'])/g;
export const withJsSpecifiers = (text: string): string => text.replace(specifier, "$1$2.js$3");

/** Emits the declarations of everything `tsconfig.types.json` reaches into `directory` (as `src/…`, the layout of the package), failing on what svelte2tsx warns about. */
async function emit(directory: string): Promise<void> {
  const warnings: string[] = [];
  const warn = console.warn;
  console.warn = (...args: unknown[]) => { warnings.push(args.map(String).join(" ")); };
  const cwd = process.cwd();
  try {
    process.chdir(packageRoot);
    await emitDts({ libRoot: packageRoot, declarationDir: directory, svelteShimsPath: require.resolve("svelte2tsx/svelte-shims-v4.d.ts"), tsconfig: typesConfig });
  } finally {
    process.chdir(cwd);
    console.warn = warn;
  }
  if (warnings.length > 0) throw new Error(`The declaration emit says it did not write every declaration:\n${warnings.join("\n").replaceAll(packageRoot, ".")}`);
}

/**
 * The reference of a hand-written declaration file to the ambient declarations of React Native's internal modules (`/// <reference path="./fabric/react-native-internals.d.ts" />`,
 * with the lint comment above it). Those are for the source: a declaration names none of the modules, so an app's program need not load them.
 */
const internalsReference = /^(?:\/\/ eslint-disable-next-line [^\n]*\n)?\/\/\/\s*<reference path="[^"]*react-native-internals\.d\.ts"\s*\/>\n/m;

/** The hand-written declaration files of `src/` (an ambient `declare module`, the `svelte/elements` augmentation): TypeScript does not emit them, so they are copied. */
function copyHandWritten(directory: string): void {
  for (const name of filesUnder(join(packageRoot, "src")).filter((file) => file.endsWith(".d.ts"))) {
    mkdirSync(dirname(join(directory, "src", name)), { recursive: true });
    copyFileSync(join(packageRoot, "src", name), join(directory, "src", name));
    const path = join(directory, "src", name);
    writeFileSync(path, readFileSync(path, "utf8").replace(internalsReference, ""));
  }
}

/** Writes the declarations of `renamedForCase` under their other names and points every specifier at them; fails on a pair of names that differ only in case. */
function renameForCase(directory: string): void {
  for (const [from, to] of Object.entries(renamedForCase)) renameSync(join(directory, "src", from), join(directory, "src", to));
  const named = /((?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*)["'])(\.\.?\/[^"']*?)\.js(["'])/g;
  for (const name of filesUnder(directory)) {
    const folder = posix.dirname(name.replace(/^src\//, ""));
    const path = join(directory, name);
    const text = readFileSync(path, "utf8");
    const next = text.replace(named, (whole: string, before: string, specifier: string, after: string) => {
      const renamed = renamedForCase[posix.join(folder, `${specifier}.d.ts`)];
      if (renamed === undefined) return whole;
      const relativePath = posix.relative(folder, renamed.replace(/\.d\.ts$/, ""));
      return `${before}${relativePath.startsWith(".") ? relativePath : `./${relativePath}`}.js${after}`;
    });
    if (next !== text) writeFileSync(path, next);
  }
  const seen = new Map<string, string>();
  for (const name of filesUnder(directory)) {
    const other = seen.get(name.toLowerCase());
    if (other !== undefined) throw new Error(`Two declarations differ only in case, which a case-insensitive file system cannot hold: ${other} and ${name}. Name one of them in renamedForCase (scripts/build-types.ts).`);
    seen.set(name.toLowerCase(), name);
  }
}

/**
 * The hand-written declaration files (relative to `src/`) that add to what an app's checker knows (here SvelteKit's `$app/env`, which gains `mobile`), as opposed
 * to the ones that only declare what the implementation imports. TypeScript drops a `/// <reference path>` from a declaration, so a file of `src/` that references one
 * of these has the line put back in its own: an app reaches the declaration through `/vite` and `/router`, as it did when the sources were what it checked.
 */
const publicAmbient: readonly string[] = ["kit/modules.d.ts", "vendor-types.d.ts"];

function carryReferences(directory: string): void {
  for (const name of filesUnder(join(packageRoot, "src")).filter((file) => file.endsWith(".ts") && !file.endsWith(".d.ts"))) {
    const emitted = join(directory, "src", name.replace(/\.ts$/, ".d.ts"));
    if (!existsSync(emitted)) continue;
    const references = [...readFileSync(join(packageRoot, "src", name), "utf8").matchAll(/^\/\/\/\s*<reference path="([^"]+)"\s*\/>$/gm)]
      .map((match) => match[1] ?? "")
      .filter((path) => publicAmbient.includes(posix.normalize(posix.join(posix.dirname(name), path))));
    if (references.length > 0) writeFileSync(emitted, `${references.map((path) => `/// <reference path="${path}" />\n`).join("")}${readFileSync(emitted, "utf8")}`);
  }
}

/** The files of `directory` a checker loads when it starts from `roots` (their relative imports, exports and references). */
function reachableFrom(directory: string, roots: readonly string[]): string[] {
  const options: ts.CompilerOptions = { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, noEmit: true, types: [], skipLibCheck: true };
  const program = ts.createProgram(roots.map((root) => join(directory, root)), options);
  const inside = join(directory, sep);
  return program.getSourceFiles().map((file) => file.fileName).filter((file) => file.startsWith(inside)).map((file) => relative(directory, file).split(sep).join("/")).sort();
}

/** What `dist/types/` should hold: file name to text, in the order of the names. */
export async function buildTypes(): Promise<Map<string, string>> {
  const directory = mkdtempSync(join(tmpdir(), "svelte-native-types-"));
  try {
    await emit(directory);
    copyHandWritten(directory);
    carryReferences(directory);
    for (const name of filesUnder(directory)) {
      const path = join(directory, name);
      writeFileSync(path, withJsSpecifiers(readFileSync(path, "utf8")));
    }
    renameForCase(directory);
    const roots = typeEntries().map((entry) => `src/${declarationOf(entry)}`);
    const files = new Map<string, string>();
    for (const name of reachableFrom(directory, roots)) files.set(name.replace(/^src\//, ""), readFileSync(join(directory, name), "utf8"));
    return files;
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

/** Replaces the contents of `directory` with the build. */
export async function writeTypes(directory: string = typesDirectory): Promise<string[]> {
  const files = await buildTypes();
  rmSync(directory, { recursive: true, force: true });
  for (const [name, text] of files) {
    mkdirSync(dirname(join(directory, name)), { recursive: true });
    writeFileSync(join(directory, name), text);
  }
  return [...files.keys()];
}

if (import.meta.main) {
  const names = await writeTypes();
  console.log(`dist/types/  ${names.length} files`);
}
