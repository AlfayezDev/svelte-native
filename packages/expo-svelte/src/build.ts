import { spawn } from "node:child_process";
import { existsSync, type FSWatcher, mkdirSync, readFileSync, readdirSync, rmSync, watch, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { mkdir } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import type { AST, parse as parseSvelte } from "svelte/compiler";
import { asyncEnvironment, runesEnvironment } from "./compile-options.ts";
import { packageRoot } from "./package-root.ts";
import { buildTree, type PageRoute, type RouteFile, type RouteNode, type StackNode } from "./route-tree.ts";
import { labIncludedFor, routesTableFile, variantName } from "./variant.ts";
import { watchTree } from "./watch-tree.ts";

const require = createRequire(import.meta.url);
const posix = (path: string) => path.split(sep).join("/");

/**
 * What a route module's script exports as a literal. The route table carries `presentation` (a page) and `navigator` (a layout)
 * so a screen's container and a layout's role are known before any module loads, which makes both a literal read here. `lab` (a route
 * only the development lab has) is read the same way, so the product's discovery can leave the route out without loading it.
 */
function exportedLiteral<Value extends string | boolean>(ast: AST.Root, file: string, name: string, values: readonly Value[]): Value | undefined {
  for (const statement of ast.module?.content.body ?? []) {
    if (statement.type !== "ExportNamedDeclaration") continue;
    const declarations = statement.declaration?.type === "VariableDeclaration" ? statement.declaration.declarations : [];
    const declared = declarations.find((declaration) => declaration.id.type === "Identifier" && declaration.id.name === name);
    const init = declared?.init;
    const literal = init?.type === "Literal" ? values.find((value) => value === init.value) : undefined;
    if (literal !== undefined) return literal;
    const aliased = statement.specifiers.some((specifier) => specifier.exported.type === "Identifier" && specifier.exported.name === name);
    if (declared || aliased) throw new Error(`${file}: export \`${name}\` as one of the literals ${values.map((value) => JSON.stringify(value)).join(", ")}; the route table reads it at build time`);
  }
  return undefined;
}

/** Whether the instance script (`<script>`, not `<script module>`) exports `name`: the table does not read it there, so it would be ignored. */
function exportedInInstance(ast: AST.Root, name: string): boolean {
  return (ast.instance?.content.body ?? []).some((statement) => {
    if (statement.type !== "ExportNamedDeclaration") return false;
    const declarations = statement.declaration?.type === "VariableDeclaration" ? statement.declaration.declarations : [];
    return declarations.some((declaration) => declaration.id.type === "Identifier" && declaration.id.name === name)
      || statement.specifiers.some((specifier) => specifier.exported.type === "Identifier" && specifier.exported.name === name);
  });
}
const PRESENTATIONS = ["push", "modal", "transparentModal", "sheet", "formSheet"] as const;
const NAVIGATORS = ["stack", "tabs"] as const;

/**
 * Whether the app carries its development lab: every variant but the product (`APP_VARIANT=production`, the variable `app.config.ts`,
 * `metro.config.cjs` and `eas.json` share). The lab is the routes under a `__dev` directory and any route whose module script exports
 * `lab = true`; the product's route tree, route table and module graph never name them.
 */
export const labIncluded = (env: NodeJS.ProcessEnv = process.env): boolean => labIncludedFor(variantName(env));
const LAB_DIRECTORY = "__dev";

export type RouteFilesOptions = {
  /** Whether the lab's routes are discovered; `labIncluded()` by default. */
  lab?: boolean;
};

/**
 * The route files under `src/routes` (`+mobile.svelte` pages and `+layout.mobile.svelte` layouts) with the literals they export, in a stable order.
 * Without the lab, a file in a `__dev` directory is not read at all, a page that exports `lab = true` is left out, and a layout that does takes
 * its whole directory with it.
 */
export function routeFilesSync(routesRoot: string, { lab = labIncluded() }: RouteFilesOptions = {}): RouteFile[] {
  const paths: string[] = [];
  function walk(directory: string) {
    for (const item of readdirSync(directory, { withFileTypes: true })) {
      const path = resolve(directory, item.name);
      if (item.isDirectory()) {
        if (lab || item.name !== LAB_DIRECTORY) walk(path);
      } else paths.push(posix(relative(routesRoot, path)));
    }
  }
  walk(routesRoot);
  // The compiler is large; every Expo command that reads the app's config loads this module, so it is loaded only here.
  const { parse } = require("svelte/compiler") as { parse: typeof parseSvelte };
  const files: RouteFile[] = [];
  const labDirectories: string[] = [];
  for (const path of paths.sort((a, b) => a.localeCompare(b))) {
    const name = path.slice(path.lastIndexOf("/") + 1);
    if (name !== "+mobile.svelte" && name !== "+layout.mobile.svelte") continue;
    const ast = parse(readFileSync(resolve(routesRoot, path), "utf8"), { modern: true, filename: path });
    // Read in every variant, so a marker the product's sync could not read fails the lab builds' as well.
    if (exportedInInstance(ast, "lab")) throw new Error(`${path}: export \`lab\` is ignored in the instance script; move \`lab\` to \`<script module>\`, which the route table reads at build time`);
    const labOnly = exportedLiteral(ast, path, "lab", [true] as const) === true;
    if (labOnly && path === name && name === "+layout.mobile.svelte") throw new Error(`${path}: the root layout is the app shell and cannot be lab-only`);
    const marked = labOnly && !lab;
    if (name === "+mobile.svelte") {
      if (marked) continue;
      const presentation = exportedLiteral(ast, path, "presentation", PRESENTATIONS);
      files.push({ path, exports: presentation ? { presentation } : {} });
    } else {
      if (marked) { labDirectories.push(path.slice(0, path.length - name.length)); continue; }
      const navigator = exportedLiteral(ast, path, "navigator", NAVIGATORS);
      files.push({ path, exports: navigator ? { navigator } : {} });
    }
  }
  return labDirectories.length === 0 ? files : files.filter((file) => !labDirectories.some((directory) => file.path.startsWith(directory)));
}

/** `routeFilesSync` for the callers that wait (the tests and the generator's older callers). */
export const routeFiles = async (routesRoot: string, options: RouteFilesOptions = {}): Promise<RouteFile[]> => routeFilesSync(routesRoot, options);

/**
 * The tree as the module `.expo-svelte/routes.<variant>.ts`: `buildTree`'s data with a loader per page and per navigator layout, and
 * the `variant` and `lab` the table was made for, which the app reads as the one source of what its bundle carries.
 */
function treeModule(tree: StackNode, routesRoot: string, output: string, variant: string, lab: boolean): string {
  const json = (value: unknown) => JSON.stringify(value);
  const code = (file: string) => `require(${json(posix(relative(output, resolve(routesRoot, file))))}).default`;
  const loader = (file: string, layouts: readonly string[] = []) => `async () => ({ component: ${code(file)}, layouts: [${layouts.map(code).join(", ")}] })`;
  const routeOf = (route: PageRoute | RouteNode, indent: string): string => {
    if (route.kind === "page") {
      const { file = "", layouts = [] } = route;
      return `${indent}{
${indent}  kind: "page", id: ${json(route.id)}, path: ${json(route.path)}, presentation: ${json(route.presentation)},
${indent}  file: ${json(file)}, layouts: ${json(layouts)},
${indent}  load: ${loader(file, layouts)},
${indent}}`;
    }
    return nodeOf(route, indent);
  };
  const nodeOf = (node: RouteNode, indent: string): string => {
    const inner = `${indent}  `;
    const lines = [`kind: ${json(node.kind)}, id: ${json(node.id)}, path: ${json(node.path)},`];
    if (node.layoutFile !== undefined) {
      lines.push(`layoutFile: ${json(node.layoutFile)},${node.layouts ? ` layouts: ${json(node.layouts)},` : ""}`);
      lines.push(`layout: ${loader(node.layoutFile, node.layouts)},`);
    }
    if (node.kind === "stack") {
      if (node.shellFile !== undefined) lines.push(`shellFile: ${json(node.shellFile)},`);
      lines.push(`routes: [\n${node.routes.map((route) => `${routeOf(route, `${inner}  `)},`).join("\n")}\n${inner}],`);
    } else {
      lines.push(`panes: [\n${node.panes.map((pane) => `${inner}  { key: ${json(pane.key)}, stack: ${nodeOf(pane.stack, `${inner}  `).trimStart()} },`).join("\n")}\n${inner}],`);
    }
    return `${indent}{\n${lines.map((line) => `${inner}${line}`).join("\n")}\n${indent}}`;
  };
  // Each route is a loader whose `require`s run when it is called, so a screen's modules (and whatever they import) evaluate when the
  // screen is first needed, not at boot. A `require` rather than `import()` keeps the page in the entry's module graph, which is
  // what lets a hot update of a page reach the entry's accept handler; `import()` would make Metro's development server serve it as a
  // separate bundle with no importer to accept the update. Metro's release export has a single bundle either way.
  return `// Generated by expo-svelte sync for the ${variant} app${lab ? "" : " (the development lab's routes are left out)"}.\nimport type { StackNode } from 'expo-svelte/router';\n\nexport const variant = ${json(variant)};\nexport const lab = ${lab};\nexport const tree: StackNode = ${nodeOf(tree, "").trimStart()};\n`;
}

/** What the package was called before: `@rasheed/svelte-native` up to 0.4.0-rc.4, `@alfayez/svelte-native` up to 0.4.0-rc.9. An entry that imports one is from before a rename. */
const FORMER_NAMES: readonly string[] = ["@rasheed/svelte-native", "@alfayez/svelte-native"];

/**
 * Whether an entry (`.expo-svelte/entry.ts`) was written by a release whose imports the package no longer has: a string that names the package and a subpath its `exports` map does not (0.4.0-rc.7
 * removed `/init`, `/polyfills` and `/fabric`, which every entry before it imported, and `/animation`, `/gestures`, `/svg`, `/native-modules` and `/expo`), or its name before the rename. Such an
 * entry would stop Metro with a resolution error, so a Metro that keeps the entry writes it again. So is an entry that does not import `./hooks` (one from before 0.4.0-rc.8): it would leave
 * `src/hooks.mobile.ts` unloaded.
 */
export function staleEntry(source: string): boolean {
  // An entry from before 0.4.0-rc.8 does not load the app's hooks (`./hooks`, see `hooksModule`).
  if (!/^import ['"]\.\/hooks['"];$/m.test(source)) return true;
  const manifest = JSON.parse(readFileSync(resolve(packageRoot, "package.json"), "utf8")) as { name: string; exports: Record<string, unknown> };
  const literal = (text: string) => text.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
  const patterns = Object.keys(manifest.exports);
  const exported = (key: string) => patterns.some((pattern) => (pattern.includes("*") ? new RegExp(`^${pattern.split("*").map(literal).join(".*")}$`).test(key) : pattern === key));
  for (const [, , name, subpath] of source.matchAll(new RegExp(`(['"])(${[manifest.name, ...FORMER_NAMES].map(literal).join("|")})((?:/[^'"]*)?)\\1`, "g"))) {
    if (FORMER_NAMES.includes(name as string) || !exported(subpath ? `.${subpath}` : ".")) return true;
  }
  return false;
}

/** The app's hooks file, `src/hooks.mobile.ts` or `.js` (the counterpart of SvelteKit's `src/hooks.client.ts`), if it has one. */
export function hooksFile(root: string): string | undefined {
  for (const extension of [".ts", ".js"]) {
    const path = resolve(root, `src/hooks.mobile${extension}`);
    if (existsSync(path)) return path;
  }
  return undefined;
}

/**
 * `.expo-svelte/hooks.ts`, which the entry imports after the boot modules and before the app's layout and routes: it registers the exports of
 * `src/hooks.mobile.ts` (`registerHooks`, `app-hooks.ts`), or registers none for an app without the file. The entry imports it whether or not the file
 * exists, so adding or removing the file changes this module alone (Metro serves the new one as a hot update) and never the entry.
 */
function hooksModule(root: string): string {
  const file = hooksFile(root);
  // No file is an empty registration, so a development app that loses the file drops what it registered.
  if (file === undefined) return "// Generated by expo-svelte sync: the app has no src/hooks.mobile.ts.\nimport { registerHooks } from 'expo-svelte/app';\n\nregisterHooks({});\n";
  const specifier = posix(relative(resolve(root, ".expo-svelte"), file)).replace(/\.[jt]s$/, "");
  return `// Generated by expo-svelte sync: the app's hooks (${posix(relative(root, file))}), registered before its layout and routes load.\nimport { registerHooks } from 'expo-svelte/app';\nimport * as hooks from ${JSON.stringify(specifier)};\n\nregisterHooks(hooks);\n`;
}

/** Writes `file` under `.expo-svelte` when its content differs (an unchanged file keeps its time, so Metro does not see a change). */
function writeGenerated(output: string, file: string, content: string): void {
  const destination = resolve(output, file);
  let current = "";
  try { current = readFileSync(destination, "utf8"); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  if (current !== content) writeFileSync(destination, content);
}

/** Writes `.expo-svelte/hooks.ts` for the hooks file the app has now. */
export function syncHooks(root: string): void {
  const output = resolve(root, ".expo-svelte");
  mkdirSync(output, { recursive: true });
  writeGenerated(output, "hooks.ts", hooksModule(root));
}

export type SyncOptions = RouteFilesOptions & {
  /** The variant the table is synced for; `variantName()` (`APP_VARIANT`) by default. `lab` follows it unless given. */
  variant?: string;
  /**
   * `write` (the default, `expo-svelte sync` and the prebuild plugin) writes `.expo-svelte/entry.ts` for `EXPO_SVELTE_ROOT` as the
   * environment has it. `keep` (the Metro integration) writes it only when it is missing, the environment names a root, or it imports something the package no longer has (an entry
   * from before 0.4.0-rc.7, `staleEntry`): a Metro that starts without `EXPO_SVELTE_ROOT` does not revert the entry a sync with it wrote, and the entry is the one file the variants
   * share (it does not depend on the variant: `./routes` is the bundling variant's table).
   */
  entry?: "write" | "keep";
};

/**
 * Writes `.expo-svelte/routes.<variant>.ts` (the variant's route table, which exports `variant`, `lab` and `tree`) and `entry.ts`,
 * synchronously: the Metro integration runs it while the config loads, before Metro's file map is built. Each variant has a table of its
 * own, so syncing one never changes another's.
 */
export function syncRoutes(root: string, options: SyncOptions = {}): void {
  const variant = options.variant ?? variantName();
  const lab = options.lab ?? labIncludedFor(variant);
  const routesRoot = resolve(root, "src/routes");
  const output = resolve(root, ".expo-svelte");
  mkdirSync(output, { recursive: true });
  const manifest = treeModule(buildTree(routeFilesSync(routesRoot, { lab })), routesRoot, output, variant, lab);
  // The entry boots the app layout, the shell around the generated tree's root navigator; EXPO_SVELTE_ROOT=<path> renders that
  // component as the root instead (the lab's spike roots).
  const customRoot = process.env.EXPO_SVELTE_ROOT;
  // `/app` runs the boot modules (`init`, then `polyfills`) before it loads the Fabric host, and exports what the entry calls. `./hooks`
  // (`hooksModule`) runs the app's `src/hooks.mobile.ts` next, before any of the app's own modules.
  const prelude = "import { createFabricApp, remountSurfaces } from 'expo-svelte/app';\nimport './hooks';\n";
  // In development the entry accepts every hot update itself (see `fabric/hmr.ts`): Metro re-runs the edited module and its importers up to
  // here, which re-registers the app, and the handler remounts the running surfaces.
  const hot = "declare const module: { hot?: { accept(callback?: () => void): void } };\nif (__DEV__) module.hot?.accept(() => remountSurfaces());\n";
  // `./routes` is not a file: the Metro integration resolves it to the bundling variant's table.
  const entry = customRoot
    ? `${prelude}import App from ${JSON.stringify(posix(relative(output, resolve(root, customRoot))))};\ncreateFabricApp(App, {});\n${hot}`
    : `${prelude}import App from '../src/routes/+layout.mobile.svelte';\nimport { tree } from './routes';\ncreateFabricApp(App, { tree });\n${hot}`;
  const files: [string, string][] = [[routesTableFile(variant), manifest], ["hooks.ts", hooksModule(root)]];
  const entryPath = resolve(output, "entry.ts");
  if (options.entry !== "keep" || customRoot !== undefined || !existsSync(entryPath) || staleEntry(readFileSync(entryPath, "utf8"))) files.push(["entry.ts", entry]);
  for (const [file, content] of files) writeGenerated(output, file, content);
  // The table the variants used to share.
  rmSync(resolve(output, "routes.ts"), { force: true });
}

export async function syncNative(root: string, options: SyncOptions = {}): Promise<void> {
  syncRoutes(root, options);
}

/**
 * Lets the process end while `timer` is pending. Node's timers have `unref`; the DOM's `setTimeout` returns a number, which is what a type-check of an app
 * without Node's types makes of `ReturnType<typeof setTimeout>` (a SvelteKit app's tsconfig does not load them), so the method is not named on the type.
 */
export function unrefTimer(timer: unknown): void {
  (timer as { unref?: () => void }).unref?.();
}

/**
 * Syncs again when anything under `src/routes` changes (a route added, removed or renamed, a `presentation` or `navigator` edited), so a
 * development server's table follows the files. Debounced, never keeps the process alive, and a route tree the build rejects is logged
 * and waits for the next change. Close it to stop.
 */
export function watchRoutes(root: string, options: SyncOptions = {}, debounceMs = 50): { close(): void } {
  // A watch per directory (`watchTree`): a recursive `fs.watch` stops reporting a route file once an editor saves it by a rename.
  const routes = watchTree(resolve(root, "src/routes"), () => {
    try { syncRoutes(root, options); } catch (error) { console.error(error); }
    // `routeFilesSync` reads every directory under routes (the lab's too, when it is included).
  }, { debounceMs, skip: (name) => name === "node_modules" });
  // `src` itself, for `src/hooks.mobile.ts` appearing or going (its edits are Metro's: they are hot updates of the module). Debounced, as the
  // routes are: an editor that saves by deleting and creating the file would otherwise write the module twice.
  let hooks: FSWatcher | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const unwatched = (reason: string) => console.warn(`expo-svelte: not watching src for src/hooks.mobile.ts (${reason}); run expo-svelte sync after adding or removing it`);
  try {
    hooks = watch(resolve(root, "src"), (_event, name) => {
      if (name !== null && !/^hooks\.mobile\.[jt]s$/.test(name.toString())) return;
      clearTimeout(timer);
      timer = setTimeout(() => { try { syncHooks(root); } catch (error) { console.error(error); } }, debounceMs);
      unrefTimer(timer);
    });
    hooks.unref();
    hooks.on("error", (error) => { hooks?.close(); unwatched(error.message); });
  } catch (error) {
    unwatched((error as Error).message);
  }
  return { close() { clearTimeout(timer); routes.close(); hooks?.close(); } };
}

/**
 * The environment `expo` runs in: this process's, with `extra` over it. Expo's TypeScript setup is off unless the environment turns it on: it is for React apps,
 * and stops the first run of a Svelte app, whose TypeScript is SvelteKit's, to ask to install `@types/react`.
 */
export function expoEnvironment(args: string[], extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { EXPO_NO_TYPESCRIPT_SETUP: "1", ...process.env, EXPO_NO_TELEMETRY: "1", ...extra };
  // adb reverse connects over IPv4; Node may otherwise bind localhost to ::1.
  if (args.includes("--localhost")) env.NODE_OPTIONS = `${env.NODE_OPTIONS ?? ""} --dns-result-order=ipv4first`.trim();
  return env;
}

export function runExpo(root: string, args: string[], extraEnv: Record<string, string> = {}) {
  return spawn(process.execPath, [require.resolve("expo/bin/cli"), ...args], {
    cwd: root,
    stdio: "inherit",
    env: expoEnvironment(args, extraEnv),
  });
}

export type ExportOptions = SyncOptions & {
  /** The app's `runes` setting for the Metro that runs the export (see `ExpoSvelteMetroOptions.runes`); the app's own `withExpoSvelte(config, { runes })` wins over it. */
  runes?: boolean;
  /** The app's `async` setting for the Metro that runs the export (see `ExpoSvelteMetroOptions.async`); the app's own `withExpoSvelte(config, { async })` wins over it. */
  async?: boolean;
};

export async function exportNative(root: string, platform: "android" | "ios", options: ExportOptions = {}): Promise<void> {
  await syncNative(root, options);
  const output = resolve(root, ".expo-svelte/dist", platform);
  await mkdir(output, { recursive: true });
  const child = runExpo(root, ["export:embed", "--platform", platform,
    "--entry-file", ".expo-svelte/entry.ts", "--bundle-output", resolve(output, "index.hbc"),
    "--sourcemap-output", resolve(output, "index.hbc.map"), "--assets-dest", resolve(output, "assets"),
    "--dev", "false", "--bytecode", "--reset-cache"], { ...runesEnvironment(options.runes), ...asyncEnvironment(options.async) });
  const result = await new Promise<number | null>((done, reject) => { child.once("error", reject); child.once("exit", done); });
  if (result !== 0) throw new Error(`Native ${platform} export exited with ${result}`);
}
