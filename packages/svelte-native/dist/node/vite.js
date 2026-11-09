// src/vite.ts
import { resolve as resolve3 } from "node:path";

// src/build.ts
import { spawn } from "node:child_process";
import { existsSync as existsSync2, mkdirSync, readFileSync, readdirSync, rmSync, watch, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { mkdir } from "node:fs/promises";
import { relative, resolve as resolve2, sep as sep2 } from "node:path";

// src/compile-options.ts
import { realpathSync } from "node:fs";
import { sep } from "node:path";

// src/package-root.ts
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
function findPackageRoot(from) {
  for (let directory = from; ; directory = dirname(directory)) {
    if (existsSync(join(directory, "package.json"))) return directory;
    if (dirname(directory) === directory) throw new Error(`No package.json above ${from}: the package's files moved`);
  }
}
var packageRoot = findPackageRoot(import.meta.dirname);
var sourceDirectory = join(packageRoot, "src");

// src/compile-options.ts
var RUNES_ENVIRONMENT_VARIABLE = "SVELTE_NATIVE_RUNES";
var runesEnvironment = (runes) => runes === void 0 ? {} : { [RUNES_ENVIRONMENT_VARIABLE]: runes ? "1" : "0" };
function runesDefaultEnabled(env = process.env) {
  return !/^(?:0|false|off|no)$/i.test(env[RUNES_ENVIRONMENT_VARIABLE]?.trim() ?? "");
}
var IN_NODE_MODULES = /(?:^|[\\/])node_modules[\\/]/;
var ownSources = sourceDirectory + sep;
function isLibrarySource(filename) {
  if (filename.startsWith(ownSources)) return true;
  if (!IN_NODE_MODULES.test(filename)) return false;
  try {
    return realpathSync(filename).startsWith(ownSources);
  } catch {
    return false;
  }
}
function runesOption(filename, enabled = runesDefaultEnabled()) {
  if (isLibrarySource(filename)) return true;
  if (!enabled || IN_NODE_MODULES.test(filename)) return void 0;
  return true;
}
function webDynamicCompileOptions(app, enabled = true) {
  return async (data) => {
    const own = isLibrarySource(data.filename) || data.compileOptions.runes === void 0 && runesOption(data.filename, enabled) === true;
    const theirs = await app?.(data);
    return own ? { runes: true, ...theirs } : theirs;
  };
}
function withWebRunes(kit, enabled = true) {
  return { ...kit, dynamicCompileOptions: webDynamicCompileOptions(kit?.dynamicCompileOptions, enabled) };
}

// src/route-tree.ts
var PAGE = "+mobile.svelte";
var LAYOUT = "+layout.mobile.svelte";
var isGroup = (segment) => segment.startsWith("(");
var pathOf = (directory) => `/${directory.filter((segment) => !isGroup(segment)).join("/")}`;
var staticSegments = (path) => path.split("/").filter((part) => part !== "" && !part.startsWith("[")).length;
function buildTree(files) {
  const pages = /* @__PURE__ */ new Map();
  const layouts = /* @__PURE__ */ new Map();
  files.forEach((file, index) => {
    const directory = file.path.split("/");
    const name = directory.pop();
    const source = { path: file.path, directory, key: directory.join("/"), index, exports: file.exports };
    if (name === PAGE) pages.set(source.key, source);
    else if (name === LAYOUT) layouts.set(source.key, source);
  });
  const everyDirectory = [...pages.values(), ...layouts.values()];
  const prefixes = (directory) => Array.from({ length: directory.length + 1 }, (_, length) => directory.slice(0, length).join("/"));
  const navigators = /* @__PURE__ */ new Map();
  for (const layout of layouts.values()) {
    const navigator = layout.exports.navigator;
    if (!navigator) continue;
    if (layout.key === "") throw new Error(`${layout.path}: the root layout is the app shell and cannot be a navigator`);
    navigators.set(layout.key, { ...layout, navigator });
  }
  for (const layout of navigators.values()) {
    if (layout.navigator === "tabs" && prefixes(layout.directory).slice(0, -1).some((key) => navigators.get(key)?.navigator === "tabs")) {
      throw new Error(`${layout.path}: a tab bar inside a tab bar is not supported`);
    }
  }
  const paneSources = /* @__PURE__ */ new Map();
  const paneDirectories = /* @__PURE__ */ new Set();
  for (const tabs of navigators.values()) {
    if (tabs.navigator !== "tabs") continue;
    const found = /* @__PURE__ */ new Map();
    for (const source of everyDirectory) {
      if (!source.key.startsWith(`${tabs.key}/`)) continue;
      const relative2 = source.directory.slice(tabs.directory.length);
      let groups = 0;
      while (groups < relative2.length && isGroup(relative2[groups])) groups++;
      if (groups === relative2.length) {
        const isPage = pages.get(source.key) === source;
        if (isPage || navigators.has(source.key)) throw new Error(`${source.path}: a ${isPage ? "page" : "navigator layout"} directly under a tabs layout has no pane to show in; move it into a pane directory`);
        continue;
      }
      const key = relative2[groups];
      const directory = tabs.directory.concat(relative2.slice(0, groups + 1));
      const known = found.get(key);
      if (known && known.directory.join("/") !== directory.join("/")) throw new Error(`pane ${key} of ${tabs.key} is defined twice: ${known.directory.join("/")} and ${directory.join("/")}`);
      if (key.startsWith("[")) throw new Error(`${source.path}: a pane is a fixed directory, not a parameter`);
      if (known) known.first = Math.min(known.first, source.index);
      else found.set(key, { key, directory, first: source.index });
    }
    paneSources.set(tabs.key, [...found.values()].sort((a, b) => a.first - b.first));
    for (const pane of found.values()) paneDirectories.add(pane.directory.join("/"));
  }
  for (const layout of navigators.values()) {
    const page = pages.get(layout.key);
    if (page && !paneDirectories.has(layout.key)) {
      throw new Error(`${page.path}: a ${layout.navigator} layout is the screen of its directory; move the page into ${layout.navigator === "tabs" ? "a pane" : "a child directory"}`);
    }
  }
  const contentLayouts = (directory) => prefixes(directory).slice(1).flatMap((key) => {
    const layout = layouts.get(key);
    return layout && !layout.exports.navigator ? [layout.path] : [];
  });
  const root = { kind: "stack", id: "", path: "/", routes: [] };
  const rootLayout = layouts.get("");
  if (rootLayout) root.shellFile = rootLayout.path;
  const stacks = /* @__PURE__ */ new Map([["", root]]);
  const nodes = /* @__PURE__ */ new Map();
  for (const layout of navigators.values()) {
    if (paneDirectories.has(layout.key)) continue;
    const common = { id: layout.key, path: pathOf(layout.directory), layoutFile: layout.path, layouts: contentLayouts(layout.directory.slice(0, -1)) };
    if (layout.navigator === "stack") {
      const node = { kind: "stack", ...common, routes: [] };
      stacks.set(layout.key, node);
      nodes.set(layout.key, node);
    } else {
      nodes.set(layout.key, { kind: "tabs", ...common, panes: [] });
    }
  }
  for (const [tabsKey, found] of paneSources) {
    const tabs = nodes.get(tabsKey);
    if (tabs?.kind !== "tabs") continue;
    for (const source of found) {
      const key = source.directory.join("/");
      if (!pages.has(key)) throw new Error(`pane ${source.key} of ${tabsKey} has no index page (${PAGE})`);
      const stack = { kind: "stack", id: key, path: pathOf(source.directory), routes: [] };
      const paneLayout = navigators.get(key);
      if (paneLayout) stack.layoutFile = paneLayout.path;
      stacks.set(key, stack);
      tabs.panes.push({ key: source.key, stack });
    }
  }
  const ownerOf = (directory, inclusive) => {
    const keys = prefixes(directory);
    for (let at = keys.length - (inclusive ? 1 : 2); at >= 0; at--) {
      const stack = stacks.get(keys[at]);
      if (stack) return stack;
    }
    return root;
  };
  const members = /* @__PURE__ */ new Map();
  const add = (stack, route, index) => {
    const list = members.get(stack) ?? [];
    list.push({ route, index });
    members.set(stack, list);
  };
  for (const page of pages.values()) {
    add(ownerOf(page.directory, true), {
      kind: "page",
      id: page.key,
      path: pathOf(page.directory),
      presentation: page.exports.presentation ?? "push",
      file: page.path,
      layouts: contentLayouts(page.directory)
    }, page.index);
  }
  for (const node of nodes.values()) {
    const layout = navigators.get(node.id);
    if (layout) add(ownerOf(layout.directory, false), node, layout.index);
  }
  for (const [stack, list] of members) {
    stack.routes = list.sort((a, b) => staticSegments(b.route.path) - staticSegments(a.route.path) || a.index - b.index).map(({ route }) => route);
    for (const route of stack.routes) {
      if (route.kind === "page") continue;
      const clash = stack.routes.find((other) => other !== route && other.path === route.path);
      if (clash) throw new Error(`${route.layoutFile}: ${route.path} is also the path of ${clash.kind === "page" ? clash.file : clash.layoutFile}; a navigator is a screen of its own`);
    }
  }
  return root;
}

// src/variant.ts
var DEFAULT_VARIANT = "app";
var variantName = (env = process.env) => env.APP_VARIANT || DEFAULT_VARIANT;
var labIncludedFor = (variant) => variant !== "production";
var routesTableFile = (variant) => `routes.${variant.replace(/[^A-Za-z0-9_-]/g, "_")}.ts`;

// src/build.ts
var require2 = createRequire(import.meta.url);
var posix = (path) => path.split(sep2).join("/");
function exportedLiteral(ast, file, name, values) {
  for (const statement of ast.module?.content.body ?? []) {
    if (statement.type !== "ExportNamedDeclaration") continue;
    const declarations = statement.declaration?.type === "VariableDeclaration" ? statement.declaration.declarations : [];
    const declared = declarations.find((declaration) => declaration.id.type === "Identifier" && declaration.id.name === name);
    const init = declared?.init;
    const literal = init?.type === "Literal" ? values.find((value) => value === init.value) : void 0;
    if (literal !== void 0) return literal;
    const aliased = statement.specifiers.some((specifier) => specifier.exported.type === "Identifier" && specifier.exported.name === name);
    if (declared || aliased) throw new Error(`${file}: export \`${name}\` as one of the literals ${values.map((value) => JSON.stringify(value)).join(", ")}; the route table reads it at build time`);
  }
  return void 0;
}
function exportedInInstance(ast, name) {
  return (ast.instance?.content.body ?? []).some((statement) => {
    if (statement.type !== "ExportNamedDeclaration") return false;
    const declarations = statement.declaration?.type === "VariableDeclaration" ? statement.declaration.declarations : [];
    return declarations.some((declaration) => declaration.id.type === "Identifier" && declaration.id.name === name) || statement.specifiers.some((specifier) => specifier.exported.type === "Identifier" && specifier.exported.name === name);
  });
}
var PRESENTATIONS = ["push", "modal", "transparentModal", "sheet", "formSheet"];
var NAVIGATORS = ["stack", "tabs"];
var labIncluded = (env = process.env) => labIncludedFor(variantName(env));
var LAB_DIRECTORY = "__dev";
function routeFilesSync(routesRoot, { lab = labIncluded() } = {}) {
  const paths = [];
  function walk(directory) {
    for (const item of readdirSync(directory, { withFileTypes: true })) {
      const path = resolve2(directory, item.name);
      if (item.isDirectory()) {
        if (lab || item.name !== LAB_DIRECTORY) walk(path);
      } else paths.push(posix(relative(routesRoot, path)));
    }
  }
  walk(routesRoot);
  const { parse } = require2("svelte/compiler");
  const files = [];
  const labDirectories = [];
  for (const path of paths.sort((a, b) => a.localeCompare(b))) {
    const name = path.slice(path.lastIndexOf("/") + 1);
    if (name !== "+mobile.svelte" && name !== "+layout.mobile.svelte") continue;
    const ast = parse(readFileSync(resolve2(routesRoot, path), "utf8"), { modern: true, filename: path });
    if (exportedInInstance(ast, "lab")) throw new Error(`${path}: export \`lab\` is ignored in the instance script; move \`lab\` to \`<script module>\`, which the route table reads at build time`);
    const labOnly = exportedLiteral(ast, path, "lab", [true]) === true;
    if (labOnly && path === name && name === "+layout.mobile.svelte") throw new Error(`${path}: the root layout is the app shell and cannot be lab-only`);
    const marked = labOnly && !lab;
    if (name === "+mobile.svelte") {
      if (marked) continue;
      const presentation = exportedLiteral(ast, path, "presentation", PRESENTATIONS);
      files.push({ path, exports: presentation ? { presentation } : {} });
    } else {
      if (marked) {
        labDirectories.push(path.slice(0, path.length - name.length));
        continue;
      }
      const navigator = exportedLiteral(ast, path, "navigator", NAVIGATORS);
      files.push({ path, exports: navigator ? { navigator } : {} });
    }
  }
  return labDirectories.length === 0 ? files : files.filter((file) => !labDirectories.some((directory) => file.path.startsWith(directory)));
}
function treeModule(tree, routesRoot, output, variant, lab) {
  const json = (value) => JSON.stringify(value);
  const code = (file) => `require(${json(posix(relative(output, resolve2(routesRoot, file))))}).default`;
  const loader = (file, layouts = []) => `async () => ({ component: ${code(file)}, layouts: [${layouts.map(code).join(", ")}] })`;
  const routeOf = (route, indent) => {
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
  const nodeOf = (node, indent) => {
    const inner = `${indent}  `;
    const lines = [`kind: ${json(node.kind)}, id: ${json(node.id)}, path: ${json(node.path)},`];
    if (node.layoutFile !== void 0) {
      lines.push(`layoutFile: ${json(node.layoutFile)},${node.layouts ? ` layouts: ${json(node.layouts)},` : ""}`);
      lines.push(`layout: ${loader(node.layoutFile, node.layouts)},`);
    }
    if (node.kind === "stack") {
      if (node.shellFile !== void 0) lines.push(`shellFile: ${json(node.shellFile)},`);
      lines.push(`routes: [
${node.routes.map((route) => `${routeOf(route, `${inner}  `)},`).join("\n")}
${inner}],`);
    } else {
      lines.push(`panes: [
${node.panes.map((pane) => `${inner}  { key: ${json(pane.key)}, stack: ${nodeOf(pane.stack, `${inner}  `).trimStart()} },`).join("\n")}
${inner}],`);
    }
    return `${indent}{
${lines.map((line) => `${inner}${line}`).join("\n")}
${indent}}`;
  };
  return `// Generated by svelte-native sync for the ${variant} app${lab ? "" : " (the development lab's routes are left out)"}.
import type { StackNode } from '@example/svelte-native/router';

export const variant = ${json(variant)};
export const lab = ${lab};
export const tree: StackNode = ${nodeOf(tree, "").trimStart()};
`;
}
function syncRoutes(root, options = {}) {
  const variant = options.variant ?? variantName();
  const lab = options.lab ?? labIncludedFor(variant);
  const routesRoot = resolve2(root, "src/routes");
  const output = resolve2(root, ".svelte-native");
  mkdirSync(output, { recursive: true });
  const manifest = treeModule(buildTree(routeFilesSync(routesRoot, { lab })), routesRoot, output, variant, lab);
  const customRoot = process.env.SVELTE_NATIVE_ROOT;
  const prelude = "import '@example/svelte-native/init';\nimport '@example/svelte-native/polyfills';\nimport { createFabricApp, remountSurfaces } from '@example/svelte-native/fabric';\n";
  const hot = "declare const module: { hot?: { accept(callback?: () => void): void } };\nif (__DEV__) module.hot?.accept(() => remountSurfaces());\n";
  const entry = customRoot ? `${prelude}import App from ${JSON.stringify(posix(relative(output, resolve2(root, customRoot))))};
createFabricApp(App, {});
${hot}` : `${prelude}import App from '../src/routes/+layout.mobile.svelte';
import { tree } from './routes';
createFabricApp(App, { tree });
${hot}`;
  const files = [[routesTableFile(variant), manifest]];
  if (options.entry !== "keep" || customRoot !== void 0 || !existsSync2(resolve2(output, "entry.ts"))) files.push(["entry.ts", entry]);
  for (const [file, content] of files) {
    const destination = resolve2(output, file);
    let current = "";
    try {
      current = readFileSync(destination, "utf8");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    if (current !== content) writeFileSync(destination, content);
  }
  rmSync(resolve2(output, "routes.ts"), { force: true });
}
async function syncNative(root, options = {}) {
  syncRoutes(root, options);
}
function expoEnvironment(args, extra = {}) {
  const env = { ...process.env, EXPO_NO_TELEMETRY: "1", ...extra };
  if (args.includes("--localhost")) env.NODE_OPTIONS = `${env.NODE_OPTIONS ?? ""} --dns-result-order=ipv4first`.trim();
  return env;
}
function runExpo(root, args, extraEnv = {}) {
  return spawn(process.execPath, [require2.resolve("expo/bin/cli"), ...args], {
    cwd: root,
    stdio: "inherit",
    env: expoEnvironment(args, extraEnv)
  });
}
async function exportNative(root, platform, options = {}) {
  await syncNative(root, options);
  const output = resolve2(root, ".svelte-native/dist", platform);
  await mkdir(output, { recursive: true });
  const child = runExpo(root, [
    "export:embed",
    "--platform",
    platform,
    "--entry-file",
    ".svelte-native/entry.ts",
    "--bundle-output",
    resolve2(output, "index.hbc"),
    "--sourcemap-output",
    resolve2(output, "index.hbc.map"),
    "--assets-dest",
    resolve2(output, "assets"),
    "--dev",
    "false",
    "--bytecode",
    "--reset-cache"
  ], runesEnvironment(options.runes));
  const result = await new Promise((done, reject) => {
    child.once("error", reject);
    child.once("exit", done);
  });
  if (result !== 0) throw new Error(`Native ${platform} export exited with ${result}`);
}

// src/remote/kit.ts
import { createRequire as createRequire2 } from "node:module";
var require3 = createRequire2(import.meta.url);
function kitMissingMessage(what) {
  return `${what} needs \`@sveltejs/kit\`, which is not installed (an optional peer dependency of @example/svelte-native: only remote functions and the web target use it). Install the version the package was written against: \`pnpm add @sveltejs/kit@3.0.0-next.27\`, and copy its patch (README, "Apply the patches").`;
}

// src/svelte-build.ts
import { existsSync as existsSync3, readFileSync as readFileSync2 } from "node:fs";
import { createRequire as createRequire3 } from "node:module";
import { dirname as dirname2, join as join2 } from "node:path";
var requiredSvelte = {
  version: "5.56.7",
  commit: "216f258068d93170a927ad4d27ee6864b0b305c5",
  pullRequest: "https://github.com/sveltejs/svelte/pull/18042",
  /** The preview build pkg.pr.new publishes for the commit; byte for byte the tarball in this repository's `vendor/`. */
  preview: "https://pkg.pr.new/svelte@216f258068d93170a927ad4d27ee6864b0b305c5",
  vendored: "vendor/svelte-5.56.7-216f258.tgz"
};
function inspectSvelte(from) {
  let manifestPath;
  try {
    manifestPath = from ?? createRequire3(import.meta.url).resolve("svelte/package.json");
  } catch {
    return { ok: false, version: null, directory: null, reason: "missing" };
  }
  const directory = dirname2(manifestPath);
  const manifest = JSON.parse(readFileSync2(manifestPath, "utf8"));
  const version = manifest.version ?? null;
  const exported = manifest.exports !== void 0 && "./renderer" in manifest.exports;
  if (!exported || !existsSync3(join2(directory, "src/renderer/index.js"))) return { ok: false, version, directory, reason: "stock-release" };
  return { ok: true, version: version ?? "unknown", directory };
}
function customRendererMessage(inspection, what) {
  const found = inspection.reason === "missing" ? "No `svelte` package can be resolved from it." : `The installed svelte${inspection.version ? ` ${inspection.version}` : ""} (${inspection.directory}) has no \`./renderer\` export, so it is a stock release and not the custom-renderer build.`;
  return [
    `${what} needs the custom-renderer build of Svelte (${requiredSvelte.pullRequest}, commit ${requiredSvelte.commit.slice(0, 7)}, version ${requiredSvelte.version}). ${found}`,
    "Install that build in the app instead of svelte from the registry:",
    `  pnpm add svelte@${requiredSvelte.preview}`,
    `or the tarball in the library's repository (${requiredSvelte.vendored}), as \`"svelte": "file:<path to it>"\`. The same build must be the one the app's own \`svelte\` resolves to, so also drop any \`svelte\` override that points elsewhere.`
  ].join("\n");
}
function assertCustomRenderer(what, from) {
  const inspection = inspectSvelte(from);
  if (!inspection.ok) throw new Error(customRendererMessage(inspection, what));
}

// src/vite.ts
async function loadSvelteKit() {
  try {
    return (await import("@sveltejs/kit/vite")).sveltekit;
  } catch (cause) {
    if (cause.code === "ERR_MODULE_NOT_FOUND") throw new Error(kitMissingMessage("The web target of svelteNative() (@example/svelte-native/vite)"), { cause });
    throw cause;
  }
}
function svelteNative(options = {}) {
  if (options.target !== "native") return loadSvelteKit().then((kit) => [
    { name: "svelte-native:web", config: () => ({ optimizeDeps: { entries: ["!src/routes/**/+mobile.svelte", "!src/routes/**/*.mobile.svelte", "!src/lib/native/**"] } }) },
    kit(withWebRunes(options.kit, options.runes))
  ]);
  assertCustomRenderer("The native target of svelteNative() (@example/svelte-native/vite)");
  let root = "";
  return {
    name: "svelte-native",
    config: () => ({ build: { write: false, rolldownOptions: { input: "virtual:svelte-native-build" } } }),
    configResolved(config) {
      root = config.root;
    },
    async buildStart() {
      await syncNative(root, { variant: options.variant });
    },
    resolveId(id) {
      if (id === "virtual:svelte-native-build") return "\0svelte-native-build";
    },
    load(id) {
      if (id === "\0svelte-native-build") return "export {};";
    },
    async generateBundle() {
      await exportNative(resolve3(root), options.platform ?? "android", { variant: options.variant, runes: options.runes });
    }
  };
}
export {
  svelteNative
};
