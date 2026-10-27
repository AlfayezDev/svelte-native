import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import type { parse as parseSvelte } from "svelte/compiler";
import { buildTree, type PageRoute, type RouteFile, type RouteNode, type StackNode } from "./route-tree.ts";

const require = createRequire(import.meta.url);
const posix = (path: string) => path.split(sep).join("/");

/**
 * What a route module's script exports as a literal. The route table carries `presentation` (a page) and `navigator` (a layout)
 * so a screen's container and a layout's role are known before any module loads, which makes both a literal read here.
 */
function exportedLiteral<Value extends string>(parse: typeof parseSvelte, file: string, source: string, name: string, values: readonly Value[]): Value | undefined {
  const { module } = parse(source, { modern: true, filename: file });
  for (const statement of module?.content.body ?? []) {
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
const PRESENTATIONS = ["push", "modal", "transparentModal", "sheet", "formSheet"] as const;
const NAVIGATORS = ["stack", "tabs"] as const;

/** The route files under `src/routes` (`+mobile.svelte` pages and `+layout.mobile.svelte` layouts) with the literals they export, in a stable order. */
async function routeFiles(routesRoot: string): Promise<RouteFile[]> {
  const paths: string[] = [];
  async function walk(directory: string) {
    for (const item of await readdir(directory, { withFileTypes: true })) {
      const path = resolve(directory, item.name);
      if (item.isDirectory()) await walk(path);
      else paths.push(posix(relative(routesRoot, path)));
    }
  }
  await walk(routesRoot);
  // The compiler is large; every Expo command that reads the app's config loads this module, so it is imported only here.
  const { parse } = await import("svelte/compiler");
  const files: RouteFile[] = [];
  for (const path of paths.sort((a, b) => a.localeCompare(b))) {
    const name = path.slice(path.lastIndexOf("/") + 1);
    if (name !== "+mobile.svelte" && name !== "+layout.mobile.svelte") continue;
    const source = await readFile(resolve(routesRoot, path), "utf8");
    if (name === "+mobile.svelte") {
      const presentation = exportedLiteral(parse, path, source, "presentation", PRESENTATIONS);
      files.push({ path, exports: presentation ? { presentation } : {} });
    } else {
      const navigator = exportedLiteral(parse, path, source, "navigator", NAVIGATORS);
      files.push({ path, exports: navigator ? { navigator } : {} });
    }
  }
  return files;
}

/** The tree as the module `.svelte-native/routes.ts`: `buildTree`'s data with a loader per page and per navigator layout. */
function treeModule(tree: StackNode, routesRoot: string, output: string): string {
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
  return `import type { StackNode } from '@rasheed/svelte-native/router';\n\nexport const tree: StackNode = ${nodeOf(tree, "").trimStart()};\n`;
}

export async function syncNative(root: string): Promise<void> {
  const routesRoot = resolve(root, "src/routes");
  const output = resolve(root, ".svelte-native");
  await mkdir(output, { recursive: true });
  const manifest = treeModule(buildTree(await routeFiles(routesRoot)), routesRoot, output);
  // The entry boots the app layout, the shell around the generated tree's root navigator; SVELTE_NATIVE_ROOT=<path> renders that
  // component as the root instead (the lab's spike roots).
  const customRoot = process.env.SVELTE_NATIVE_ROOT;
  const prelude = "import '@rasheed/svelte-native/init';\nimport '@rasheed/svelte-native/polyfills';\nimport { createFabricApp, remountSurfaces } from '@rasheed/svelte-native/fabric';\n";
  // In development the entry accepts every hot update itself (see `fabric/hmr.ts`): Metro re-runs the edited module and its importers up to
  // here, which re-registers the app, and the handler remounts the running surfaces.
  const hot = "declare const module: { hot?: { accept(callback?: () => void): void } };\nif (__DEV__) module.hot?.accept(() => remountSurfaces());\n";
  const entry = customRoot
    ? `${prelude}import App from ${JSON.stringify(posix(relative(output, resolve(root, customRoot))))};\ncreateFabricApp(App, {});\n${hot}`
    : `${prelude}import App from '../src/routes/+layout.mobile.svelte';\nimport { tree } from './routes';\ncreateFabricApp(App, { tree });\n${hot}`;
  for (const [file, content] of [["routes.ts", manifest], ["entry.ts", entry]]) {
    const destination = resolve(output, file);
    const current = await readFile(destination, "utf8").catch((error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return ""; throw error; });
    if (current !== content) await writeFile(destination, content);
  }
}

export function runExpo(root: string, args: string[]) {
  const env: NodeJS.ProcessEnv = { ...process.env, EXPO_NO_TELEMETRY: "1" };
  // adb reverse connects over IPv4; Node may otherwise bind localhost to ::1.
  if (args.includes("--localhost")) env.NODE_OPTIONS = `${env.NODE_OPTIONS ?? ""} --dns-result-order=ipv4first`.trim();
  return spawn(process.execPath, [require.resolve("expo/bin/cli"), ...args], {
    cwd: root,
    stdio: "inherit",
    env,
  });
}

export async function exportNative(root: string, platform: "android" | "ios"): Promise<void> {
  await syncNative(root);
  const output = resolve(root, ".svelte-native/dist", platform);
  await mkdir(output, { recursive: true });
  const child = runExpo(root, ["export:embed", "--platform", platform,
    "--entry-file", ".svelte-native/entry.ts", "--bundle-output", resolve(output, "index.hbc"),
    "--sourcemap-output", resolve(output, "index.hbc.map"), "--assets-dest", resolve(output, "assets"),
    "--dev", "false", "--bytecode", "--reset-cache"]);
  const result = await new Promise<number | null>((done, reject) => { child.once("error", reject); child.once("exit", done); });
  if (result !== 0) throw new Error(`Native ${platform} export exited with ${result}`);
}
