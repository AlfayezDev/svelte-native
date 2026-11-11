/**
 * The build side of `class` on components (Node): Tailwind 4 compiles the app's CSS file for the classes the app's sources use, `convert.ts`
 * turns that CSS into the class table (`table.ts`), and the table is written to `.svelte-native/classes.<variant>.ts`, which Metro serves as
 * `@example/svelte-native/classes-table` (`css/runtime.ts` reads it). The Metro integration runs it when the config loads (`withSvelteNative`'s
 * `css` option) and, in development, again whenever a source or the CSS changes (`watchClasses`).
 *
 * Tailwind is the app's own (`tailwindcss`, an optional peer): it is loaded from the project, never from the library.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, watch, writeFileSync, type FSWatcher } from "node:fs";
import { createRequire } from "node:module";
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { unrefTimer } from "../build.ts";
import { packageRoot, sourceFile } from "../package-root.ts";
import { classesTableFile } from "../variant.ts";
import { convertCss } from "./convert.ts";
import type { ClassTable, Unsupported } from "./table.ts";
import { watchTree } from "../watch-tree.ts";

/** The Tailwind the converter is written against (the package's optional peer): the app installs this one. */
export const TAILWIND_VERSION = "4.3.3";

/** Tailwind's CSS to a class table (`convert.ts`'s `convertCss`); the tests pass their own. */
export type Converter = (css: string, options?: { remPx?: number }) => { table: ClassTable; unsupported: Unsupported[] };

export type ClassBuildOptions = {
  /** The app's project root: its `src/` is scanned for class names, and `.svelte-native/` is where the table goes. */
  root: string;
  /** The CSS entry file (`@import "tailwindcss";` and the app's own classes), relative to `root`. */
  css: string;
  /** The variant the table is for: `classes.<variant>.ts`, one per variant as the route tables are (`variant.ts`). */
  variant: string;
  /** Tailwind's CSS to the table. Default `convertCss`. */
  convert?: Converter;
};

export type ClassBuildResult = {
  /** The table file (absolute). */
  file: string;
  /** Whether this build wrote it: a table that did not change is left alone, so a running Metro (which watches modification times) does not rebuild its bundle. */
  changed: boolean;
  /** What the converter left out, for `reportUnsupported`. */
  unsupported: Unsupported[];
  /** Every CSS file the build read (the entry and what it imports), absolute: what a watcher has to follow. */
  stylesheets: string[];
  /** The `@plugin` and `@config` lines the CSS has (`@plugin "x"`), which a native build ignores: a CSS file shared with the web build may have them. */
  skipped: string[];
};

// --- The class names the sources use ---

const SOURCE_EXTENSIONS = new Set([".svelte", ".ts", ".js"]);
const SKIPPED_DIRECTORIES = new Set(["node_modules", ".svelte-native"]);
/** A longer run of class characters is a minified blob or a data URL, not a class. */
const LONGEST_CANDIDATE = 300;

/** The files under `<root>/src` that can name a class (`.svelte`, `.ts`, `.js`, so `.svelte.ts` too), in a stable order. */
export function sourceFiles(root: string): string[] {
  const files: string[] = [];
  const walk = (directory: string) => {
    for (const item of readdirSync(directory, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const path = join(directory, item.name);
      if (item.isDirectory()) {
        if (!SKIPPED_DIRECTORIES.has(item.name)) walk(path);
      } else if (SOURCE_EXTENSIONS.has(extname(item.name))) files.push(path);
    }
  };
  if (existsSync(join(root, "src"))) walk(join(root, "src"));
  return files;
}

/** The characters a class name is made of: letters and digits, and Tailwind's `:` variant, `/` ratio and opacity, `.` decimal, `%`, `#` colour, `!` important, `@` container, `*` and `(` `)` variable. */
const isClassCharacter = (code: number): boolean =>
  (code >= 48 && code <= 58) /* 0-9 and : */ || (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || code === 45 /* - */ || code === 95 /* _ */
  || code === 47 /* / */ || code === 46 /* . */ || code === 37 /* % */ || code === 35 /* # */ || code === 33 /* ! */ || code === 64 /* @ */ || code === 42 /* * */
  || code === 40 /* ( */ || code === 41 /* ) */;

/**
 * The index after the `]` that closes the `[` at `start`, or -1. An arbitrary value (`w-[calc(100%-2rem)]`, `shadow-[0_0_4px_rgb(0,0,0)]`,
 * `content-['x']`) may hold what ends a token anywhere else (commas, `>`, `=`), but never a space, a double quote or a backtick, which end the attribute or the string around it.
 */
function closingBracket(source: string, start: number): number {
  let depth = 0;
  for (let index = start; index < source.length; index++) {
    const code = source.charCodeAt(index);
    if (code === 91) depth++;
    else if (code === 93 && --depth === 0) return index + 1;
    else if (code === 32 || code === 34 || code === 96 || code === 10 || code === 13 || code === 9) return -1;
  }
  return -1;
}

/**
 * Adds to `into` every run of class characters in `source`, the way Tailwind's own scanner is permissive: a candidate need not be a class
 * (Tailwind ignores what it cannot generate), but every class has to be a candidate. Whatever surrounds a name (quotes, braces, `=`, `,`, `<`,
 * whitespace) ends it. A `class:name` directive adds `name`, and a name followed by a colon or a dot (an object key, a sentence) is added without it.
 */
export function candidatesIn(source: string, into: Set<string> = new Set()): Set<string> {
  let index = 0;
  while (index < source.length) {
    const start = index;
    while (index < source.length) {
      const code = source.charCodeAt(index);
      if (isClassCharacter(code)) index++;
      else if (code === 91) {
        const end = closingBracket(source, index);
        if (end < 0) break;
        index = end;
      } else break;
    }
    if (index === start) {
      index++;
      continue;
    }
    const token = source.slice(start, index);
    if (token.length > LONGEST_CANDIDATE) continue;
    into.add(token);
    if (token.startsWith("class:")) into.add(token.slice("class:".length));
    const trimmed = token.replace(/[:.]+$/, "");
    if (trimmed !== token && trimmed !== "") into.add(trimmed);
  }
  return into;
}

/** The candidates of every source under `<root>/src`, sorted. */
export function candidatesOf(root: string): string[] {
  const candidates = new Set<string>();
  for (const file of sourceFiles(root)) candidatesIn(readFileSync(file, "utf8"), candidates);
  return [...candidates].sort();
}

// --- Tailwind ---

type Compiler = { build(candidates: string[]): string };
type Tailwind = {
  compile(
    css: string,
    options: {
      base: string;
      from: string;
      loadStylesheet(id: string, base: string): Promise<{ path: string; base: string; content: string }>;
      loadModule(id: string, base: string, hint: "plugin" | "config"): Promise<{ path: string; base: string; module: unknown }>;
    },
  ): Promise<Compiler>;
};

/** The app's Tailwind (its `compile`) and the directory of its package, which holds the CSS an `@import "tailwindcss"` reads. */
function loadTailwind(root: string): { tailwind: Tailwind; directory: string } {
  const fromApp = createRequire(join(root, "package.json"));
  const install = `pnpm add -D tailwindcss@${TAILWIND_VERSION}`;
  let directory: string;
  let manifest: { version?: string };
  try {
    const manifestFile = fromApp.resolve("tailwindcss/package.json");
    directory = dirname(manifestFile);
    manifest = JSON.parse(readFileSync(manifestFile, "utf8")) as { version?: string };
  } catch (error) {
    throw new Error(`svelte-native: the css option needs Tailwind CSS in the app: ${install} (${(error as Error).message.split("\n")[0]})`, { cause: error });
  }
  if (!manifest.version?.startsWith("4.")) throw new Error(`svelte-native: the css option needs Tailwind CSS 4, the app has ${manifest.version ?? "an unknown version"}: ${install}`);
  return { tailwind: fromApp("tailwindcss") as Tailwind, directory };
}

/** The file a package's `exports` (or the conditions of its `.` entry) name for `key`, preferring the `style` condition, which is how a package exposes its CSS. */
function exportedStylesheet(exports: unknown, key: string): string | undefined {
  const pick = (target: unknown): string | undefined => {
    if (typeof target === "string") return target;
    if (target === null || typeof target !== "object") return undefined;
    const conditions = target as Record<string, unknown>;
    for (const condition of ["style", "import", "require", "default"]) {
      const found = pick(conditions[condition]);
      if (found !== undefined) return found;
    }
    return undefined;
  };
  if (exports === null || typeof exports !== "object" || Array.isArray(exports)) return key === "." ? pick(exports) : undefined;
  const entries = exports as Record<string, unknown>;
  // `{ ".": …, "./theme.css": … }` maps subpaths; anything else is the conditions of `.`.
  return Object.keys(entries).some((name) => name.startsWith(".")) ? pick(entries[key]) : key === "." ? pick(entries) : undefined;
}

/** The CSS file of a package import (`brand-css`, `@scope/brand/theme.css`) as an app's `node_modules` has it: its `style` export condition or `style` field, or a file of it. */
function packageStylesheet(id: string, base: string): string | undefined {
  const name = id.startsWith("@") ? id.split("/").slice(0, 2).join("/") : (id.split("/")[0] as string);
  const subpath = id.slice(name.length);
  for (let directory = base; ; directory = dirname(directory)) {
    const packageDirectory = join(directory, "node_modules", name);
    const manifestFile = join(packageDirectory, "package.json");
    if (existsSync(manifestFile)) {
      const manifest = JSON.parse(readFileSync(manifestFile, "utf8")) as { exports?: unknown; style?: string; main?: string };
      let target: string | undefined;
      if (subpath === "") target = exportedStylesheet(manifest.exports, ".") ?? manifest.style ?? (manifest.main?.endsWith(".css") ? manifest.main : undefined);
      else {
        for (const file of [join(packageDirectory, subpath), join(packageDirectory, `${subpath}.css`)]) if (existsSync(file) && statSync(file).isFile()) return file;
        target = exportedStylesheet(manifest.exports, `.${subpath}`);
      }
      return target === undefined ? undefined : resolve(packageDirectory, target);
    }
    if (dirname(directory) === directory) return undefined;
  }
}

/**
 * Tailwind's `loadStylesheet`, over the real files: `tailwindcss` is the package's `index.css`, `tailwindcss/<x>` its `<x>.css`, a relative or
 * absolute path is relative to the importing file, a bare name (`rel.css`) is that file next to the importing one when it is there (as Tailwind's own
 * loader tries it), and any other package is the file its `style` export condition or field names, or one of its files. Each file read is added to `read`.
 */
function stylesheetLoader(tailwindDirectory: string, read: Set<string>) {
  return async (id: string, base: string): Promise<{ path: string; base: string; content: string }> => {
    let file: string | undefined;
    if (id === "tailwindcss") file = join(tailwindDirectory, "index.css");
    else if (id.startsWith("tailwindcss/")) file = join(tailwindDirectory, `${id.slice("tailwindcss/".length).replace(/\.css$/, "")}.css`);
    else if (id.startsWith(".") || isAbsolute(id)) file = resolve(base, id);
    else {
      const next = resolve(base, id);
      file = existsSync(next) && statSync(next).isFile() ? next : packageStylesheet(id, base);
      if (file === undefined) {
        // Node's own resolution, for a CSS file it finds that the lookups above did not (a package whose exports map names it for `require` or `default`).
        try {
          file = createRequire(join(base, "noop.js")).resolve(id);
        } catch (error) {
          throw new Error(`svelte-native: cannot resolve @import "${id}" from ${base}: ${(error as Error).message.split("\n")[0]}`, { cause: error });
        }
        if (!file.endsWith(".css")) throw new Error(`svelte-native: cannot resolve @import "${id}" from ${base}: ${id} has no CSS file (a "style" export condition or field, or a .css file)`);
      }
    }
    let content: string;
    try {
      content = readFileSync(file, "utf8");
    } catch (error) {
      throw new Error(`svelte-native: cannot read @import "${id}" from ${base}: ${(error as NodeJS.ErrnoException).code ?? (error as Error).message}`, { cause: error });
    }
    read.add(file);
    return { path: file, base: dirname(file), content };
  };
}

/** What stands in for a `@plugin` (Tailwind calls it with or without options and runs its handler): one that adds nothing. */
const noPlugin = Object.assign(() => ({ handler: () => {} }), { __isOptionsFunction: true });

// --- Building the table ---

/** What the table file says: the table as data, one class a line (a diff of two builds reads), typed by the library's own declaration of the module. */
function tableSource(table: ClassTable): string {
  const lines = (entries: Record<string, unknown>) => Object.entries(entries).map(([name, value]) => `${JSON.stringify(name)}: ${JSON.stringify(value)}`);
  const block = (name: string, entries: string[]) => (entries.length === 0 ? "" : `  ${JSON.stringify(name)}: {\n    ${entries.join(",\n    ")}\n  },\n`);
  return `// Generated by @example/svelte-native (the css option of withSvelteNative): the classes of the app's CSS as React Native styles.
import type Table from "@example/svelte-native/classes-table";

export default {
  "version": ${JSON.stringify(table.version)},
${block("classes", lines(table.classes)) || '  "classes": {},\n'}${block("unsupported", lines(table.unsupported ?? {}))}} as typeof Table;
`;
}

/**
 * Why each class the converter left out is not in the table, as one line a class (`property: reason`, a class's lines joined by `; `), in the class
 * name order. The runtime reports a class that is used and has no rules with it (`css/runtime.ts`).
 */
export function unsupportedReasons(unsupported: readonly Unsupported[]): Record<string, string> {
  const reasons = new Map<string, string[]>();
  for (const { className, property, reason } of unsupported) {
    const line = `${property}: ${reason}`;
    const lines = reasons.get(className) ?? [];
    if (!lines.includes(line)) lines.push(line);
    reasons.set(className, lines);
  }
  return Object.fromEntries([...reasons].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([className, lines]) => [className, lines.join("; ")]));
}

/** Writes `content` unless the file already holds it (a running Metro watches the file's modification time). Returns whether it wrote. */
function writeIfChanged(file: string, content: string): boolean {
  let current: string | undefined;
  try {
    current = readFileSync(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  if (current === content) return false;
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
  return true;
}

/** The last build of each table file in this process, by what it was built from: an edit that changes no class and no CSS compiles nothing. */
const built = new Map<string, { inputs: string; result: ClassBuildResult }>();

function inputsOf(candidates: readonly string[], entry: string, stylesheets: readonly string[]): string {
  const hash = createHash("sha256");
  hash.update(candidates.join("\n"));
  for (const sheet of new Set([entry, ...stylesheets])) {
    hash.update("\0");
    try {
      hash.update(readFileSync(sheet));
    } catch {
      hash.update("missing");
    }
  }
  return hash.digest("hex");
}

/**
 * Compiles the app's CSS for the classes its sources use and writes the table. Rejects with a message that says what to do when Tailwind is not
 * installed, the CSS entry is missing, the CSS has an `@plugin` or `@config`, or Tailwind cannot compile it.
 */
export async function buildClasses(options: ClassBuildOptions): Promise<ClassBuildResult> {
  const root = resolve(options.root);
  const entry = resolve(root, options.css);
  const file = join(root, ".svelte-native", classesTableFile(options.variant));
  if (!existsSync(entry)) throw new Error(`svelte-native: the css option names ${options.css}, which is not a file (relative to ${root})`);
  const candidates = candidatesOf(root);
  const previous = built.get(file);
  const inputs = inputsOf(candidates, entry, previous?.result.stylesheets ?? []);
  if (previous !== undefined && previous.inputs === inputs && existsSync(file)) return { ...previous.result, changed: false };
  const { tailwind, directory } = loadTailwind(root);
  const read = new Set<string>([entry]);
  // Classes are built from Tailwind's CSS alone (@theme, @utility, @custom-variant, @layer and plain rules): no JavaScript runs. A CSS file that the web build shares may have
  // a `@plugin` or `@config`, which a native build skips instead of stopping at.
  const skipped = new Set<string>();
  const compiler = await tailwind.compile(readFileSync(entry, "utf8"), {
    base: dirname(entry),
    from: entry,
    loadStylesheet: stylesheetLoader(directory, read),
    loadModule: async (id, base, hint) => {
      skipped.add(`@${hint} "${id}"`);
      return { path: id, base, module: hint === "plugin" ? noPlugin : {} };
    },
  });
  const { table, unsupported } = (options.convert ?? convertCss)(compiler.build(candidates));
  const reasons = unsupportedReasons(unsupported);
  const written = Object.keys(reasons).length === 0 ? table : { ...table, unsupported: { ...table.unsupported, ...reasons } };
  const result: ClassBuildResult = { file, changed: writeIfChanged(file, tableSource(written)), unsupported, stylesheets: [...read], skipped: [...skipped] };
  built.set(file, { inputs: inputsOf(candidates, entry, result.stylesheets), result });
  return result;
}

/**
 * `buildClasses` for a caller that cannot wait: Metro's config loads synchronously, and Tailwind's compiler is asynchronous. The build runs in a
 * Node process of its own (`svelte-native css`, this package's command line) that this one waits for. The converter is `convertCss`: a
 * function cannot cross to the other process.
 */
export function buildClassesSync(options: Omit<ClassBuildOptions, "convert">): ClassBuildResult {
  const root = resolve(options.root);
  const entry = resolve(root, options.css);
  const file = join(root, ".svelte-native", classesTableFile(options.variant));
  // Expo loads Metro's config more than once: the second load, with nothing changed, is not a second build.
  const previous = built.get(file);
  const candidates = candidatesOf(root);
  const inputs = existsSync(entry) ? inputsOf(candidates, entry, previous?.result.stylesheets ?? []) : "";
  if (previous !== undefined && previous.inputs === inputs && existsSync(file)) return { ...previous.result, changed: false };
  // The command line is the built `dist/node/cli.js`, which an app runs (Node cannot run the package's TypeScript from `node_modules`). Only Bun, which runs the
  // library's tests from the sources, runs `src/cli.ts` itself: Node's type stripping cannot, as the converter uses constructor parameter properties.
  const cli = process.versions.bun !== undefined && import.meta.filename.endsWith(".ts") ? sourceFile("cli.ts") : join(packageRoot, "dist/node/cli.js");
  const run = spawnSync(process.execPath, [cli, "css", options.css, "--variant", options.variant, "--json"], { cwd: root, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  if (run.error) throw new Error(`svelte-native: could not run the CSS build (${run.error.message})`, { cause: run.error });
  if (run.status !== 0) throw new Error(run.stderr.trim() || `svelte-native: the CSS build exited with ${run.status}`);
  const result = JSON.parse(run.stdout) as ClassBuildResult;
  built.set(file, { inputs: inputsOf(candidates, entry, result.stylesheets), result });
  return result;
}

// --- Telling the developer ---

/** The classes already counted by `reportUnsupported` in this process: a watcher that rebuilds must not repeat itself. */
const reported = new Set<string>();

/**
 * In development, one line when the classes the sources mention include some the converter could not express (`NODE_ENV=development`, `expo start`);
 * again only when there are more of them. Words in comments and prose are candidates too, so a class is not warned about here: one that is used and
 * has no rules warns when it renders (`css/runtime.ts`), with the reason the table carries. Nothing in any other build.
 */
export function reportUnsupported(unsupported: readonly Unsupported[], development: boolean = process.env.NODE_ENV === "development"): void {
  if (!development) return;
  const before = reported.size;
  for (const { className } of unsupported) reported.add(className);
  if (reported.size === before) return;
  const count = reported.size;
  console.warn(`svelte-native: ${count} ${count === 1 ? "class the sources mention is" : "classes the sources mention are"} not supported on native; a class that is used warns when it renders`);
}

/** The `@plugin` and `@config` lines already reported by this process. */
const reportedSkipped = new Set<string>();

/** Forgets what `reportUnsupported` and `reportSkipped` have said in this process (tests share one process across files). */
export function resetReports(): void {
  reported.clear();
  reportedSkipped.clear();
}

/** Once for each plugin or config the CSS has: a native build ignores them, and the classes they define are not in the table (a used one warns when it renders). */
export function reportSkipped(skipped: readonly string[]): void {
  const fresh = skipped.filter((line) => !reportedSkipped.has(line));
  if (fresh.length === 0) return;
  for (const line of fresh) reportedSkipped.add(line);
  console.warn(`svelte-native: plugins and JS config do not apply on native: ${fresh.join(", ")} ${fresh.length === 1 ? "is" : "are"} ignored`);
}

// --- The development loop ---

/**
 * Builds the table again when anything under `src/`, the CSS entry or a CSS file it imports changes, so a running Metro serves the classes the
 * files use now. Debounced, never keeps the process alive, and a build that fails (a CSS file mid-edit) is logged and waits for the next change.
 * `stylesheets` are the CSS files the build before this read (`ClassBuildResult.stylesheets`), whose directories are watched too. Close it to stop.
 */
export function watchClasses(options: ClassBuildOptions, stylesheets: readonly string[] = [], debounceMs = 100): { close(): void } {
  const root = resolve(options.root);
  const source = join(root, "src");
  const watchers = new Map<string, FSWatcher>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running: Promise<unknown> = Promise.resolve();
  let closed = false;
  const watchDirectory = (directory: string, recursive: boolean) => {
    if (closed || watchers.has(directory) || !existsSync(directory)) return;
    const watcher = watch(directory, { recursive }, schedule);
    watcher.unref();
    watchers.set(directory, watcher);
  };
  // The directory of each CSS file that is not inside `src/` (which is watched) or a package (whose CSS does not change).
  const followStylesheets = (files: readonly string[]) => {
    for (const directory of new Set(files.map((file) => dirname(file))))
      if (!directory.split(sep).includes("node_modules") && relative(source, directory).startsWith("..")) watchDirectory(directory, false);
  };
  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(rebuild, debounceMs);
    unrefTimer(timer);
  }
  const rebuild = () => {
    running = running.then(async () => {
      if (closed) return;
      try {
        const result = await buildClasses(options);
        reportSkipped(result.skipped);
        reportUnsupported(result.unsupported);
        followStylesheets(result.stylesheets);
      } catch (error) {
        console.error(error);
      }
    });
  };
  // `src/` with a watch per directory (`watchTree`): a recursive `fs.watch` stops reporting a file once an editor saves it by a rename.
  const tree = watchTree(source, schedule, { debounceMs: 0, skip: (name) => SKIPPED_DIRECTORIES.has(name) });
  followStylesheets([resolve(root, options.css), ...stylesheets]);
  return {
    close() {
      closed = true;
      clearTimeout(timer);
      tree.close();
      for (const watcher of watchers.values()) watcher.close();
      watchers.clear();
    },
  };
}
