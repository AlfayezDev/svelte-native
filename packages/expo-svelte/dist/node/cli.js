#!/usr/bin/env node
var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res, err) => function __init() {
  if (err) throw err[0];
  try {
    return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
  } catch (e) {
    throw err = [e], e;
  }
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// src/package-root.ts
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
function findPackageRoot(from) {
  for (let directory = from; ; directory = dirname(directory)) {
    if (existsSync(join(directory, "package.json"))) return directory;
    if (dirname(directory) === directory) throw new Error(`No package.json above ${from}: the package's files moved`);
  }
}
function sourceFile(path) {
  const file = resolve(sourceDirectory, path);
  if (!existsSync(file)) throw new Error(`${file} is not in the package: the Node-side code names a source file that is missing`);
  return file;
}
var packageRoot, sourceDirectory;
var init_package_root = __esm({
  "src/package-root.ts"() {
    "use strict";
    packageRoot = findPackageRoot(import.meta.dirname);
    sourceDirectory = join(packageRoot, "src");
  }
});

// src/compile-options.ts
import { sep } from "node:path";
var RUNES_ENVIRONMENT_VARIABLE, runesEnvironment, ASYNC_ENVIRONMENT_VARIABLE, asyncEnvironment, ownSources;
var init_compile_options = __esm({
  "src/compile-options.ts"() {
    "use strict";
    init_package_root();
    RUNES_ENVIRONMENT_VARIABLE = "EXPO_SVELTE_RUNES";
    runesEnvironment = (runes) => runes === void 0 ? {} : { [RUNES_ENVIRONMENT_VARIABLE]: runes ? "1" : "0" };
    ASYNC_ENVIRONMENT_VARIABLE = "EXPO_SVELTE_ASYNC";
    asyncEnvironment = (enabled) => enabled === void 0 ? {} : { [ASYNC_ENVIRONMENT_VARIABLE]: enabled ? "1" : "0" };
    ownSources = sourceDirectory + sep;
  }
});

// src/route-tree.ts
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
      const relative5 = source.directory.slice(tabs.directory.length);
      let groups = 0;
      while (groups < relative5.length && isGroup(relative5[groups])) groups++;
      if (groups === relative5.length) {
        const isPage = pages.get(source.key) === source;
        if (isPage || navigators.has(source.key)) throw new Error(`${source.path}: a ${isPage ? "page" : "navigator layout"} directly under a tabs layout has no pane to show in; move it into a pane directory`);
        continue;
      }
      const key = relative5[groups];
      const directory = tabs.directory.concat(relative5.slice(0, groups + 1));
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
  const root2 = { kind: "stack", id: "", path: "/", routes: [] };
  const rootLayout = layouts.get("");
  if (rootLayout) root2.shellFile = rootLayout.path;
  const stacks = /* @__PURE__ */ new Map([["", root2]]);
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
    return root2;
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
  return root2;
}
var PAGE, LAYOUT, isGroup, pathOf, staticSegments;
var init_route_tree = __esm({
  "src/route-tree.ts"() {
    "use strict";
    PAGE = "+mobile.svelte";
    LAYOUT = "+layout.mobile.svelte";
    isGroup = (segment) => segment.startsWith("(");
    pathOf = (directory) => `/${directory.filter((segment) => !isGroup(segment)).join("/")}`;
    staticSegments = (path) => path.split("/").filter((part) => part !== "" && !part.startsWith("[")).length;
  }
});

// src/variant.ts
var DEFAULT_VARIANT, variantName, labIncludedFor, routesTableFile, classesTableFile;
var init_variant = __esm({
  "src/variant.ts"() {
    "use strict";
    DEFAULT_VARIANT = "app";
    variantName = (env = process.env) => env.APP_VARIANT || DEFAULT_VARIANT;
    labIncludedFor = (variant) => variant !== "production";
    routesTableFile = (variant) => `routes.${variant.replace(/[^A-Za-z0-9_-]/g, "_")}.ts`;
    classesTableFile = (variant) => `classes.${variant.replace(/[^A-Za-z0-9_-]/g, "_")}.ts`;
  }
});

// src/watch-tree.ts
import { readdirSync, statSync, watch } from "node:fs";
import { dirname as dirname2, join as join2, resolve as resolve2, sep as sep2 } from "node:path";
function watchTree(root2, onChange, options = {}) {
  const base = resolve2(root2);
  const debounceMs = options.debounceMs ?? 50;
  const skip = options.skip ?? ((name) => name === "node_modules" || name.startsWith("."));
  const watchers = /* @__PURE__ */ new Map();
  let waiting = null;
  let timer;
  let closed = false;
  const changed = () => {
    if (closed) return;
    clearTimeout(timer);
    timer = setTimeout(onChange, debounceMs);
    timer.unref?.();
  };
  const add = (directory) => {
    if (closed || watchers.has(directory)) return;
    let watcher;
    try {
      watcher = watch(directory, (_event, name) => {
        if (name) seen(join2(directory, name.toString()), name.toString());
        changed();
      });
    } catch (error) {
      refused(directory, error);
      return;
    }
    watcher.unref();
    watcher.on("error", (error) => {
      refused(directory, error);
      dropTree(directory);
    });
    watchers.set(directory, watcher);
  };
  const seen = (path, name) => {
    if (watchers.has(path)) dropTree(path);
    if (!skip(name) && isDirectory(path)) addTree(path);
  };
  const addTree = (directory) => {
    add(directory);
    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) if (entry.isDirectory() && !skip(entry.name)) addTree(join2(directory, entry.name));
  };
  const dropTree = (directory) => {
    for (const [path, watcher] of watchers) {
      if (path === directory || path.startsWith(directory + sep2)) {
        watcher.close();
        watchers.delete(path);
      }
    }
  };
  const waitForRoot = () => {
    let above = dirname2(base);
    while (!isDirectory(above) && dirname2(above) !== above) above = dirname2(above);
    try {
      waiting = watch(above, () => {
        if (!isDirectory(base)) return;
        waiting?.close();
        waiting = null;
        addTree(base);
        changed();
      });
      waiting.unref();
    } catch (error) {
      refused(above, error);
    }
  };
  if (isDirectory(base)) addTree(base);
  else waitForRoot();
  return {
    close() {
      closed = true;
      clearTimeout(timer);
      waiting?.close();
      waiting = null;
      for (const watcher of watchers.values()) watcher.close();
      watchers.clear();
    }
  };
}
function refused(directory, error) {
  const code = error.code;
  if (code === "ENOENT" || code === "ENOTDIR" || warned) return;
  warned = true;
  const hint = code === "ENOSPC" ? " The system's limit on watches is reached: raise fs.inotify.max_user_watches (sysctl)." : "";
  console.warn(`expo-svelte: cannot watch ${directory} (${code ?? String(error)}); changes below it are not picked up until Metro restarts.${hint}`);
}
function isDirectory(path) {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}
var warned;
var init_watch_tree = __esm({
  "src/watch-tree.ts"() {
    "use strict";
    warned = false;
  }
});

// src/build.ts
import { spawn } from "node:child_process";
import { existsSync as existsSync2, mkdirSync, readFileSync, readdirSync as readdirSync2, rmSync, watch as watch2, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { mkdir } from "node:fs/promises";
import { relative, resolve as resolve3, sep as sep3 } from "node:path";
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
function routeFilesSync(routesRoot, { lab = labIncluded() } = {}) {
  const paths = [];
  function walk(directory) {
    for (const item of readdirSync2(directory, { withFileTypes: true })) {
      const path = resolve3(directory, item.name);
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
    const ast = parse(readFileSync(resolve3(routesRoot, path), "utf8"), { modern: true, filename: path });
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
  const code = (file) => `require(${json(posix(relative(output, resolve3(routesRoot, file))))}).default`;
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
  return `// Generated by expo-svelte sync for the ${variant} app${lab ? "" : " (the development lab's routes are left out)"}.
import type { StackNode } from 'expo-svelte/router';

export const variant = ${json(variant)};
export const lab = ${lab};
export const tree: StackNode = ${nodeOf(tree, "").trimStart()};
`;
}
function staleEntry(source) {
  if (!/^import ['"]\.\/hooks['"];$/m.test(source)) return true;
  const manifest = JSON.parse(readFileSync(resolve3(packageRoot, "package.json"), "utf8"));
  const literal = (text3) => text3.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
  const patterns = Object.keys(manifest.exports);
  const exported = (key) => patterns.some((pattern) => pattern.includes("*") ? new RegExp(`^${pattern.split("*").map(literal).join(".*")}$`).test(key) : pattern === key);
  for (const [, , name, subpath] of source.matchAll(new RegExp(`(['"])(${[manifest.name, ...FORMER_NAMES].map(literal).join("|")})((?:/[^'"]*)?)\\1`, "g"))) {
    if (FORMER_NAMES.includes(name) || !exported(subpath ? `.${subpath}` : ".")) return true;
  }
  return false;
}
function hooksFile(root2) {
  for (const extension of [".ts", ".js"]) {
    const path = resolve3(root2, `src/hooks.mobile${extension}`);
    if (existsSync2(path)) return path;
  }
  return void 0;
}
function hooksModule(root2) {
  const file = hooksFile(root2);
  if (file === void 0) return "// Generated by expo-svelte sync: the app has no src/hooks.mobile.ts.\nimport { registerHooks } from 'expo-svelte/app';\n\nregisterHooks({});\n";
  const specifier = posix(relative(resolve3(root2, ".expo-svelte"), file)).replace(/\.[jt]s$/, "");
  return `// Generated by expo-svelte sync: the app's hooks (${posix(relative(root2, file))}), registered before its layout and routes load.
import { registerHooks } from 'expo-svelte/app';
import * as hooks from ${JSON.stringify(specifier)};

registerHooks(hooks);
`;
}
function writeGenerated(output, file, content) {
  const destination = resolve3(output, file);
  let current = "";
  try {
    current = readFileSync(destination, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (current !== content) writeFileSync(destination, content);
}
function syncRoutes(root2, options = {}) {
  const variant = options.variant ?? variantName();
  const lab = options.lab ?? labIncludedFor(variant);
  const routesRoot = resolve3(root2, "src/routes");
  const output = resolve3(root2, ".expo-svelte");
  mkdirSync(output, { recursive: true });
  const manifest = treeModule(buildTree(routeFilesSync(routesRoot, { lab })), routesRoot, output, variant, lab);
  const customRoot = process.env.EXPO_SVELTE_ROOT;
  const prelude = "import { createFabricApp, remountSurfaces } from 'expo-svelte/app';\nimport './hooks';\n";
  const hot = "declare const module: { hot?: { accept(callback?: () => void): void } };\nif (__DEV__) module.hot?.accept(() => remountSurfaces());\n";
  const entry = customRoot ? `${prelude}import App from ${JSON.stringify(posix(relative(output, resolve3(root2, customRoot))))};
createFabricApp(App, {});
${hot}` : `${prelude}import App from '../src/routes/+layout.mobile.svelte';
import { tree } from './routes';
createFabricApp(App, { tree });
${hot}`;
  const files = [[routesTableFile(variant), manifest], ["hooks.ts", hooksModule(root2)]];
  const entryPath = resolve3(output, "entry.ts");
  if (options.entry !== "keep" || customRoot !== void 0 || !existsSync2(entryPath) || staleEntry(readFileSync(entryPath, "utf8"))) files.push(["entry.ts", entry]);
  for (const [file, content] of files) writeGenerated(output, file, content);
  rmSync(resolve3(output, "routes.ts"), { force: true });
}
async function syncNative(root2, options = {}) {
  syncRoutes(root2, options);
}
function unrefTimer(timer) {
  timer.unref?.();
}
function expoEnvironment(args2, extra = {}) {
  const env = { EXPO_NO_TYPESCRIPT_SETUP: "1", ...process.env, EXPO_NO_TELEMETRY: "1", ...extra };
  if (args2.includes("--localhost")) env.NODE_OPTIONS = `${env.NODE_OPTIONS ?? ""} --dns-result-order=ipv4first`.trim();
  return env;
}
function runExpo(root2, args2, extraEnv = {}) {
  return spawn(process.execPath, [require2.resolve("expo/bin/cli"), ...args2], {
    cwd: root2,
    stdio: "inherit",
    env: expoEnvironment(args2, extraEnv)
  });
}
async function exportNative(root2, platform, options = {}) {
  await syncNative(root2, options);
  const output = resolve3(root2, ".expo-svelte/dist", platform);
  await mkdir(output, { recursive: true });
  const child = runExpo(root2, [
    "export:embed",
    "--platform",
    platform,
    "--entry-file",
    ".expo-svelte/entry.ts",
    "--bundle-output",
    resolve3(output, "index.hbc"),
    "--sourcemap-output",
    resolve3(output, "index.hbc.map"),
    "--assets-dest",
    resolve3(output, "assets"),
    "--dev",
    "false",
    "--bytecode",
    "--reset-cache"
  ], { ...runesEnvironment(options.runes), ...asyncEnvironment(options.async) });
  const result = await new Promise((done, reject) => {
    child.once("error", reject);
    child.once("exit", done);
  });
  if (result !== 0) throw new Error(`Native ${platform} export exited with ${result}`);
}
var require2, posix, PRESENTATIONS, NAVIGATORS, labIncluded, LAB_DIRECTORY, FORMER_NAMES;
var init_build = __esm({
  "src/build.ts"() {
    "use strict";
    init_compile_options();
    init_package_root();
    init_route_tree();
    init_variant();
    init_watch_tree();
    require2 = createRequire(import.meta.url);
    posix = (path) => path.split(sep3).join("/");
    PRESENTATIONS = ["push", "modal", "transparentModal", "sheet", "formSheet"];
    NAVIGATORS = ["stack", "tabs"];
    labIncluded = (env = process.env) => labIncludedFor(variantName(env));
    LAB_DIRECTORY = "__dev";
    FORMER_NAMES = ["@example/svelte-native", "@alfayez/svelte-native"];
  }
});

// src/doctor/shapes.ts
function inFile(read2, path, checks, raw = false) {
  const text3 = read2.read(path);
  if (text3 === void 0) return [`${path} is not in the package`];
  const code = raw ? text3 : stripComments(text3);
  return checks.filter(([, holds2]) => !holds2(code)).map(([problem]) => `${path}: ${problem}`);
}
function kitProblems(read2) {
  return [
    ...inFile(read2, "src/core/sync/create_manifest_data/index.js", [["does not skip the +mobile files of a route directory", has("(?:mobile\\.|(?:layout|error)\\.mobile\\.)")]], true),
    ...inFile(read2, "src/exports/vite/index.js", [["the `+page`/`+layout` warnings still look at .mobile.svelte files", count("filename.endsWith('.mobile.svelte')", 2)]], true)
  ];
}
function pdfProblems(read2) {
  return [
    ...inFile(read2, "android/src/main/java/org/wonday/pdf/events/TopChangeEvent.java", [["canCoalesce() is not overridden to return false", neverCoalesces]]),
    // The library carries the package (`vendor/`), so react-native is not found from the package's own place beside it in node_modules but from the app's directory upwards.
    ...inFile(read2, "android/build.gradle", [
      ["does not look for react-native in the node_modules above the app's directory", has("reactNativeFromAncestor")],
      ["still looks for react-native beside the package itself", (code) => !code.includes("reactNativeFromNodeModulesWithPDF")]
    ], true)
  ];
}
function videoEmitterProblems(emitter) {
  const code = stripComments(emitter);
  const custom = /private class VideoCustomEvent\([\s\S]*?\n {4}\}\n/.exec(code)?.[0] ?? "";
  const problems = [];
  if (!/private val coalescable: Boolean/.test(custom)) problems.push("VideoCustomEvent has no coalescable flag");
  if (!/override fun canCoalesce\(\): Boolean = coalescable/.test(custom)) problems.push("VideoCustomEvent.canCoalesce() does not answer with the flag");
  if (!/fun dispatch\(event: EventTypes, coalescable: Boolean = false, paramsSetter/.test(code)) problems.push("dispatch() does not default to an event that cannot coalesce");
  if (code.match(/: Event</g)?.length !== 1) problems.push("the emitter no longer has exactly one Event class");
  const streams = [...code.matchAll(/event\.dispatch\(EventTypes\.(\w+), coalescable = true\)/g)].map((match) => match[1]).sort();
  if (streams.join(",") !== "EVENT_BANDWIDTH,EVENT_PROGRESS") problems.push(`the events that may coalesce are ${streams.join(", ") || "none"}, not EVENT_BANDWIDTH and EVENT_PROGRESS`);
  return problems;
}
function videoProblems(read2) {
  const path = "android/src/main/java/com/brentvatne/common/react/VideoEventEmitter.kt";
  const emitter = read2.read(path);
  return emitter === void 0 ? [`${path} is not in the package`] : videoEmitterProblems(emitter).map((problem) => `${path}: ${problem}`);
}
function mapsProblems(read2) {
  const directory = "android/src/main/java/com/rnmaps/fabric/event";
  const files = read2.list(directory).filter((file) => file.endsWith(".java"));
  if (files.length === 0) return [`${directory} is not in the package`];
  const problems = [];
  for (const file of files) {
    const stream = mapsStreamEvents.includes(file.slice(0, -".java".length));
    problems.push(...inFile(read2, `${directory}/${file}`, [stream ? ["a stream event no longer coalesces", (code) => !code.includes("canCoalesce")] : ["canCoalesce() is not overridden to return false", neverCoalesces]]));
  }
  problems.push(...inFile(read2, "plugin/build/ios.js", [["the Podfile line of its iOS plugin looks for an installed react-native-maps, not the library's copy", has("require.resolve(\\'expo-svelte/package.json\\')")]], true));
  return problems;
}
function lottieProblems(read2) {
  const directory = "android/src/main/java/com/airbnb/android/react/lottie";
  const events = read2.list(directory).filter((file) => /^On\w+Event\.kt$/.test(file));
  const android = events.length === 0 ? [`${directory} has no event classes`] : events.flatMap((file) => inFile(read2, `${directory}/${file}`, [["canCoalesce() is not overridden to return false", neverCoalesces]]));
  const ios = inFile(read2, "ios/Fabric/LottieAnimationViewComponentView.mm", [["does not keep events until the view has its emitter", (code) => code.includes("_eventsBeforeEmitter") && code.includes("lottieSendEvent:")]]);
  return [...android, ...ios];
}
function rnghProblems(read2) {
  return [
    ...inFile(read2, "scripts/gesture_handler_utils.rb", [["does not look for the Worklets copy beside the package", has(rnghWorkletsLookup)]], true),
    ...rnghManagerProblems(read2)
  ];
}
function rnghManagerProblems(read2) {
  return Object.entries(rnghAdditions).flatMap(([path, lines]) => inFile(read2, path, [
    ...lines.map((line) => [`does not have \`${line.split("\n")[0]}\``, has(line)]),
    ...path.endsWith(".mm") ? [
      ...rnghUses.map((use) => [`does not use \`${use}\``, has(use)]),
      ["does not register through the library's own registerViewWithGestureRecognizerAttachedIfNeeded:", (code) => rnghRegistration.test(code)]
    ] : []
  ], true));
}
function reanimatedProblems(read2) {
  const base = "android/src/main";
  return [
    ...inFile(read2, `${base}/java/com/swmansion/reanimated/SvelteEngineHook.kt`, [["has no `updater` hook", has("var updater")]]),
    ...inFile(read2, `${base}/java/com/swmansion/reanimated/NativeProxy.kt`, [
      ["does not offer the engine's hook before React Native's prop dispatch", has("SvelteEngineHook.updater?.invoke(viewTag, props)")],
      ["has no direct path for opacity and translate/scale transforms", has("private fun applySimpleProps(")]
    ]),
    ...inFile(read2, `${base}/cpp/reanimated/android/NativeProxy.cpp`, [["does not export reanimatedSetSynchronousPropsSink", has("reanimatedSetSynchronousPropsSink")], ["does not call the sink", has("synchronousPropsSink.load")]]),
    ...inFile(read2, `${base}/cpp/reanimated/android/NativeProxy.h`, [["does not declare SynchronousPropsSink", has("SynchronousPropsSink")], ["does not keep the sink's rest buffers", has("sinkRestInts_")]]),
    // The Gradle task and the podspec's script find Worklets by this path (`vendor/react-native-worklets`, beside the copy of Reanimated): by name it is not a package of the app.
    ...inFile(read2, "scripts/validate-worklets-version.js", [["still looks for react-native-worklets by name", has("require('../../react-native-worklets/package.json')")]], true),
    // The patched Android update (the sink above) is reached only through the synchronous update this flag turns on, which an app no longer sets itself.
    ...inFile(read2, "src/featureFlags/staticFlags.json", [["has the synchronous Android update off by default", has('"ANDROID_SYNCHRONOUSLY_UPDATE_UI_PROPS": true')]], true)
  ];
}
function workletsProblems(read2) {
  const check = (path) => inFile(read2, path, [
    ["does not request a native frame on demand", (code) => code.includes("let frameRequested = false;") && code.includes("function requestFrame()")],
    ["still starts the per-frame loop", (code) => !code.includes("/* Start the loop */") && code.split("__nativeRequestAnimationFrame(").length - 1 === 1]
  ], true);
  return [...check("lib/module/runLoop/uiRuntime/requestAnimationFrame.js"), ...check("src/runLoop/uiRuntime/requestAnimationFrame.ts")];
}
function addedLines(patch, file) {
  const start = patch.indexOf(`diff --git a/${file}`);
  if (start < 0) return "";
  const end = patch.indexOf("diff --git", start + 1);
  return patch.slice(start, end < 0 ? void 0 : end).split("\n").filter((line) => line.startsWith("+") && !line.startsWith("+++")).map((line) => line.slice(1)).join("\n");
}
function block(source, header) {
  const match = header.exec(source);
  if (!match) throw new Error(`${header} not found in the registry`);
  const rest = source.slice(match.index + match[0].length);
  return rest.slice(0, rest.search(/^\s*\)\s*$/m));
}
function lazyRegistry(patch) {
  const registry = addedLines(patch, moduleRegistryPath);
  return {
    lazyEntries: [...block(registry, /LAZY_MODULE_NAMES = mapOf\(/).matchAll(/"([\w.]+)" to "(\w+)"/g)].map((match) => [match[1] ?? "", match[2] ?? ""]),
    prewarm: strings(block(registry, /PREWARM_MODULE_NAMES = listOf\(/)),
    startup: strings(/STARTUP_MODULE_NAMES = listOf\(([^)]*)\)/.exec(registry)?.[1] ?? ""),
    definitionOnly: strings(/DEFINITION_ONLY_MODULE_NAMES = setOf\(([^)]*)\)/.exec(registry)?.[1] ?? "")
  };
}
function adapterLoadsRegistryLazily(source) {
  return !/^import .*NativeComponentRegistry/m.test(source) && /require\('react-native\/Libraries\/NativeComponent\/NativeComponentRegistry'\)/.test(source);
}
function expoModulesCoreProblems(read2, patch) {
  const { lazyEntries, prewarm, startup } = lazyRegistry(patch);
  return [
    ...inFile(read2, moduleRegistryPath, [
      ["does not list the lazy modules the patch defines", (text3) => lazyEntries.length > 10 && lazyEntries.every(([className, name]) => text3.includes(`"${className}" to "${name}"`))],
      ["does not name the prewarmed and startup modules the patch defines", (text3) => [...prewarm, ...startup].every((name) => text3.includes(`"${name}"`))]
    ], true),
    ...inFile(read2, "android/src/main/java/expo/modules/adapters/react/NativeModulesProxy.java", [["cannot build the interop registry in the background", has("startInteropInBackground")]], true),
    ...inFile(read2, "src/NativeViewManagerAdapter.native.tsx", [["imports the native component registry when it loads", adapterLoadsRegistryLazily]], true)
  ];
}
function riveProblems(read2) {
  return inFile(read2, "android/src/main/java/com/rivereactnative/RiveReactNativeView.kt", [
    ["an event still goes through the old architecture's event emitter (a soft exception for every event in a bridgeless app)", (code) => !code.includes("RCTEventEmitter")],
    ["the view's events are not sent through the event dispatcher", (code) => code.includes("getEventDispatcherForReactTag")]
  ]);
}
var stripComments, neverCoalescesPattern, neverCoalesces, has, count, mapsStreamEvents, rnghAdditions, rnghUses, rnghRegistration, rnghWorkletsLookup, strings, moduleRegistryPath;
var init_shapes = __esm({
  "src/doctor/shapes.ts"() {
    "use strict";
    stripComments = (code) => code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    neverCoalescesPattern = /(?:@Override\s+public boolean canCoalesce\(\)\s*\{\s*return false;\s*\}|override fun canCoalesce\(\): Boolean = false)/;
    neverCoalesces = (code) => neverCoalescesPattern.test(stripComments(code));
    has = (needle) => (code) => code.includes(needle);
    count = (needle, atLeast) => (code) => code.split(needle).length - 1 >= atLeast;
    mapsStreamEvents = ["OnDragEvent", "OnMarkerDragEvent", "OnPanDragEvent", "OnRegionChangeEvent", "OnUserLocationChangeEvent"];
    rnghAdditions = {
      "apple/RNGestureHandlerManager.h": ["+ (nullable RNGestureHandlerManager *)currentManager;", "- (void)registerRootViewGestureRecognizerIfAttachedBelow:(nonnull RNGHUIView *)view;"],
      "apple/RNGestureHandlerManager.mm": ["+ (nullable RNGestureHandlerManager *)currentManager\n{", "- (void)registerRootViewGestureRecognizerIfAttachedBelow:(nonnull RNGHUIView *)view\n{"]
    };
    rnghUses = ["RNGHViewHasSurfaceTouchHandler(touchHandlerView)"];
    rnghRegistration = /\[self registerViewWithGestureRecognizerAttachedIfNeeded:view\];/;
    rnghWorkletsLookup = "File.expand_path('../../react-native-worklets', __dir__)";
    strings = (text3) => [...text3.matchAll(/"([^"]+)"/g)].map((match) => match[1] ?? "");
    moduleRegistryPath = "android/src/main/java/expo/modules/kotlin/ModuleRegistry.kt";
  }
});

// src/doctor/patches.ts
import { readdirSync as readdirSync3 } from "node:fs";
import { resolve as resolve4 } from "node:path";
function patchFiles(directory = patchesDirectory) {
  return readdirSync3(directory).filter((file) => file.endsWith(".patch")).sort().map((file) => {
    const stem = file.slice(0, -".patch".length);
    const at = stem.lastIndexOf("@");
    if (at <= 0) throw new Error(`${file}: a patch is named <package>@<version>.patch`);
    return { package: stem.slice(0, at).replaceAll("__", "/"), version: stem.slice(at + 1), file, path: resolve4(directory, file) };
  });
}
var patchesDirectory, patchSpecs, patchKey;
var init_patches = __esm({
  "src/doctor/patches.ts"() {
    "use strict";
    init_package_root();
    init_shapes();
    patchesDirectory = resolve4(packageRoot, "patches");
    patchSpecs = [
      { package: "@sveltejs/kit", does: "SvelteKit leaves the `+mobile.svelte` files of a route directory alone", inspect: kitProblems },
      { package: "expo-modules-core", via: "expo", does: "Expo modules register lazily and the common ones are prewarmed (Android start)", inspect: expoModulesCoreProblems },
      { package: "lottie-react-native", vendored: true, does: "Lottie's events are delivered one by one (Android) and a load or failure before the emitter exists is kept (iOS)", inspect: lottieProblems },
      { package: "react-native-gesture-handler", vendored: true, does: "the root gesture recognizer can be registered for the screens the library presents, and the podspec finds the Worklets copy beside it (iOS)", inspect: rnghProblems },
      { package: "react-native-maps", vendored: true, does: "the map's discrete events are delivered one by one, its streams still coalesce (Android); its iOS plugin points the Podfile at the library's copy", inspect: mapsProblems },
      { package: "react-native-pdf", vendored: true, does: "the pdf view's one event, which carries every message, no longer coalesces, and react-native is found from the app's directory (Android)", inspect: pdfProblems },
      { package: "react-native-reanimated", vendored: true, does: "the engine's views are written natively and opacity/translate/scale skip React Native's prop path (Android), the Android synchronous update is on by default, and Worklets is the copy beside it", inspect: reanimatedProblems },
      { package: "react-native-video", vendored: true, does: "only progress and bandwidth events coalesce; every other video event is delivered (Android)", inspect: videoProblems },
      { package: "react-native-worklets", vendored: true, does: "the UI runtime asks for a frame only while a callback waits, with no idle per-frame loop", inspect: workletsProblems },
      { package: "rive-react-native", vendored: true, does: "the Rive view sends its events through the event dispatcher, not the old event emitter that a bridgeless app reports for every event (Android)", inspect: riveProblems }
    ];
    patchKey = (patch) => `${patch.package}@${patch.version}`;
  }
});

// src/doctor/semver.ts
function parseVersion(text3) {
  const match = VERSION.exec(text3.trim());
  if (!match) return void 0;
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]), prerelease: match[4] ? match[4].split(".") : [] };
}
function compareIdentifiers(a, b) {
  const numericA = /^\d+$/.test(a);
  const numericB = /^\d+$/.test(b);
  if (numericA && numericB) return Math.sign(Number(a) - Number(b));
  if (numericA) return -1;
  if (numericB) return 1;
  return a < b ? -1 : a > b ? 1 : 0;
}
function compareVersions(a, b) {
  for (const key of ["major", "minor", "patch"]) {
    if (a[key] !== b[key]) return Math.sign(a[key] - b[key]);
  }
  if (a.prerelease.length === 0 || b.prerelease.length === 0) return Math.sign(b.prerelease.length - a.prerelease.length);
  for (let index = 0; index < Math.max(a.prerelease.length, b.prerelease.length); index++) {
    const left = a.prerelease[index];
    const right = b.prerelease[index];
    if (left === void 0) return -1;
    if (right === void 0) return 1;
    const order = compareIdentifiers(left, right);
    if (order !== 0) return order;
  }
  return 0;
}
function comparatorsOf(token) {
  const operator = /^(\^|~|>=|<=|>|<|=)?\s*(.*)$/.exec(token);
  const match = PARTIAL.exec(operator?.[2] ?? "");
  if (!match) return void 0;
  const wildcard = (part) => part === void 0 || /^[xX*]$/.test(part);
  const [, major, minor, patch, prerelease] = match;
  const make = (a, b, c, pre = "") => ({ major: a, minor: b, patch: c, prerelease: pre ? pre.split(".") : [] });
  const lowest = make(wildcard(major) ? 0 : Number(major), wildcard(minor) ? 0 : Number(minor), wildcard(patch) ? 0 : Number(patch), prerelease);
  const lowestOfNext = () => {
    if (wildcard(major)) return void 0;
    if (wildcard(minor)) return make(Number(major) + 1, 0, 0, "0");
    if (wildcard(patch)) return make(Number(major), Number(minor) + 1, 0, "0");
    return void 0;
  };
  const op = operator?.[1] ?? "";
  const partial = wildcard(major) || wildcard(minor) || wildcard(patch);
  if (op === "^") {
    const upper = lowest.major > 0 || wildcard(minor) ? make(lowest.major + 1, 0, 0, "0") : lowest.minor > 0 || wildcard(patch) ? make(0, lowest.minor + 1, 0, "0") : make(0, 0, lowest.patch + 1, "0");
    return [{ operator: ">=", version: lowest }, { operator: "<", version: upper }];
  }
  if (op === "~") {
    const upper = wildcard(minor) ? make(lowest.major + 1, 0, 0, "0") : make(lowest.major, lowest.minor + 1, 0, "0");
    return [{ operator: ">=", version: lowest }, { operator: "<", version: upper }];
  }
  if (op === "" || op === "=") {
    if (!partial) return [{ operator: "=", version: lowest }];
    const upper = lowestOfNext();
    return upper ? [{ operator: ">=", version: lowest }, { operator: "<", version: upper }] : [];
  }
  if (partial) {
    if (op === ">") return [{ operator: ">=", version: lowestOfNext() ?? lowest }];
    if (op === "<=") return lowestOfNext() ? [{ operator: "<", version: lowestOfNext() }] : [];
  }
  return [{ operator: op, version: lowest }];
}
function holds(version, { operator, version: bound }) {
  const order = compareVersions(version, bound);
  return operator === "=" ? order === 0 : operator === ">=" ? order >= 0 : operator === ">" ? order > 0 : operator === "<=" ? order <= 0 : order < 0;
}
function satisfies(version, range) {
  const installed = parseVersion(version);
  if (!installed) return void 0;
  let readable = false;
  for (const alternative of range.split("||")) {
    const tokens = alternative.trim().replace(/(\^|~|>=|<=|>|<|=)\s+/g, "$1").split(/\s+/).filter(Boolean);
    const sets = tokens.map(comparatorsOf);
    if (tokens.length === 0 || sets.some((set) => set === void 0)) return void 0;
    readable = true;
    const comparators = sets.flat();
    const allowsPrerelease = installed.prerelease.length === 0 || comparators.some(({ version: bound }) => bound.prerelease.length > 0 && bound.major === installed.major && bound.minor === installed.minor && bound.patch === installed.patch);
    if (allowsPrerelease && comparators.every((comparator) => holds(installed, comparator))) return true;
  }
  return readable ? false : void 0;
}
var VERSION, PARTIAL;
var init_semver = __esm({
  "src/doctor/semver.ts"() {
    "use strict";
    VERSION = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;
    PARTIAL = /^v?(\d+|[xX*])(?:\.(\d+|[xX*]))?(?:\.(\d+|[xX*]))?(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;
  }
});

// src/svelte-build.ts
var requiredSvelte;
var init_svelte_build = __esm({
  "src/svelte-build.ts"() {
    "use strict";
    requiredSvelte = {
      version: "5.56.7",
      commit: "216f258068d93170a927ad4d27ee6864b0b305c5",
      pullRequest: "https://github.com/sveltejs/svelte/pull/18042",
      /** The preview build pkg.pr.new publishes for the commit; byte for byte the tarball in this repository's `vendor/`. */
      preview: "https://pkg.pr.new/svelte@216f258068d93170a927ad4d27ee6864b0b305c5",
      vendored: "vendor/svelte-5.56.7-216f258.tgz"
    };
  }
});

// src/optional-libraries.ts
var react, expo, optionalLibraries;
var init_optional_libraries = __esm({
  "src/optional-libraries.ts"() {
    "use strict";
    react = "react-native";
    expo = "expo";
    optionalLibraries = [
      // Expo modules: found by Expo's autolinker through `expo-module.config.json`, which lists the Android class and the Swift module, so they have no `android` or `ios` entry here.
      { name: "expo-blur", version: "58.0.6", optional: { kind: expo } },
      { name: "expo-conic-gradient", version: "0.2.1", optional: { kind: expo } },
      { name: "expo-image", version: "58.0.18", optional: { kind: expo, plugin: "app.plugin.js" } },
      { name: "expo-linear-gradient", version: "58.0.4", optional: { kind: expo } },
      { name: "expo-video", version: "58.0.14", optional: { kind: expo, plugin: "app.plugin.js" } },
      // React Native packages: an entry of the autolinking config for each platform.
      {
        name: "@react-native-community/datetimepicker",
        version: "9.2.1",
        android: { packageImportPath: "import com.reactcommunity.rndatetimepicker.RNDateTimePickerPackage;", packageInstance: "new RNDateTimePickerPackage()" },
        ios: { podspec: "RNDateTimePicker.podspec" },
        optional: { kind: react, plugin: "app.plugin.js" }
      },
      {
        name: "lottie-react-native",
        version: "7.5.0",
        android: { packageImportPath: "import com.airbnb.android.react.lottie.LottiePackage;", packageInstance: "new LottiePackage()", componentDescriptors: ["LottieAnimationViewComponentDescriptor"] },
        ios: { podspec: "lottie-react-native.podspec" },
        optional: { kind: react }
      },
      {
        name: "react-native-animateable-text",
        version: "0.19.3",
        android: {
          packageImportPath: "import com.reactnativereanimatedtext.ReanimatedTextPackage;",
          packageInstance: "new ReanimatedTextPackage()",
          libraryName: "JBAnimatedText",
          componentDescriptors: ["CParagraphComponentDescriptor"],
          cmakeListsPath: "android/src/main/jni/CMakeLists.txt"
        },
        ios: { podspec: "react-native-animateable-text.podspec" },
        optional: { kind: react }
      },
      {
        name: "react-native-blob-util",
        version: "0.24.9",
        android: { packageImportPath: "import com.ReactNativeBlobUtil.ReactNativeBlobUtilPackage;", packageInstance: "new ReactNativeBlobUtilPackage()" },
        ios: { podspec: "react-native-blob-util.podspec" },
        optional: { kind: react }
      },
      {
        // No iOS code: `ShadowedView` is React Native's own `View` there (the layer's shadow), so the library has no podspec.
        name: "react-native-fast-shadow",
        version: "0.1.1",
        android: { packageImportPath: "import com.reactnativefastshadow.FastShadowPackage;", packageInstance: "new FastShadowPackage()" },
        optional: { kind: react }
      },
      {
        name: "react-native-maps",
        version: "1.29.11",
        android: {
          packageImportPath: "import com.rnmaps.maps.MapsPackage;",
          packageInstance: "new MapsPackage()",
          componentDescriptors: [
            "RNMapsCalloutComponentDescriptor",
            "RNMapsCircleComponentDescriptor",
            "RNMapsGoogleMapViewComponentDescriptor",
            "RNMapsGooglePolygonComponentDescriptor",
            "RNMapsMapViewComponentDescriptor",
            "RNMapsMarkerComponentDescriptor",
            "RNMapsOverlayComponentDescriptor",
            "RNMapsPolylineComponentDescriptor",
            "RNMapsUrlTileComponentDescriptor",
            "RNMapsWMSTileComponentDescriptor"
          ],
          cmakeListsPath: "android/src/main/jni/CMakeLists.txt"
        },
        ios: { podspec: "react-native-maps.podspec" },
        optional: { kind: react, plugin: "app.plugin.js" }
      },
      {
        // The PDF view reads its files through react-native-blob-util's native module, so turning it on turns that one on.
        name: "react-native-pdf",
        version: "7.0.3",
        android: { packageImportPath: "import org.wonday.pdf.RNPDFPackage;", packageInstance: "new RNPDFPackage()", componentDescriptors: ["RNPDFPdfViewComponentDescriptor"] },
        ios: { podspec: "react-native-pdf.podspec" },
        optional: { kind: react, requires: ["react-native-blob-util"] }
      },
      {
        name: "react-native-video",
        version: "6.19.3",
        android: { packageImportPath: "import com.brentvatne.react.ReactVideoPackage;", packageInstance: "new ReactVideoPackage()" },
        ios: { podspec: "react-native-video.podspec" },
        optional: { kind: react, plugin: "app.plugin.js" }
      },
      {
        name: "react-native-view-shot",
        version: "6.1.1",
        android: { packageImportPath: "import fr.greweb.reactnativeviewshot.RNViewShotPackage;", packageInstance: "new RNViewShotPackage()" },
        ios: { podspec: "react-native-view-shot.podspec" },
        optional: { kind: react }
      },
      {
        name: "react-native-webview",
        version: "14.0.1",
        android: { packageImportPath: "import com.reactnativecommunity.webview.RNCWebViewPackage;", packageInstance: "new RNCWebViewPackage()", componentDescriptors: ["RNCWebViewComponentDescriptor"] },
        ios: { podspec: "react-native-webview.podspec" },
        optional: { kind: react }
      },
      {
        name: "rive-react-native",
        version: "9.7.1",
        android: { packageImportPath: "import com.rivereactnative.RiveReactNativePackage;", packageInstance: "new RiveReactNativePackage()" },
        ios: { podspec: "rive-react-native.podspec" },
        optional: { kind: react }
      }
    ];
  }
});

// src/vendored.ts
import { readFileSync as readFileSync2, realpathSync } from "node:fs";
import { isAbsolute, join as join3, relative as relative2, sep as sep4 } from "node:path";
function gradleLibraryName(buildGradle) {
  try {
    return /^\s*libraryName\s*=\s*"([^"]+)"/m.exec(readFileSync2(buildGradle, "utf8"))?.[1];
  } catch {
    return void 0;
  }
}
function vendoredDependency(vendored2, platform, root2 = packageRoot) {
  const directory = vendoredRoot(vendored2.name, root2);
  const manifest = readJson(join3(directory, "package.json")) ?? {};
  if (platform === "android") {
    const android = vendored2.android;
    if (!android) return void 0;
    const sourceDir = join3(directory, "android");
    const codegen = manifest.codegenConfig;
    const codegenName = typeof codegen === "object" && codegen !== null && "name" in codegen && typeof codegen.name === "string" ? codegen.name : void 0;
    const libraryName = android.libraryName ?? codegenName ?? gradleLibraryName(join3(sourceDir, "build.gradle"));
    const cxx = android.cxxModule;
    return {
      root: directory,
      name: vendored2.name,
      platforms: {
        android: {
          sourceDir,
          packageImportPath: android.packageImportPath,
          packageInstance: android.packageInstance,
          buildTypes: [],
          ...libraryName === void 0 ? {} : { libraryName },
          componentDescriptors: [...android.componentDescriptors ?? []],
          cmakeListsPath: join3(directory, android.cmakeListsPath ?? "android/build/generated/source/codegen/jni/CMakeLists.txt"),
          cxxModuleCMakeListsModuleName: cxx?.cmakeListsModuleName ?? null,
          cxxModuleCMakeListsPath: cxx ? join3(directory, cxx.cmakeListsPath) : null,
          cxxModuleHeaderName: cxx?.headerName ?? null,
          isPureCxxDependency: false
        }
      }
    };
  }
  if (!vendored2.ios) return void 0;
  return {
    root: directory,
    name: vendored2.name,
    platforms: { ios: { podspecPath: join3(directory, vendored2.ios.podspec), version: typeof manifest.version === "string" ? manifest.version : vendored2.version, configurations: [], scriptPhases: [] } }
  };
}
function declaredVendored(appRoot) {
  const manifest = readJson(join3(appRoot, "package.json"));
  if (!manifest) return [];
  const declared = /* @__PURE__ */ new Set();
  for (const group3 of ["dependencies", "devDependencies", "optionalDependencies"]) {
    const entries = manifest[group3];
    if (typeof entries === "object" && entries !== null) for (const name of Object.keys(entries)) declared.add(name);
  }
  return vendoredNames.filter((name) => declared.has(name));
}
function collisionMessage(names, library2 = "expo-svelte") {
  const list = names.map((name) => `${name} ${vendoredPackage(name)?.version ?? ""}`.trim());
  const them = names.length === 1 ? "it" : "them";
  const optional = names.filter((name) => vendoredPackage(name)?.optional !== void 0);
  const turnOn = optional.length === 0 ? "" : ` ${optional.length === 1 ? "It is" : "They are"} optional: turn ${optional.length === 1 ? "it" : "them"} on with \`libraries: { ${optional.map((name) => `"${name}": true`).join(", ")} }\` in the ${library2} plugin's options (its own plugin options go there instead of in \`plugins\`).`;
  return `${library2} includes ${list.join(" and ")}; remove ${them} from the app's dependencies (package.json) and any \`patchedDependencies\` entry for ${them} (pnpm stops on a patch of a package it no longer installs), reinstall, and prebuild again. The library links its own copy; a second one would be linked beside it. A library of the app that asks for ${them} as a peer dependency is served by the copy (Metro resolves the name to it; the Gradle project and the pod keep the name), so nothing needs to take ${them === "it" ? "its" : "their"} place.${turnOn}`;
}
function withRequired(names) {
  const all = /* @__PURE__ */ new Set();
  const add = (name) => {
    if (all.has(name)) return;
    all.add(name);
    for (const required of vendoredPackage(name)?.optional?.requires ?? []) add(required);
  };
  for (const name of names) add(name);
  return [...all];
}
function linkVendored(config, platform, root2 = packageRoot, linked = []) {
  const on = new Set(withRequired(linked));
  const entries = vendoredPackages.flatMap((vendored2) => {
    if (vendored2.optional !== void 0 && !on.has(vendored2.name)) return [];
    const dependency = vendoredDependency(vendored2, platform, root2);
    return dependency ? [[vendored2.name, dependency]] : [];
  });
  const dependencies = { ...config.dependencies ?? {} };
  const others = vendoredPackages.filter((vendored2) => dependencies[vendored2.name] !== void 0 && real(dependencies[vendored2.name]?.root ?? "") !== real(vendoredRoot(vendored2.name, root2))).map((vendored2) => vendored2.name);
  if (others.length > 0 && typeof config.root === "string") {
    const declared = declaredVendored(config.root).filter((name) => others.includes(name));
    if (declared.length > 0) throw new VendoredCollision(declared);
  }
  for (const vendored2 of optionalPackages) if (!on.has(vendored2.name)) delete dependencies[vendored2.name];
  const sorted = Object.entries({ ...dependencies, ...Object.fromEntries(entries) }).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
  return { ...config, dependencies: Object.fromEntries(sorted) };
}
var vendoredPackages, vendoredNames, optionalPackages, alwaysLinkedPackages, vendoredPackage, vendorDirectory, vendoredRoot, real, readJson, VendoredCollision;
var init_vendored = __esm({
  "src/vendored.ts"() {
    "use strict";
    init_optional_libraries();
    init_package_root();
    vendoredPackages = [
      // The optional view libraries (`optional-libraries.ts`).
      ...optionalLibraries,
      {
        name: "react-native-nitro-modules",
        version: "0.35.10",
        android: { packageImportPath: "import com.margelo.nitro.NitroModulesPackage;", packageInstance: "new NitroModulesPackage()" },
        ios: { podspec: "NitroModules.podspec" }
      },
      {
        name: "react-native-mmkv",
        version: "4.3.1",
        android: { packageImportPath: "import com.margelo.nitro.mmkv.NitroMmkvPackage;", packageInstance: "new NitroMmkvPackage()" },
        ios: { podspec: "NitroMmkv.podspec" }
      },
      {
        // The base64 module quick-crypto and its Buffer ask for (`libraryName` QuickBase64 is the `react { }` block of its build.gradle).
        name: "react-native-quick-base64",
        version: "2.2.2",
        android: { packageImportPath: "import com.reactnativequickbase64.QuickBase64Package;", packageInstance: "new QuickBase64Package()" },
        ios: { podspec: "react-native-quick-base64.podspec" }
      },
      {
        // `crypto` and `crypto.subtle`: a Nitro module over OpenSSL (and libsodium, when the plugin's `sodiumEnabled` is on). It links the vendored Nitro runtime by its project name and pod.
        name: "react-native-quick-crypto",
        version: "1.1.3",
        android: { packageImportPath: "import com.margelo.nitro.quickcrypto.QuickCryptoPackage;", packageInstance: "new QuickCryptoPackage()" },
        ios: { podspec: "QuickCrypto.podspec" }
      },
      {
        // The `Intl` constructors Hermes lacks: a pure C++ TurboModule (no view, no module class: the `ReactPackage` is empty), so Android adds its CMake module to the app's build.
        name: "hermes-intl",
        version: "0.1.2",
        android: { packageImportPath: "import dev.hermesintl.HermesIntlPackage;", packageInstance: "new HermesIntlPackage()", cxxModule: { cmakeListsModuleName: "hermesintl", cmakeListsPath: "android/CMakeLists.txt", headerName: "NativeHermesIntl" } },
        ios: { podspec: "HermesIntl.podspec" }
      },
      {
        name: "react-native-gesture-handler",
        version: "3.3.0",
        // The one component descriptor and the CMake file its `react-native.config.js` names (`RNGestureHandlerDetector`: the shadow node of `shared/shadowNodes`, and `android/CMakeLists.txt`
        // builds it with the codegen's); the button and the root view are the codegen's alone and need no registration. `libraryName` is `codegenConfig.name`.
        android: { packageImportPath: "import com.swmansion.gesturehandler.RNGestureHandlerPackage;", packageInstance: "new RNGestureHandlerPackage()", componentDescriptors: ["RNGestureHandlerDetectorComponentDescriptor"], cmakeListsPath: "android/CMakeLists.txt" },
        ios: { podspec: "RNGestureHandler.podspec" }
      },
      {
        name: "react-native-worklets",
        version: "0.13.0",
        android: { packageImportPath: "import com.swmansion.worklets.WorkletsPackage;", packageInstance: "new WorkletsPackage()" },
        ios: { podspec: "RNWorklets.podspec" }
      },
      {
        name: "react-native-reanimated",
        version: "4.7.1",
        // The one component of its `react-native.config.js` (the shared-transition boundary) and its codegen CMake file, which is in the sources and not below `android/build/` (a test reads both from the copy).
        android: {
          packageImportPath: "import com.swmansion.reanimated.ReanimatedPackage;",
          packageInstance: "new ReanimatedPackage()",
          componentDescriptors: ["REASharedTransitionBoundaryComponentDescriptor"],
          cmakeListsPath: "Common/NativeView/CMakeLists.txt"
        },
        ios: { podspec: "RNReanimated.podspec" }
      },
      {
        name: "react-native-svg",
        version: "15.16.0",
        // The 29 components of its `react-native.config.js`, and its codegen CMake file, which is in the sources and not below `android/build/` (a test reads both from the copy).
        android: {
          packageImportPath: "import com.horcrux.svg.SvgPackage;",
          packageInstance: "new SvgPackage()",
          componentDescriptors: [
            "RNSVGCircleComponentDescriptor",
            "RNSVGClipPathComponentDescriptor",
            "RNSVGDefsComponentDescriptor",
            "RNSVGFeBlendComponentDescriptor",
            "RNSVGFeColorMatrixComponentDescriptor",
            "RNSVGFeCompositeComponentDescriptor",
            "RNSVGFeFloodComponentDescriptor",
            "RNSVGFeGaussianBlurComponentDescriptor",
            "RNSVGFeMergeComponentDescriptor",
            "RNSVGFeOffsetComponentDescriptor",
            "RNSVGFilterComponentDescriptor",
            "RNSVGEllipseComponentDescriptor",
            "RNSVGForeignObjectComponentDescriptor",
            "RNSVGGroupComponentDescriptor",
            "RNSVGImageComponentDescriptor",
            "RNSVGLinearGradientComponentDescriptor",
            "RNSVGLineComponentDescriptor",
            "RNSVGMarkerComponentDescriptor",
            "RNSVGMaskComponentDescriptor",
            "RNSVGPathComponentDescriptor",
            "RNSVGPatternComponentDescriptor",
            "RNSVGRadialGradientComponentDescriptor",
            "RNSVGRectComponentDescriptor",
            "RNSVGSvgViewAndroidComponentDescriptor",
            "RNSVGSymbolComponentDescriptor",
            "RNSVGTextComponentDescriptor",
            "RNSVGTextPathComponentDescriptor",
            "RNSVGTSpanComponentDescriptor",
            "RNSVGUseComponentDescriptor"
          ],
          cmakeListsPath: "android/src/main/jni/CMakeLists.txt"
        },
        ios: { podspec: "RNSVG.podspec" }
      }
    ];
    vendoredNames = vendoredPackages.map((vendored2) => vendored2.name);
    optionalPackages = vendoredPackages.filter((vendored2) => vendored2.optional !== void 0);
    alwaysLinkedPackages = vendoredPackages.filter((vendored2) => vendored2.optional === void 0);
    vendoredPackage = (name) => vendoredPackages.find((vendored2) => vendored2.name === name);
    vendorDirectory = (root2 = packageRoot) => join3(root2, "vendor");
    vendoredRoot = (name, root2 = packageRoot) => join3(vendorDirectory(root2), name);
    real = (path) => {
      try {
        return realpathSync(path);
      } catch {
        return path;
      }
    };
    readJson = (file) => {
      try {
        const parsed = JSON.parse(readFileSync2(file, "utf8"));
        return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed : void 0;
      } catch {
        return void 0;
      }
    };
    VendoredCollision = class extends Error {
      names;
      constructor(names) {
        super(collisionMessage(names));
        this.name = "VendoredCollision";
        this.names = names;
      }
    };
  }
});

// src/init-app.ts
var init_app_exports = {};
__export(init_app_exports, {
  appDependencies: () => appDependencies,
  appNames: () => appNames,
  applyPlan: () => applyPlan,
  expoSvelteViteConfig: () => expoSvelteViteConfig,
  formatPlan: () => formatPlan,
  mergeWorkspaceYaml: () => mergeWorkspaceYaml,
  parseInitArguments: () => parseInitArguments,
  planInit: () => planInit,
  runInit: () => runInit
});
import { spawnSync } from "node:child_process";
import { existsSync as existsSync3, mkdirSync as mkdirSync2, readFileSync as readFileSync3, readdirSync as readdirSync4, writeFileSync as writeFileSync2 } from "node:fs";
import { createRequire as createRequire2 } from "node:module";
import { dirname as dirname3, join as join4, relative as relative3 } from "node:path";
function indentOf(text3) {
  return /^([ \t]+)"/m.exec(text3)?.[1] ?? "	";
}
function setEntry(map, name, value) {
  if (name in map) {
    map[name] = value;
    return;
  }
  const keys = Object.keys(map);
  const sorted = keys.every((key, index) => index === 0 || (keys[index - 1] ?? "") <= key);
  const entries = Object.entries({ ...map, [name]: value });
  if (sorted) entries.sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
  for (const key of keys) delete map[key];
  for (const [key, entry] of entries) map[key] = entry;
}
function appNames(packageName, options = {}) {
  const bare = (packageName ?? "app").replace(/^@[^/]+\//, "");
  let slug = bare.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "app";
  if (!/^[a-z]/.test(slug)) slug = `app-${slug}`;
  const id = slug.replaceAll("-", "");
  const title = options.name ?? (/^[A-Za-z0-9 ._-]+$/.test(bare) ? bare : slug);
  return { title, slug, androidPackage: options.androidPackage ?? `dev.example.${id}`, iosBundleId: options.iosBundleId ?? `dev.example.${id}` };
}
function installedVersion(root2, name) {
  const text3 = read(join4(root2, "node_modules", name, "package.json"));
  if (text3 === void 0) return void 0;
  try {
    return JSON.parse(text3).version;
  } catch {
    return void 0;
  }
}
function newestKitVersion(kitPatches) {
  const parsed = kitPatches.flatMap((patch) => {
    const version = parseVersion(patch.version);
    return version ? [{ patch, version }] : [];
  });
  return parsed.sort((a, b) => compareVersions(a.version, b.version)).at(-1)?.patch.version;
}
function planPackageJson(root2, original, patches2, options) {
  const manifest = JSON.parse(original);
  const summary = [];
  const warnings = [];
  const dependencies = { ...manifest.dependencies ?? {} };
  const devDependencies = { ...manifest.devDependencies ?? {} };
  const setDependency = (name, value, preferred) => {
    const list = name in dependencies ? dependencies : name in devDependencies ? devDependencies : preferred === "dependencies" ? dependencies : devDependencies;
    if (list[name] === value) return false;
    setEntry(list, name, value);
    return true;
  };
  const has2 = (name) => name in dependencies || name in devDependencies;
  const next = { ...manifest };
  if (next.main !== ".expo-svelte/entry.ts") {
    if (next.main === void 0 || options.force) {
      next.main = ".expo-svelte/entry.ts";
      summary.push('"main"');
    } else {
      warnings.push(`package.json: "main" is "${String(next.main)}", and Expo Svelte needs ".expo-svelte/entry.ts" (the generated entry); change it or run again with --force.`);
    }
  }
  const svelteSpec = dependencies.svelte ?? devDependencies.svelte;
  if (svelteSpec === void 0 || !(svelteSpec.startsWith("file:") || svelteSpec.startsWith("https://pkg.pr.new/svelte@"))) {
    setDependency("svelte", requiredSvelte.preview, "devDependencies");
    summary.push("svelte (the custom-renderer build)");
  }
  const hasKit = has2("@sveltejs/kit");
  const kitPatches = patches2.filter((patch) => patch.package === "@sveltejs/kit");
  let kitVersion;
  if (hasKit) {
    const installed = installedVersion(root2, "@sveltejs/kit");
    const wanted = exactVersion(dependencies["@sveltejs/kit"] ?? devDependencies["@sveltejs/kit"]);
    kitVersion = [installed, wanted].find((version) => version !== void 0 && kitPatches.some((patch) => patch.version === version)) ?? newestKitVersion(kitPatches);
    if (kitVersion !== void 0 && setDependency("@sveltejs/kit", kitVersion, "devDependencies")) summary.push(`@sveltejs/kit ${kitVersion} (exact: the library patches that version)`);
  }
  let changedPeers = 0;
  for (const [name, version] of Object.entries(appDependencies)) if (setDependency(name, version, "dependencies")) changedPeers++;
  if (changedPeers > 0) summary.push(`${plural(changedPeers, "dependency")} (the versions the library was exercised on)`);
  const listed = vendoredNames.filter(has2);
  if (listed.length > 0) warnings.push(`package.json: ${collisionMessage(listed)}`);
  const nextScripts = { ...manifest.scripts ?? {} };
  const addedScripts = [];
  for (const [name, command2] of Object.entries(scripts)) {
    const current = nextScripts[name];
    if (current === void 0) {
      nextScripts[name] = command2;
      addedScripts.push(name);
    } else if (current !== command2) {
      warnings.push(`package.json: the script "${name}" is "${current}", not "${command2}"; left as it is.`);
    }
  }
  if (addedScripts.length > 0) {
    next.scripts = nextScripts;
    summary.push(`scripts ${addedScripts.join(", ")}`);
  }
  next.dependencies = dependencies;
  if (Object.keys(devDependencies).length > 0 || manifest.devDependencies !== void 0) next.devDependencies = devDependencies;
  const ordered = {};
  for (const key of Object.keys(next)) {
    if (key === "dependencies") continue;
    if (key === "devDependencies") ordered.dependencies = dependencies;
    ordered[key] = next[key];
  }
  if (!("dependencies" in ordered)) ordered.dependencies = dependencies;
  const text3 = `${JSON.stringify(ordered, null, indentOf(original))}${original.endsWith("\n") ? "\n" : ""}`;
  return { text: text3, summary, warnings, kitVersion, hasKit, changed: text3 !== original, name: typeof manifest.name === "string" ? manifest.name : void 0 };
}
function mergeWorkspaceYaml(text3, blocks) {
  const crlf = text3.includes("\r\n");
  const lines = text3.replaceAll("\r\n", "\n").split("\n");
  if (lines.at(-1) === "") lines.pop();
  const changes = [];
  const manual = [];
  let separated = false;
  for (const [block2, wanted] of Object.entries(blocks)) {
    const start = lines.findIndex((line) => new RegExp(`^${block2}:\\s*(?:#.*)?$`).test(line));
    if (start < 0) {
      if (lines.some((line) => new RegExp(`^${block2}:\\s*\\S`).test(line))) {
        manual.push(`${block2}: ${Object.entries(wanted).map(([key, value]) => `${keyOf(key)}: ${value}`).join(", ")}`);
        continue;
      }
      if (!separated && lines.length > 0 && lines.at(-1) !== "") lines.push("");
      separated = true;
      lines.push(`${block2}:`, ...Object.entries(wanted).map(([key, value]) => `  ${keyOf(key)}: ${value}`));
      changes.push(`${block2}: ${Object.keys(wanted).join(", ")}`);
      continue;
    }
    let end = start + 1;
    while (end < lines.length && /^(?:\s+\S.*|\s*)$/.test(lines[end] ?? "")) end++;
    let last = end - 1;
    while (last > start && /^\s*$/.test(lines[last] ?? "")) last--;
    const existing = /* @__PURE__ */ new Map();
    let indent = "  ";
    for (let index = start + 1; index <= last; index++) {
      const entry = /^(\s+)(?:"([^"]+)"|'([^']+)'|([^\s:#]+))\s*:\s*(?:"([^"]*)"|'([^']*)'|([^\s#]+))?/.exec(lines[index] ?? "");
      if (entry) {
        indent = entry[1] ?? indent;
        existing.set(entry[2] ?? entry[3] ?? entry[4] ?? "", { index, value: entry[5] ?? entry[6] ?? entry[7] });
      }
    }
    const inserted = [];
    for (const [key, value] of Object.entries(wanted)) {
      const at = existing.get(key);
      const line = `${indent}${keyOf(key)}: ${value}`;
      if (at === void 0) {
        inserted.push(line);
        changes.push(`${block2}: ${key}`);
      } else if (at.value !== value) {
        lines[at.index] = line;
        changes.push(`${block2}: ${key} (was ${at.value ?? "empty"})`);
      }
    }
    lines.splice(last + 1, 0, ...inserted);
  }
  const merged = `${lines.join("\n")}
`;
  return { text: crlf ? merged.replaceAll("\n", "\r\n") : merged, changes, manual };
}
function closing(text3, open) {
  const pairs = { "(": ")", "[": "]", "{": "}" };
  const stack = [];
  for (let index = open; index < text3.length; index++) {
    const char = text3[index] ?? "";
    if (char === "/" && text3[index + 1] === "/") {
      index = text3.indexOf("\n", index);
      if (index < 0) return -1;
      continue;
    }
    if (char === "/" && text3[index + 1] === "*") {
      index = text3.indexOf("*/", index + 2);
      if (index < 0) return -1;
      index++;
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      for (index++; index < text3.length && text3[index] !== char; index++) if (text3[index] === "\\") index++;
      continue;
    }
    if (char in pairs) stack.push(pairs[char] ?? "");
    else if (char === ")" || char === "]" || char === "}") {
      if (stack.pop() !== char) return -1;
      if (stack.length === 0) return index;
    }
  }
  return -1;
}
function expoSvelteViteConfig(text3) {
  const quote = quoteOf(text3);
  const importLine = /import\s*\{\s*sveltekit\s*\}\s*from\s*['"]@sveltejs\/kit\/vite['"];?/;
  const callAt = /\bsveltekit\s*\(/.exec(text3.replace(importLine, (line) => " ".repeat(line.length)));
  if (!importLine.test(text3) || !callAt || !/\bdefineConfig\s*\(/.test(text3)) return void 0;
  const unit = /^\t/m.test(text3) ? "	" : "  ";
  const open = callAt.index + callAt[0].length - 1;
  const close = closing(text3, open);
  if (close < 0) return void 0;
  const args2 = text3.slice(open + 1, close);
  const lineStart = text3.lastIndexOf("\n", callAt.index) + 1;
  const indent = /^\s*/.exec(text3.slice(lineStart, callAt.index))?.[0] ?? "";
  const target = `target: mode === ${quote}native${quote} ? ${quote}native${quote} : ${quote}web${quote}`;
  const replacement = args2.trim() === "" ? `expoSvelte({ ${target} })` : `expoSvelte({
${indent}${unit}${target},
${indent}${unit}kit: ${args2.trim().replace(/\n(?=[^\n])/g, `
${unit}`)}
${indent}})`;
  let edited = `${text3.slice(0, callAt.index)}${replacement}${text3.slice(close + 1)}`;
  edited = edited.replace(importLine, `import { expoSvelte } from ${quote}expo-svelte/vite${quote};`);
  const define = /\bdefineConfig\s*\(/.exec(edited);
  if (!define) return void 0;
  const afterDefine = edited.slice(define.index + define[0].length);
  const defineOpen = define.index + define[0].length - 1;
  const firstArgument = /^\s*/.exec(afterDefine)?.[0].length ?? 0;
  if (afterDefine[firstArgument] === "{") {
    const braceAt = defineOpen + 1 + firstArgument;
    const braceClose = closing(edited, braceAt);
    if (braceClose < 0) return void 0;
    edited = `${edited.slice(0, braceAt)}({ mode }) => (${edited.slice(braceAt, braceClose + 1)})${edited.slice(braceClose + 1)}`;
  } else if (!/^\s*(?:async\s*)?\(\s*\{[^)]*\bmode\b[^)]*\}\s*\)\s*=>/.test(afterDefine)) {
    return void 0;
  }
  return edited;
}
function starterTheme(root2, manifest) {
  const own2 = read(join4(root2, "src/lib/theme.ts"));
  const name = own2 !== void 0 && !own2.includes("expo-svelte") ? "native-theme.ts" : "theme.ts";
  const path = `src/lib/${name}`;
  const imports = manifest.imports;
  const mapped = typeof imports === "object" && imports !== null && "#lib/*" in imports;
  return {
    path,
    exists: existsSync3(join4(root2, path)),
    from: (directory) => mapped ? `#lib/${name}` : relative3(directory, path).split("\\").join("/")
  };
}
function mobileRoutes(routes) {
  if (!existsSync3(routes)) return [];
  return readdirSync4(routes, { recursive: true, encoding: "utf8" }).filter((file) => /(^|[\\/])\+(?:mobile|layout\.mobile)\.svelte$/.test(file));
}
function planInit(root2, options = {}) {
  const plan = { root: root2, changes: [], warnings: [], problems: [] };
  const packageText = read(join4(root2, "package.json"));
  if (packageText === void 0) {
    plan.problems.push(`${root2} has no package.json: run \`expo-svelte init\` in the directory of your project (after \`npx sv create\`).`);
    return plan;
  }
  if (!existsSync3(join4(root2, "pnpm-lock.yaml")) && !existsSync3(join4(root2, "pnpm-workspace.yaml")) && (existsSync3(join4(root2, "package-lock.json")) || existsSync3(join4(root2, "yarn.lock")) || existsSync3(join4(root2, "bun.lock")) || existsSync3(join4(root2, "bun.lockb")))) {
    plan.problems.push("This project uses another package manager than pnpm. The library's patches are pnpm's (`patchedDependencies`): create the project with pnpm (`npx sv create`, then choose pnpm) or move it to pnpm first.");
    return plan;
  }
  let manifestText = packageText;
  const patches2 = patchFiles();
  let pkg;
  try {
    pkg = planPackageJson(root2, manifestText, patches2, options);
  } catch (error) {
    plan.problems.push(`package.json is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
    return plan;
  }
  manifestText = pkg.text;
  plan.warnings.push(...pkg.warnings);
  plan.changes.push(pkg.changed ? { path: "package.json", action: "edit", summary: pkg.summary.join(", "), text: pkg.text } : { path: "package.json", action: "keep", summary: "has everything" });
  const names = appNames(pkg.name, options);
  const manifest = JSON.parse(manifestText);
  const needed = [];
  for (const patch of patches2) {
    if (alwaysPatched.includes(patch.package)) needed.push(patch);
    else if (patch.package === "@sveltejs/kit" && pkg.hasKit && patch.version === pkg.kitVersion) needed.push(patch);
  }
  const workspacePath = join4(root2, "pnpm-workspace.yaml");
  const workspaceText = read(workspacePath);
  const overrides = {};
  const expoModules = patches2.find((patch) => patch.package === "expo-modules-core");
  if (expoModules) overrides["expo-modules-core"] = expoModules.version;
  const reactNative = appDependencies["react-native"];
  if (reactNative !== void 0) overrides["@react-native/metro-config"] = reactNative;
  const patched = Object.fromEntries(needed.map((patch) => [patchKey(patch), `patches/expo-svelte/${patch.file}`]));
  const merged = mergeWorkspaceYaml(workspaceText ?? "", { allowBuilds: { esbuild: "true" }, overrides, patchedDependencies: patched });
  if (merged.manual.length > 0) {
    plan.changes.push({
      path: "pnpm-workspace.yaml",
      action: "manual",
      summary: "a block is written in a style init does not edit",
      instructions: `Add these to pnpm-workspace.yaml:
${merged.manual.map((line) => `  ${line}`).join("\n")}`
    });
  } else if (merged.changes.length > 0) {
    plan.changes.push({ path: "pnpm-workspace.yaml", action: workspaceText === void 0 ? "create" : "edit", summary: merged.changes.join("; "), text: merged.text });
  } else plan.changes.push({ path: "pnpm-workspace.yaml", action: "keep", summary: "has everything" });
  if (workspaceText !== void 0) {
    for (const key of patchedKeys(workspaceText)) {
      const at = key.lastIndexOf("@");
      const same2 = needed.find((patch) => patch.package === key.slice(0, at) && patch.version !== key.slice(at + 1));
      if (same2) plan.warnings.push(`pnpm-workspace.yaml declares a patch for ${key}, and the library's is for ${same2.version}: remove the entry, or pnpm stops with ERR_PNPM_UNUSED_PATCH.`);
    }
  }
  const copied = [];
  const replaced = [];
  for (const patch of needed) {
    const target = join4(root2, "patches/expo-svelte", patch.file);
    const content = readFileSync3(patch.path);
    const current = existsSync3(target) ? readFileSync3(target) : void 0;
    if (current?.equals(content)) continue;
    plan.changes.push({ path: relative3(root2, target), action: current === void 0 ? "create" : "edit", summary: current === void 0 ? "the library's patch" : "differs from the installed library's copy: replaced", text: content });
    (current === void 0 ? copied : replaced).push(patch.file);
  }
  if (copied.length === 0 && replaced.length === 0) plan.changes.push({ path: "patches/expo-svelte", action: "keep", summary: `${plural(needed.length, "patch")} up to date` });
  const metroPath = join4(root2, "metro.config.cjs");
  const metroText = read(metroPath) ?? read(join4(root2, "metro.config.js"));
  if (metroText === void 0) plan.changes.push({ path: "metro.config.cjs", action: "create", summary: "withExpoSvelte(getDefaultConfig(__dirname))", text: metroConfig });
  else if (metroText.includes("withExpoSvelte")) plan.changes.push({ path: "metro.config.cjs", action: "keep", summary: "uses withExpoSvelte" });
  else plan.changes.push({ path: "metro.config.cjs", action: "manual", summary: "exists and does not use withExpoSvelte", instructions: `Wrap the config you export:
  const { withExpoSvelte } = require("expo-svelte/metro");
  module.exports = withExpoSvelte(<your config>);` });
  planAppJson(root2, names, plan);
  const viteName = ["vite.config.ts", "vite.config.js", "vite.config.mts", "vite.config.mjs"].find((file) => existsSync3(join4(root2, file)));
  if (pkg.hasKit && viteName === void 0) {
    plan.changes.push({ path: "vite.config.ts", action: "manual", summary: "none found", instructions: viteInstructions("vite.config.ts") });
  } else if (viteName !== void 0) {
    const viteText = read(join4(root2, viteName)) ?? "";
    if (viteText.includes("expoSvelte(")) plan.changes.push({ path: viteName, action: "keep", summary: "uses expoSvelte()" });
    else {
      const edited = expoSvelteViteConfig(viteText);
      if (edited !== void 0 && syntaxOk(edited, viteName)) plan.changes.push({ path: viteName, action: "edit", summary: "expoSvelte() around SvelteKit's plugin, as a function of the mode", text: edited });
      else plan.changes.push({ path: viteName, action: "manual", summary: "not in a shape init edits safely", instructions: viteInstructions(viteName, quoteOf(viteText)) });
    }
  }
  const routes = join4(root2, "src/routes");
  const existing = mobileRoutes(routes);
  const createLayout = !existing.some((file) => file === "+layout.mobile.svelte");
  const createScreens = !existing.some((file) => /\+mobile\.svelte$/.test(file) && !/layout\.mobile/.test(file));
  const theme = starterTheme(root2, manifest);
  if ((createLayout || createScreens) && !theme.exists) plan.changes.push({ path: theme.path, action: "create", summary: "light and dark colours for the native screens", text: themeModule });
  if (createLayout) plan.changes.push({ path: "src/routes/+layout.mobile.svelte", action: "create", summary: "the app shell", text: layoutRoute(theme.from("src/routes")) });
  else plan.changes.push({ path: "src/routes/+layout.mobile.svelte", action: "keep", summary: "exists" });
  if (createScreens) {
    plan.changes.push({ path: "src/routes/+mobile.svelte", action: "create", summary: "a home screen", text: homeRoute(names.title, theme.from("src/routes")) });
    plan.changes.push({ path: "src/routes/details/+mobile.svelte", action: "create", summary: "a second screen", text: detailsRoute(theme.from("src/routes/details")) });
  } else plan.changes.push({ path: "src/routes", action: "keep", summary: `${plural(existing.filter((file) => !/layout/.test(file)).length, "native screen")} already` });
  const ignorePath = join4(root2, ".gitignore");
  const ignoreText = read(ignorePath);
  const lines = new Set((ignoreText ?? "").split(/\r?\n/).map((line) => line.trim().replace(/^\//, "").replace(/\/$/, "")));
  const missing = gitignore.filter((line) => !lines.has(line.replace(/^\//, "")));
  if (missing.length > 0) {
    const base = ignoreText ?? "";
    plan.changes.push({ path: ".gitignore", action: ignoreText === void 0 ? "create" : "edit", summary: missing.join(", "), text: `${base}${base === "" || base.endsWith("\n") ? "" : "\n"}${base === "" ? "" : "\n"}# Expo Svelte
${missing.join("\n")}
` });
  } else plan.changes.push({ path: ".gitignore", action: "keep", summary: "has the generated folders" });
  return plan;
}
function patchedKeys(workspace) {
  const keys = [];
  let inside = false;
  for (const line of workspace.split(/\r?\n/)) {
    if (/^patchedDependencies:/.test(line)) {
      inside = true;
      continue;
    }
    if (!inside || /^\s*(#.*)?$/.test(line)) continue;
    if (/^\S/.test(line)) break;
    const key = /^\s+(?:"([^"]+)"|'([^']+)'|([^\s:#]+))\s*:/.exec(line);
    keys.push(key?.[1] ?? key?.[2] ?? key?.[3] ?? "");
  }
  return keys.filter((key) => key !== "");
}
function syntaxOk(source, file) {
  try {
    const esbuild = createRequire2(import.meta.url)("esbuild");
    esbuild.transformSync(source, { loader: file.endsWith("ts") ? "ts" : "js" });
    return true;
  } catch {
    return false;
  }
}
function planAppJson(root2, names, plan) {
  const path = join4(root2, "app.json");
  const text3 = read(path);
  const wanted = () => ({
    name: names.title,
    slug: names.slug,
    scheme: names.slug,
    version: "1.0.0",
    // The light and dark colours of `src/lib/theme.ts` follow the system's mode: Expo's default, `light`, would keep the app light on iOS (and, through the library's plugin, on
    // Android). Only an app.json made here says so; an app's own keeps its mode.
    userInterfaceStyle: "automatic",
    android: { package: names.androidPackage },
    ios: { bundleIdentifier: names.iosBundleId },
    plugins: [plugin]
  });
  if (text3 === void 0) {
    const config = ["app.config.ts", "app.config.js", "app.config.mjs", "app.config.cjs"].find((file) => existsSync3(join4(root2, file)));
    if (config !== void 0) {
      const configText = read(join4(root2, config)) ?? "";
      const names2 = [`"${removedPluginName}"`, `'${removedPluginName}'`, `\`${removedPluginName}\``].some((quoted) => configText.includes(quoted));
      const instructions = names2 ? `Replace "${removedPluginName}" in \`plugins\` in ${config} with "${plugin}" (that path no longer resolves and the package's name is the plugin's; keep its options):
  plugins: ["${plugin}"]
and give the app an \`android.package\` and \`ios.bundleIdentifier\`.` : `Add the library's plugin to \`plugins\` in ${config}:
  plugins: ["${plugin}"]
and give the app an \`android.package\` and \`ios.bundleIdentifier\`.`;
      plan.changes.push({ path: config, action: "manual", summary: "the app is configured in code", instructions });
      return;
    }
    plan.changes.push({ path: "app.json", action: "create", summary: `${names.title}, ${names.androidPackage}`, text: `${JSON.stringify({ expo: wanted() }, null, "	")}
` });
    return;
  }
  let json;
  try {
    json = JSON.parse(text3);
  } catch {
    plan.changes.push({ path: "app.json", action: "manual", summary: "is not valid JSON", instructions: `Add "${plugin}" to expo.plugins in app.json.` });
    return;
  }
  const expo2 = json.expo ?? json;
  const done = [];
  const configured = wanted();
  for (const key of ["name", "slug", "scheme", "version"]) {
    if (expo2[key] === void 0) {
      expo2[key] = configured[key];
      done.push(key);
    }
  }
  for (const [block2, key] of [["android", "package"], ["ios", "bundleIdentifier"]]) {
    const value = typeof expo2[block2] === "object" && expo2[block2] !== null ? expo2[block2] : {};
    if (value[key] === void 0) {
      expo2[block2] = { ...value, [key]: configured[block2][key] };
      done.push(`${block2}.${key}`);
    }
  }
  const listed = Array.isArray(expo2.plugins) ? expo2.plugins : [];
  const nameOf = (entry) => Array.isArray(entry) ? entry[0] : entry;
  const renamed = listed.some((entry) => nameOf(entry) === removedPluginName);
  const plugins = renamed ? listed.map((entry) => nameOf(entry) !== removedPluginName ? entry : Array.isArray(entry) ? [plugin, ...entry.slice(1)] : plugin) : listed;
  if (renamed) {
    expo2.plugins = plugins;
    done.push(`the plugin's name (${removedPluginName} no longer resolves)`);
  }
  const has2 = plugins.some((entry) => pluginNames.includes(nameOf(entry)));
  if (!has2) {
    expo2.plugins = [...plugins, plugin];
    done.push("the plugin");
  }
  if (done.length === 0) plan.changes.push({ path: "app.json", action: "keep", summary: "lists the plugin" });
  else plan.changes.push({ path: "app.json", action: "edit", summary: done.join(", "), text: `${JSON.stringify(json, null, indentOf(text3))}${text3.endsWith("\n") ? "\n" : ""}` });
}
function applyPlan(plan) {
  for (const change of plan.changes) {
    if (change.text === void 0 || change.action !== "create" && change.action !== "edit") continue;
    const file = join4(plan.root, change.path);
    mkdirSync2(dirname3(file), { recursive: true });
    writeFileSync2(file, change.text);
  }
}
function parseInitArguments(args2) {
  const options = {};
  for (let index = 0; index < args2.length; index++) {
    const arg = args2[index] ?? "";
    const value = () => {
      const next = args2[++index];
      if (next === void 0 || next.startsWith("--")) throw new Error(`${arg} needs a value`);
      return next;
    };
    try {
      if (arg === "--dry-run") options.dryRun = true;
      else if (arg === "--force") options.force = true;
      else if (arg === "--no-install") options.install = false;
      else if (arg === "--name") options.name = value();
      else if (arg === "--android-package") options.androidPackage = value();
      else if (arg === "--ios-bundle-id") options.iosBundleId = value();
      else if (arg === "--help" || arg === "-h") return USAGE;
      else return `Unknown option ${arg}.

${USAGE}`;
    } catch (error) {
      return `${error instanceof Error ? error.message : String(error)}.

${USAGE}`;
    }
  }
  return options;
}
function formatPlan(plan, dryRun) {
  const lines = [`expo-svelte init: ${plan.root}${dryRun ? " (dry run)" : ""}`, ""];
  const patchDirectory = "patches/expo-svelte/";
  const patches2 = plan.changes.filter((change) => change.path.startsWith(patchDirectory));
  const rows = [];
  for (const change of plan.changes) {
    if (!change.path.startsWith(patchDirectory)) rows.push(change);
    else if (change === patches2[0]) rows.push({ action: patches2.every((entry) => entry.action === "create") ? "create" : "edit", path: patchDirectory, summary: `${plural(patches2.length, "patch file")} from the installed library` });
  }
  const width = Math.max(...rows.map((row) => row.path.length), 10);
  for (const row of rows) lines.push(`  ${WORD[row.action]}  ${row.path.padEnd(width)}  ${row.summary}`);
  for (const change of plan.changes.filter((entry) => entry.action === "manual")) lines.push("", `${change.path}:`, ...(change.instructions ?? "").split("\n").map((line) => `  ${line}`));
  if (plan.warnings.length > 0) lines.push("", "warnings:", ...plan.warnings.map((warning) => `  ${warning}`));
  return lines.join("\n");
}
function runInit(root2, args2, io = processIo) {
  const options = parseInitArguments(args2);
  if (typeof options === "string") {
    (options.startsWith("Usage") ? io.out : io.err)(options.trimEnd());
    return options.startsWith("Usage") ? 0 : 2;
  }
  const plan = planInit(root2, options);
  if (plan.problems.length > 0) {
    for (const problem of plan.problems) io.err(`expo-svelte init: ${problem}`);
    return 1;
  }
  io.out(formatPlan(plan, options.dryRun === true));
  const manual = plan.changes.filter((change) => change.action === "manual").length;
  if (options.dryRun) {
    io.out("\nNothing was written (--dry-run).");
    return 0;
  }
  const written = plan.changes.filter((change) => change.action === "create" || change.action === "edit").length;
  applyPlan(plan);
  io.out(written === 0 ? "\nNothing to change: the project is already set up." : `
Wrote ${plural(written, "file")}.`);
  if (options.install === false) return manual > 0 ? 1 : 0;
  io.out("\n==> pnpm install");
  const install = spawnSync("pnpm", ["install", "--no-frozen-lockfile"], { cwd: root2, stdio: "inherit", shell: process.platform === "win32" });
  if (install.status !== 0) {
    io.err("expo-svelte init: pnpm install failed; fix what it says and run `pnpm install` and `pnpm exec expo-svelte doctor`.");
    return install.status ?? 1;
  }
  io.out("\n==> expo-svelte doctor");
  const doctor = spawnSync("pnpm", ["exec", "expo-svelte", "doctor"], { cwd: root2, stdio: "inherit", shell: process.platform === "win32" });
  if (doctor.status !== 0) return doctor.status ?? 1;
  io.out(`
Next: the first \`pnpm android\` (or \`pnpm ios\`, on a Mac) builds the native app, which takes a while; after that \`pnpm native\` starts the dev server for it.${manual > 0 ? `
First, the ${plural(manual, "change")} listed above for you to make.` : ""}`);
  return manual > 0 ? 1 : 0;
}
var appDependencies, alwaysPatched, plugin, pluginNames, removedPluginName, scripts, gitignore, read, plural, quoteOf, exactVersion, keyOf, viteInstructions, metroConfig, themeModule, layoutRoute, homeRoute, detailsRoute, USAGE, processIo, WORD;
var init_init_app = __esm({
  "src/init-app.ts"() {
    "use strict";
    init_patches();
    init_semver();
    init_svelte_build();
    init_vendored();
    appDependencies = {
      expo: "58.0.26",
      "expo-constants": "58.0.16",
      react: "19.3.0",
      "react-native": "0.88.1"
    };
    alwaysPatched = ["expo-modules-core"];
    plugin = "expo-svelte";
    pluginNames = [plugin, `${plugin}/app.plugin`];
    removedPluginName = `${plugin}/expo`;
    scripts = { native: "expo-svelte dev", android: "expo-svelte android", ios: "expo-svelte ios", "check-setup": "expo-svelte doctor" };
    gitignore = [".expo-svelte", ".expo", "/android", "/ios"];
    read = (file) => existsSync3(file) ? readFileSync3(file, "utf8") : void 0;
    plural = (count2, word) => `${count2} ${word.endsWith("y") ? count2 === 1 ? word : `${word.slice(0, -1)}ies` : count2 === 1 ? word : `${word}s`}`;
    quoteOf = (text3) => /from\s+"/.test(text3) ? '"' : "'";
    exactVersion = (spec) => spec !== void 0 && /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(spec) ? spec : void 0;
    keyOf = (key) => key.startsWith("@") || key.includes(":") ? `"${key}"` : key;
    viteInstructions = (file, quote = "'") => [
      `In ${file}: import { expoSvelte } from ${quote}expo-svelte/vite${quote}, make the config a function of the mode, and replace SvelteKit's plugin`,
      "with the library's, which wraps it and takes what you passed to sveltekit() as `kit`:",
      "",
      "  export default defineConfig(({ mode }) => ({",
      "    plugins: [expoSvelte({ target: mode === 'native' ? 'native' : 'web', kit: { /* what you passed to sveltekit() */ } })]",
      "  }));"
    ].join("\n");
    metroConfig = `const { getDefaultConfig } = require("expo/metro-config");
const { withExpoSvelte } = require("expo-svelte/metro");

module.exports = withExpoSvelte(getDefaultConfig(__dirname));
`;
    themeModule = `import { colorScheme } from 'expo-svelte';

// The colours of the native screens, in the system's light and dark mode. A template that reads \`theme.colors\` draws again when the
// user switches, because \`colorScheme.current\` is reactive.
const light = {
	background: '#f2f2f7',
	surface: '#ffffff',
	text: '#000000',
	secondaryText: '#6c6c70',
	accent: '#007aff',
	onAccent: '#ffffff'
};
const dark: typeof light = {
	background: '#000000',
	surface: '#1c1c1e',
	text: '#ffffff',
	secondaryText: '#98989f',
	accent: '#0a84ff',
	onAccent: '#ffffff'
};

export const theme = {
	get colors() {
		return colorScheme.current === 'dark' ? dark : light;
	}
};
`;
    layoutRoute = (theme) => `<script lang="ts">
	import type { Snippet } from 'svelte';
	import { Stack } from 'expo-svelte';
	import { theme } from '${theme}';

	let { children }: { children: Snippet } = $props();
</script>

<!--
	The app shell: children is the root navigator, a native stack of the screens under src/routes. The options of <Stack> are the
	defaults of every screen: an opaque background in the system's light or dark mode, so a pushed screen covers the one below it,
	and a status bar that follows the mode.
-->
<Stack statusBar={{ style: 'auto' }} style={{ backgroundColor: theme.colors.background }}>
	{@render children()}
</Stack>
`;
    homeRoute = (title, theme) => `<script lang="ts">
	import { Pressable, Screen, Text, View, useRouter } from 'expo-svelte';
	import { theme } from '${theme}';

	const router = useRouter();
	let taps = $state(0);
</script>

<Screen title=${JSON.stringify(title)} header={{ large: true }}>
	<View style={{ flex: 1, padding: 24, gap: 16, justifyContent: 'center' }}>
		<Text style={{ color: theme.colors.text, fontSize: 28, fontWeight: '700' }}>Expo Svelte</Text>
		<Text style={{ color: theme.colors.secondaryText, fontSize: 16 }}>Tapped {taps} {taps === 1 ? 'time' : 'times'}.</Text>
		<Pressable onPress={() => taps++} accessibilityRole="button" style={{ padding: 14, borderRadius: 12, backgroundColor: theme.colors.accent }}>
			<Text style={{ color: theme.colors.onAccent, fontSize: 16, fontWeight: '600' }}>Tap</Text>
		</Pressable>
		<Pressable onPress={() => router.goto('/details')} accessibilityRole="button" style={{ padding: 14, borderRadius: 12, backgroundColor: theme.colors.surface }}>
			<Text style={{ color: theme.colors.accent, fontSize: 16, fontWeight: '600' }}>Open details</Text>
		</Pressable>
	</View>
</Screen>
`;
    detailsRoute = (theme) => `<script lang="ts">
	import { Pressable, Screen, Text, View, useRouter } from 'expo-svelte';
	import { theme } from '${theme}';

	const router = useRouter();
</script>

<Screen title="Details">
	<View style={{ flex: 1, padding: 24, gap: 16, justifyContent: 'center' }}>
		<Text style={{ color: theme.colors.text, fontSize: 16 }}>A second screen, pushed onto the stack. The header's back button, the edge swipe and Android's back return to the home screen.</Text>
		<Pressable onPress={() => router.back()} accessibilityRole="button" style={{ padding: 14, borderRadius: 12, backgroundColor: theme.colors.surface }}>
			<Text style={{ color: theme.colors.accent, fontSize: 16, fontWeight: '600' }}>Back</Text>
		</Pressable>
	</View>
</Screen>
`;
    USAGE = `Usage: expo-svelte init [options]

Turns a SvelteKit project (npx sv create) into an Expo Svelte app, from the project's directory, after the library is installed in it. It adds the
dependencies, pnpm's settings and patches, the Metro and Expo config, the Vite plugin and a first native screen, then runs pnpm install and
\`expo-svelte doctor\`. Running it again changes nothing. A file it cannot change safely is left alone and the change is printed.

  --dry-run               print what it would do and write nothing
  --force                 replace a "main" or an entry the project has, where init would have written another
  --no-install            write the files; do not run pnpm install and the doctor
  --name <name>           the app's display name (default: the package name)
  --android-package <id>  the Android application id (default: dev.example.<package name>)
  --ios-bundle-id <id>    the iOS bundle identifier (default: the same)
`;
    processIo = { out: (text3) => process.stdout.write(`${text3}
`), err: (text3) => process.stderr.write(`${text3}
`) };
    WORD = { create: "create", edit: "edit  ", keep: "keep  ", manual: "YOU   " };
  }
});

// src/doctor/resolve.ts
import { existsSync as existsSync4, readdirSync as readdirSync5, readFileSync as readFileSync4, realpathSync as realpathSync2 } from "node:fs";
import { basename, dirname as dirname4, join as join5, resolve as resolve5 } from "node:path";
function readerFor(directory) {
  return {
    read(path) {
      try {
        return readFileSync4(join5(directory, path), "utf8");
      } catch {
        return void 0;
      }
    },
    list(path) {
      try {
        return readdirSync5(join5(directory, path));
      } catch {
        return [];
      }
    }
  };
}
function readJson2(file) {
  try {
    const parsed = JSON.parse(readFileSync4(file, "utf8"));
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed : void 0;
  } catch {
    return void 0;
  }
}
function findPackage(name, from) {
  for (let directory = resolve5(from); ; directory = dirname4(directory)) {
    const candidate = join5(basename(directory) === "node_modules" ? directory : join5(directory, "node_modules"), name);
    const json = readJson2(join5(candidate, "package.json"));
    if (json && typeof json.version === "string") return { name, version: json.version, directory: realpathSync2(candidate), json };
    if (dirname4(directory) === directory) return void 0;
  }
}
function findUp(file, from) {
  for (let directory = resolve5(from); ; directory = dirname4(directory)) {
    if (existsSync4(join5(directory, file))) return directory;
    if (dirname4(directory) === directory) return void 0;
  }
}
var init_resolve = __esm({
  "src/doctor/resolve.ts"() {
    "use strict";
  }
});

// src/doctor/declared.ts
import { readFileSync as readFileSync5 } from "node:fs";
import { dirname as dirname5, join as join6, resolve as resolve6 } from "node:path";
function patchedDependenciesOfYaml(text3) {
  const entries = /* @__PURE__ */ new Map();
  let inside = false;
  for (const line of text3.split(/\r?\n/)) {
    if (/^patchedDependencies:\s*(#.*)?$/.test(line)) {
      inside = true;
      continue;
    }
    if (!inside || /^\s*(#.*)?$/.test(line)) continue;
    if (/^\S/.test(line)) break;
    const entry = /^\s+(?:"([^"]+)"|'([^']+)'|([^\s:#]+))\s*:\s*(?:"([^"]+)"|'([^']+)'|([^\s#]+))/.exec(line);
    if (entry) entries.set(entry[1] ?? entry[2] ?? entry[3] ?? "", entry[4] ?? entry[5] ?? entry[6] ?? "");
  }
  return entries;
}
function declaredPatches(appRoot) {
  const declared = /* @__PURE__ */ new Map();
  const add = (entries, base, source) => {
    for (const [key, path] of entries) if (!declared.has(key)) declared.set(key, { path, file: resolve6(base, path), source });
  };
  const fromJson = (json) => {
    const pnpm = json?.pnpm;
    const patched = typeof pnpm === "object" && pnpm !== null ? pnpm.patchedDependencies : void 0;
    return typeof patched === "object" && patched !== null ? Object.entries(patched).filter((entry) => typeof entry[1] === "string") : [];
  };
  const workspace = findUp("pnpm-workspace.yaml", appRoot);
  if (workspace) {
    try {
      add(patchedDependenciesOfYaml(readFileSync5(join6(workspace, "pnpm-workspace.yaml"), "utf8")), workspace, "pnpm-workspace.yaml");
    } catch {
    }
  }
  const top = workspace ?? resolve6(appRoot);
  for (let directory = resolve6(appRoot); ; directory = dirname5(directory)) {
    add(fromJson(readJson2(join6(directory, "package.json"))), directory, "package.json");
    if (directory === top || dirname5(directory) === directory) break;
  }
  return declared;
}
var init_declared = __esm({
  "src/doctor/declared.ts"() {
    "use strict";
    init_resolve();
  }
});

// src/doctor/integration.ts
import { existsSync as existsSync5, readFileSync as readFileSync6 } from "node:fs";
import { join as join7 } from "node:path";
function withoutJsComments(text3) {
  return text3.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:\\])\/\/.*$/gm, "$1");
}
function metroFinding(appRoot) {
  const file = firstExisting(appRoot, METRO_FILES);
  if (!file) return { state: "no-file" };
  const code = withoutJsComments(readFileSync6(join7(appRoot, file), "utf8"));
  return { state: /\bwithExpoSvelte\b/.test(code) ? "found" : "unclear", file };
}
function expoPluginFinding(appRoot, library2) {
  const names = [library2, `${library2}/app.plugin`];
  const removed = `${library2}/expo`;
  const json = firstExisting(appRoot, ["app.json"]);
  const code = firstExisting(appRoot, APP_CONFIG_FILES);
  const parsed = json ? readJson2(join7(appRoot, json)) : void 0;
  const expo2 = parsed?.expo ?? parsed;
  const plugins = Array.isArray(expo2?.plugins) ? expo2.plugins : [];
  const listedInJson = (name) => plugins.some((entry) => pluginName(entry) === name);
  const source = code ? withoutJsComments(readFileSync6(join7(appRoot, code), "utf8")) : "";
  const namedInCode = (name) => ['"', "'", "`"].some((quote) => source.includes(`${quote}${name}${quote}`));
  if (json && listedInJson(removed)) return { state: "removed", file: json, name: removed };
  if (code && namedInCode(removed)) return { state: "removed", file: code, name: removed };
  const listed = json ? names.find(listedInJson) : void 0;
  if (listed) return { state: "found", file: json, name: listed };
  if (code) {
    const named = names.find(namedInCode);
    return named ? { state: "found", file: code, name: named } : { state: "unclear", file: code };
  }
  return json ? { state: "absent", file: json } : { state: "no-file" };
}
function appJson(appRoot, library2) {
  const file = firstExisting(appRoot, ["app.json"]);
  const parsed = file ? readJson2(join7(appRoot, file)) : void 0;
  if (!file || !parsed) return void 0;
  const expo2 = record(parsed.expo ?? parsed);
  const names = [library2, `${library2}/app.plugin`];
  const entry = (Array.isArray(expo2.plugins) ? expo2.plugins : []).find((candidate) => names.includes(pluginName(candidate) ?? ""));
  return { file, expo: expo2, plugin: entry === void 0 ? void 0 : record(Array.isArray(entry) ? entry[1] : void 0) };
}
var METRO_FILES, APP_CONFIG_FILES, firstExisting, pluginName, record, codeConfig;
var init_integration = __esm({
  "src/doctor/integration.ts"() {
    "use strict";
    init_resolve();
    METRO_FILES = ["metro.config.js", "metro.config.cjs", "metro.config.mjs", "metro.config.ts", "metro.config.mts", "metro.config.cts"];
    APP_CONFIG_FILES = ["app.config.ts", "app.config.js", "app.config.cjs", "app.config.mjs", "app.config.mts", "app.config.cts"];
    firstExisting = (root2, names) => names.find((name) => existsSync5(join7(root2, name)));
    pluginName = (entry) => typeof entry === "string" ? entry : Array.isArray(entry) && typeof entry[0] === "string" ? entry[0] : void 0;
    record = (value) => typeof value === "object" && value !== null && !Array.isArray(value) ? value : {};
    codeConfig = (appRoot) => firstExisting(appRoot, APP_CONFIG_FILES);
  }
});

// src/doctor/hunks.ts
function parsePatch(text3) {
  const lines = text3.replace(/\r\n/g, "\n").split("\n");
  const files = [];
  let current;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index] ?? "";
    if (line.startsWith("diff --git ")) {
      current = { path: (/ b\/(.+)$/.exec(line)?.[1] ?? "").trim(), created: false, removed: false, hunks: [] };
      files.push(current);
    } else if (current && line.startsWith("new file mode")) {
      current.created = true;
    } else if (current && line.startsWith("deleted file mode")) {
      current.removed = true;
    } else if (current && line.startsWith("@@")) {
      const header = /^@@ -\d+(?:,(\d+))? \+\d+(?:,(\d+))? @@/.exec(line);
      let before = Number(header?.[1] ?? 1);
      let after = Number(header?.[2] ?? 1);
      const hunk = { before: [], after: [] };
      while ((before > 0 || after > 0) && index + 1 < lines.length) {
        const body = lines[++index] ?? "";
        const mark = body[0] ?? " ";
        if (mark === "\\") continue;
        if (mark === " " || body === "") {
          hunk.before.push(body.slice(1));
          hunk.after.push(body.slice(1));
          before--;
          after--;
        } else if (mark === "+") {
          hunk.after.push(body.slice(1));
          after--;
        } else if (mark === "-") {
          hunk.before.push(body.slice(1));
          before--;
        } else throw new Error(`patch line ${index + 1} is not part of a hunk: ${body}`);
      }
      current.hunks.push(hunk);
    }
  }
  return files;
}
function indexOfBlock(haystack, block2) {
  if (block2.length === 0) return 0;
  for (let start = haystack.indexOf(block2[0] ?? ""); start >= 0 && start + block2.length <= haystack.length; start = haystack.indexOf(block2[0] ?? "", start + 1)) {
    if (block2.every((line, offset) => haystack[start + offset] === line)) return start;
  }
  return -1;
}
function missingFromPackage(patch, installed) {
  const missing = [];
  for (const file of parsePatch(patch)) {
    const text3 = installed.read(file.path);
    if (file.removed) {
      if (text3 !== void 0) missing.push(`${file.path} should be gone`);
      continue;
    }
    if (text3 === void 0) {
      missing.push(`${file.path} is not there`);
      continue;
    }
    const lines = text3.replace(/\r\n/g, "\n").split("\n");
    file.hunks.forEach((hunk, index) => {
      if (indexOfBlock(lines, hunk.after) < 0) missing.push(`${file.path}: hunk ${index + 1} of ${file.hunks.length} of the patch is not in the installed file`);
    });
  }
  return missing;
}
var init_hunks = __esm({
  "src/doctor/hunks.ts"() {
    "use strict";
  }
});

// src/push/common.ts
function failure(reason, detail, status, retryAfter) {
  return { ok: false, reason, ...status !== void 0 ? { status } : {}, ...retryAfter !== void 0 ? { retryAfter } : {}, detail };
}
function retryAfterOf(value) {
  const header = (Array.isArray(value) ? value[0] : value)?.trim();
  if (header === void 0 || header === "") return void 0;
  if (/^\d+$/.test(header)) return Number(header) * 1e3;
  const date = Date.parse(header);
  return Number.isNaN(date) ? void 0 : Math.max(0, date - Date.now());
}
function describeNetworkError(error) {
  if (!(error instanceof Error)) return withoutSecrets(String(error));
  const cause = error.cause instanceof Error ? error.cause.message : void 0;
  return withoutSecrets(cause === void 0 || cause === error.message ? error.message : `${error.message} (${cause})`);
}
function hostOf(url) {
  try {
    return new URL(url).host || "the endpoint";
  } catch {
    return "the endpoint";
  }
}
function parseJson(text3) {
  if (text3 === "") return void 0;
  try {
    return JSON.parse(text3);
  } catch {
    return void 0;
  }
}
function httpUrl(value, name) {
  let url;
  try {
    url = new URL(String(value));
  } catch {
    throw new TypeError(`${name} must be an http or https URL, not ${JSON.stringify(value)}.`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new TypeError(`${name} must be an http or https URL, not ${JSON.stringify(value)}.`);
  return url.href.replace(/\/+$/, "");
}
var withoutSecrets, isRecord;
var init_common = __esm({
  "src/push/common.ts"() {
    "use strict";
    withoutSecrets = (text3) => text3.replace(/\b([a-z][a-z\d+.-]*:\/\/)[^\s"'<>]+/gi, (url, scheme) => `${scheme}${hostOf(url)}`);
    isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
  }
});

// src/push/config.ts
function findPushSecret(value, where) {
  if (typeof value === "string") {
    if (serviceAccountJson.test(value)) return { where, what: "a service account key" };
    if (pemKey.test(value)) return { where, what: "a PEM private key" };
    if (/\.p8$/i.test(value.trim())) return { where, what: "the path of a .p8 file (an APNs key)" };
    return void 0;
  }
  if (typeof value !== "object" || value === null) return void 0;
  for (const [key, item] of Object.entries(value)) {
    const at = Array.isArray(value) ? `${where}[${key}]` : `${where}.${key}`;
    if (privateKeyName.test(key)) return { where: at, what: "a private key" };
    if (key === "type" && item === "service_account") return { where, what: "a service account key" };
    const found = findPushSecret(item, at);
    if (found) return found;
  }
  return void 0;
}
function googleServicesPackages(parsed) {
  const clients = parsed?.client;
  if (!Array.isArray(clients)) return [];
  return clients.flatMap((client) => {
    const name = client?.client_info?.android_client_info?.package_name;
    return typeof name === "string" ? [name] : [];
  });
}
function section(value, where, example) {
  if (!isRecord(value)) return refuse(`${where} takes an object: ${example}`);
  return value;
}
function optionalText(value, where) {
  if (value === void 0) return void 0;
  if (typeof value !== "string" || value.trim() === "") return refuse(`${where} must be a text that is not empty.`);
  return value;
}
function readIos(value) {
  const ios = section(value, "capabilities.push.ios", '`ios: { mode: "production" }`');
  if (ios.mode !== "development" && ios.mode !== "production")
    return refuse(
      'capabilities.push.ios.mode must be "development" or "production": it is the aps-environment entitlement, "development" for a build signed for development and "production" for TestFlight and the App Store.'
    );
  return { mode: ios.mode };
}
function readAndroid(value) {
  const android = section(value, "capabilities.push.android", '`android: { googleServicesFile: "./google-services.json" }`');
  const file = android.googleServicesFile;
  if (typeof file !== "string" || file.trim() === "")
    return refuse(
      'capabilities.push.android needs googleServicesFile, the path of the Firebase project\'s google-services.json (Firebase console, Project settings, your Android app): `android: { googleServicesFile: "./google-services.json" }`. Leave `android` out for an app that has no push on Android.'
    );
  const settings = { googleServicesFile: file };
  const icon = optionalText(android.icon, "capabilities.push.android.icon");
  if (icon !== void 0) {
    if (!/\.png$/i.test(icon)) return refuse(`capabilities.push.android.icon ("${icon}") must be a PNG file: the notification's small icon, white on a transparent background.`);
    settings.icon = icon;
  }
  const color = optionalText(android.color, "capabilities.push.android.color");
  if (color !== void 0) {
    if (!/^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(color)) return refuse(`capabilities.push.android.color ("${color}") must be a hex color such as "#0a7f5a": the notification's accent color.`);
    settings.color = color;
  }
  if (android.channel !== void 0) {
    const channel = section(android.channel, "capabilities.push.android.channel", '`channel: { name: "Updates" }`');
    if (typeof channel.name !== "string" || channel.name.trim() === "")
      return refuse('capabilities.push.android.channel needs a name, as the user will read it in the app\'s notification settings: `channel: { name: "Updates" }`.');
    const id = optionalText(channel.id, "capabilities.push.android.channel.id");
    const description = optionalText(channel.description, "capabilities.push.android.channel.description");
    settings.channel = { ...id === void 0 ? {} : { id }, name: channel.name, ...description === void 0 ? {} : { description } };
  }
  return settings;
}
function checkPushConfig(push) {
  try {
    const platforms = section(push, "capabilities.push", '`push: { android: { googleServicesFile: "./google-services.json" }, ios: { mode: "production" } }`, or `push: false`');
    if (platforms.android === void 0 && platforms.ios === void 0)
      return refuse(
        "capabilities.push names no platform: give `android` (its google-services.json), `ios` (its aps-environment mode) or both, or turn the capability off with `push: false`."
      );
    const config = {};
    if (platforms.android !== void 0) config.android = readAndroid(platforms.android);
    if (platforms.ios !== void 0) config.ios = readIos(platforms.ios);
    return { config };
  } catch (error) {
    if (error instanceof Refusal) return { problem: error.message };
    throw error;
  }
}
var otherPushLibraries, apsEnvironmentEntitlement, remoteNotificationMode, pemKey, serviceAccountJson, privateKeyName, pushSecretMessage, Refusal, refuse, pushIsOn;
var init_config = __esm({
  "src/push/config.ts"() {
    "use strict";
    init_common();
    otherPushLibraries = ["expo-notifications", "@react-native-firebase/messaging"];
    apsEnvironmentEntitlement = "aps-environment";
    remoteNotificationMode = "remote-notification";
    pemKey = /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/;
    serviceAccountJson = /"type"\s*:\s*"service_account"|"private_key"\s*:/;
    privateKeyName = /^private[_-]?key$/i;
    pushSecretMessage = ({ where, what }) => `${where} is ${what}: a key that can send to every user must never be in the app or its build. Keep it in the server's environment (the FCM service account, the APNs .p8 with its key id and team id) and give the app identifiers only.`;
    Refusal = class extends Error {
    };
    refuse = (message) => {
      throw new Refusal(message);
    };
    pushIsOn = (push) => push !== void 0 && push !== null && push !== false;
  }
});

// src/doctor/push.ts
import { join as join8 } from "node:path";
function plistString(plist, key) {
  return new RegExp(`<key>${key}</key>\\s*<string>([^<]*)</string>`).exec(plist)?.[1];
}
function plistStrings(plist, key) {
  const array = new RegExp(`<key>${key}</key>\\s*<array>([\\s\\S]*?)</array>`).exec(plist)?.[1];
  return array === void 0 ? void 0 : [...array.matchAll(/<string>([^<]*)<\/string>/g)].map((match) => match[1] ?? "");
}
function readConfig(context, library2) {
  const json = appJson(context.appRoot, library2);
  const code = codeConfig(context.appRoot);
  if (!json) return { config: void 0, code };
  const capabilities = record(json.plugin?.capabilities);
  const push = pushIsOn(capabilities.push) ? record(capabilities.push) : void 0;
  const android = record(json.expo.android);
  return { config: { file: json.file, push, value: capabilities.push, androidPackage: text(android.package), googleServicesFile: text(android.googleServicesFile), conclusive: code === void 0 }, code };
}
function otherLibraries(context, dependencies) {
  const found = otherPushLibraries.filter((name) => name in dependencies || findPackage(name, context.appRoot) !== void 0);
  if (found.length === 0) return [{ group, status: "pass", message: `no other push library (${otherPushLibraries.join(", ")}) is installed` }];
  return found.map((name) => ({
    group,
    status: "fail",
    message: `${name} is installed and capabilities.push is on: an app has one push library (Android delivers a message to one FirebaseMessagingService, iOS has one notification center delegate), and the config plugin refuses the build`,
    fix: `pnpm remove ${name}, or turn capabilities.push off and use ${name} for push (the guide's "Push notifications" page sets up each)`
  }));
}
function capabilityCheck(config) {
  if (!config) return [];
  if (config.push) {
    const secret = findPushSecret(config.value, "capabilities.push");
    if (secret) {
      return [{
        group,
        status: "fail",
        message: `${config.file} turns capabilities.push on, and the config plugin refuses it: ${pushSecretMessage(secret)}`,
        fix: "take it out of the config (and out of the repository's history), revoke the key if it was ever committed, and give it to the server's environment (FCM_SERVICE_ACCOUNT, APNS_KEY, APNS_KEY_ID, APNS_TEAM_ID); the app's config holds identifiers only"
      }];
    }
    const checked = checkPushConfig(config.value);
    if ("problem" in checked) {
      const code = config.conclusive ? "" : ", unless the app's config code changes it";
      return [{
        group,
        status: config.conclusive ? "fail" : "unknown",
        message: `${config.file} turns capabilities.push on, and the config plugin refuses it${code}: ${checked.problem}`,
        fix: `change capabilities.push in ${config.file} as the message says (PUSH.md, "The config"), or turn it off with \`push: false\``
      }];
    }
    const platforms = ["android", "ios"].filter((name) => config.push?.[name] !== void 0);
    return [{ group, status: "pass", message: `${config.file} turns capabilities.push on (${platforms.join(", ")})` }];
  }
  return [];
}
function gradleApplicationId(reader) {
  for (const file of ["android/app/build.gradle", "android/app/build.gradle.kts"]) {
    const gradle = reader.read(file);
    const id = gradle === void 0 ? void 0 : /^\s*applicationId\s*=?\s*["']([^"']+)["']/m.exec(gradle)?.[1];
    if (id) return id;
  }
  return void 0;
}
function locateGoogleServices(config, reader) {
  const named = text(record(config?.push?.android).googleServicesFile) ?? config?.googleServicesFile;
  if (named !== void 0) return named.replace(/^\.\//, "");
  const inRoot = reader.list(".").filter((name) => /^google-services.*\.json$/.test(name)).sort((a, b) => a === "google-services.json" ? -1 : b === "google-services.json" ? 1 : a.localeCompare(b));
  if (inRoot[0] !== void 0) return inRoot[0];
  return reader.read("android/app/google-services.json") === void 0 ? void 0 : "android/app/google-services.json";
}
function androidChecks(context, config, code, reader) {
  if (config?.conclusive) {
    if (!config.push) return [];
    if (!config.push.android) return [{ group, status: "skip", message: `${config.file} has no capabilities.push.android: no Google services file to check` }];
  }
  const file = locateGoogleServices(config, reader);
  if (file === void 0) {
    return [{
      group,
      status: "unknown",
      message: `could not find the Google services file: ${code ?? "the app's config"} is code that the doctor does not run, and the app's directory has no google-services*.json`,
      fix: `keep google-services.json in the app's directory, or name it in app.json (capabilities.push.android.googleServicesFile); ${FIREBASE_FIX}`
    }];
  }
  const contents = reader.read(file);
  if (contents === void 0) {
    return [{ group, status: "fail", message: `${file} does not exist (${join8(context.appRoot, file)}), and ${config?.file ?? "the app's config"} names it as the Google services file`, fix: FIREBASE_FIX }];
  }
  const secret = findPushSecret(contents, file);
  if (secret) {
    return [{
      group,
      status: "fail",
      message: `${file} holds ${secret.what}, which is a server secret: a key that can send to every user must never be in the app or its build, and the config plugin refuses it`,
      fix: `delete it from the app (and from the repository's history, and from any build that carried it) and revoke the key in the Google Cloud console (IAM and admin, Service accounts, Keys); create a new one for the server's environment (FCM_SERVICE_ACCOUNT). The app needs the other file, which holds identifiers only: ${FIREBASE_FIX}`
    }];
  }
  let parsed;
  try {
    parsed = JSON.parse(contents);
  } catch {
    return [{ group, status: "fail", message: `${file} is not JSON`, fix: `download google-services.json from the Firebase console again (Project settings, your Android app)` }];
  }
  const project = text(record(record(parsed).project_info).project_id);
  const checks = [{ group, status: "pass", message: `${file} is JSON and holds no server secret${project ? ` (Firebase project ${project})` : ""}` }];
  const clients = googleServicesPackages(parsed);
  const appPackage = config?.androidPackage ?? gradleApplicationId(reader);
  if (appPackage === void 0) {
    checks.push({
      group,
      status: "unknown",
      message: `could not tell the app's Android package to look for its client in ${file} (${config ? `${config.file} has no android.package` : "the config is code"}, and android/ has no build.gradle yet)`,
      fix: `set android.package in app.json, or run npx expo prebuild; the file has ${clients.length === 0 ? "no Android client" : clients.map((name) => `"${name}"`).join(", ")}`
    });
  } else if (clients.includes(appPackage)) {
    checks.push({ group, status: "pass", message: `${file} has a client for the app's package "${appPackage}"` });
  } else {
    checks.push({
      group,
      status: "fail",
      message: `${file} has no client for the app's package "${appPackage}" (${clients.length === 0 ? "it has no Android client" : `it has ${clients.map((name) => `"${name}"`).join(", ")}`}): Firebase would not deliver to this app`,
      fix: "add an Android app with that package to the Firebase project and download google-services.json again, or fix android.package"
    });
  }
  return checks;
}
function iosAppDirectory(reader) {
  const entries = reader.list("ios");
  const project = entries.find((name) => name.endsWith(".xcodeproj"));
  if (project !== void 0) return project.slice(0, -".xcodeproj".length);
  const candidates = entries.filter((name) => !/^(Pods|build)$|\.(xcodeproj|xcworkspace)$|^\./.test(name) && reader.read(`ios/${name}/Info.plist`) !== void 0);
  return candidates.length === 1 ? candidates[0] : void 0;
}
function iosChecks(config, reader) {
  if (config?.conclusive) {
    if (!config.push) return [];
    if (!config.push.ios) return [{ group, status: "skip", message: `${config.file} has no capabilities.push.ios: no entitlement or background mode to check` }];
  }
  if (reader.list("ios").length === 0) {
    return [{ group, status: "skip", message: "no ios/ directory yet: the aps-environment entitlement and the remote-notification background mode are written by `expo prebuild`, which has not run" }];
  }
  const directory = iosAppDirectory(reader);
  const fix = "npx expo prebuild --platform ios (with capabilities.push.ios set), so that the entitlement and the background mode are written";
  if (directory === void 0) {
    return [{ group, status: "unknown", message: "could not find the iOS app in ios/ (no <name>.xcodeproj, and not one directory with an Info.plist): the entitlement and the background mode were not checked", fix: "run npx expo prebuild --platform ios" }];
  }
  const checks = [];
  const base = `ios/${directory}`;
  const entitlementsFile = reader.list(base).find((name) => name.endsWith(".entitlements"));
  const entitlements = entitlementsFile === void 0 ? void 0 : reader.read(`${base}/${entitlementsFile}`);
  if (entitlements === void 0) {
    checks.push({ group, status: "fail", message: `${base} has no .entitlements file: the Push Notifications capability (aps-environment) was not written by the last prebuild`, fix });
  } else {
    const environment2 = plistString(entitlements, apsEnvironmentEntitlement);
    const wanted = text(record(config?.push?.ios).mode);
    if (environment2 === void 0) {
      checks.push({ group, status: "fail", message: `${base}/${entitlementsFile} has no ${apsEnvironmentEntitlement}: the app cannot register with APNs`, fix });
    } else if (wanted !== void 0 && wanted !== environment2) {
      checks.push({ group, status: "fail", message: `${base}/${entitlementsFile} has ${apsEnvironmentEntitlement} ${environment2}, and capabilities.push.ios.mode is ${wanted}: the last prebuild is older than the config`, fix });
    } else {
      checks.push({ group, status: "pass", message: `${base}/${entitlementsFile} has ${apsEnvironmentEntitlement} ${environment2}` });
    }
  }
  const infoPlist = reader.read(`${base}/Info.plist`);
  if (infoPlist === void 0) {
    checks.push({ group, status: "unknown", message: `could not read ${base}/Info.plist: the background modes were not checked`, fix: "run npx expo prebuild --platform ios" });
  } else if (infoPlist.startsWith("bplist")) {
    checks.push({ group, status: "unknown", message: `${base}/Info.plist is a binary plist: the background modes were not checked` });
  } else if (plistStrings(infoPlist, "UIBackgroundModes")?.includes(remoteNotificationMode)) {
    checks.push({ group, status: "pass", message: `${base}/Info.plist lists ${remoteNotificationMode} in UIBackgroundModes` });
  } else {
    checks.push({ group, status: "fail", message: `${base}/Info.plist does not list ${remoteNotificationMode} in UIBackgroundModes: a silent push would not wake the app`, fix });
  }
  return checks;
}
function prebuiltPush(reader) {
  const manifest = reader.read("android/app/src/main/AndroidManifest.xml");
  const directory = iosAppDirectory(reader);
  const infoPlist = directory === void 0 ? void 0 : reader.read(`ios/${directory}/Info.plist`);
  return {
    android: manifest === void 0 ? void 0 : new RegExp(`android:name="${ANDROID_PUSH_FLAG.replaceAll(".", "\\.")}"\\s+android:value="true"`).test(manifest),
    ios: infoPlist === void 0 ? void 0 : new RegExp(`<key>${IOS_PUSH_FLAG}</key>\\s*<true/>`).test(infoPlist)
  };
}
function prebuildChecks(config, prebuilt) {
  if (!config?.push) return [];
  const checks = [];
  for (const platform of ["android", "ios"]) {
    if (config.push[platform] === void 0 || prebuilt[platform] === void 0) continue;
    const where = platform === "android" ? `android/app/src/main/AndroidManifest.xml (${ANDROID_PUSH_FLAG})` : `ios/…/Info.plist (${IOS_PUSH_FLAG})`;
    checks.push(prebuilt[platform] ? { group, status: "pass", message: `the last prebuild turned push on for ${platform}: ${where}` } : { group, status: "fail", message: `capabilities.push names ${platform}, and the last prebuild did not turn push on there (no ${where}): the prebuild is older than the config`, fix: `npx expo prebuild --platform ${platform}, then build the app again` });
  }
  return checks;
}
function pushChecks(context, library2, appPackage) {
  const dependencies = { ...record(appPackage.dependencies), ...record(appPackage.devDependencies), ...record(appPackage.optionalDependencies) };
  const { config, code } = readConfig(context, library2.name);
  const reader = readerFor(context.appRoot);
  const prebuilt = prebuiltPush(reader);
  const inPlay = config?.push !== void 0 || config?.conclusive !== true && (prebuilt.android === true || prebuilt.ios === true);
  if (!inPlay) return [];
  return [
    ...otherLibraries(context, dependencies),
    ...capabilityCheck(config),
    ...androidChecks(context, config, code, reader),
    ...iosChecks(config, reader),
    ...prebuildChecks(config, prebuilt)
  ];
}
var ANDROID_PUSH_FLAG, IOS_PUSH_FLAG, group, text, FIREBASE_FIX;
var init_push = __esm({
  "src/doctor/push.ts"() {
    "use strict";
    init_config();
    init_integration();
    init_resolve();
    ANDROID_PUSH_FLAG = "expo.modules.sveltepush.enabled";
    IOS_PUSH_FLAG = "SveltePushEnabled";
    group = "push";
    text = (value) => typeof value === "string" && value !== "" ? value : void 0;
    FIREBASE_FIX = "download google-services.json from the Firebase console (Project settings, your Android app) and save it in the app's directory, then name it in capabilities.push.android.googleServicesFile";
  }
});

// src/doctor/requirements.ts
var requirements, nodeAdvice;
var init_requirements = __esm({
  "src/doctor/requirements.ts"() {
    "use strict";
    requirements = {
      node: {
        repository: ">=25.0.0",
        app: "^22.17.0 || ^24.3.0 || >=26.0.0"
      },
      pnpm: ">=12.3.4"
    };
    nodeAdvice = {
      repository: "install Node 25.0.0 or newer (the repository pins 25.0.0) and put it on the PATH",
      app: "install Node 24 LTS (24.3 or newer; Node 22.17 or newer and Node 26 or newer work too) and put it on the PATH. Node 25 is not supported: a fresh install takes @react-native/metro-config 0.88, whose tools exclude it, and pnpm stops with ERR_PNPM_UNSUPPORTED_ENGINE (docs/60-appendix/20-troubleshooting.md)"
    };
  }
});

// src/libraries.ts
import { createRequire as createRequire3 } from "node:module";
function checkLibraries(option) {
  if (option === void 0 || option === null) return { listed: /* @__PURE__ */ new Map(), enabled: [] };
  if (!isObject(option)) throw new LibrariesConfigError('`libraries` takes an object of library names: `libraries: { "react-native-maps": true }`');
  const listed = /* @__PURE__ */ new Map();
  for (const [name, value] of Object.entries(option)) {
    const vendored2 = vendoredPackage(name);
    if (vendored2?.optional === void 0) {
      const always = vendored2 !== void 0 ? ` ${name} is in every app: there is nothing to turn on.` : "";
      throw new LibrariesConfigError(`\`libraries\` names "${name}", which is not one of the optional libraries expo-svelte carries.${always} The libraries: ${libraryNames.join(", ")}.`);
    }
    if (value === false) continue;
    if (value === true) {
      listed.set(name, void 0);
      continue;
    }
    if (!isObject(value)) throw new LibrariesConfigError(`libraries["${name}"] is \`true\`, \`false\` or the options of ${name}'s config plugin (an object), not ${JSON.stringify(value) ?? String(value)}`);
    if (vendored2.optional.plugin === void 0 && Object.keys(value).length > 0) {
      throw new LibrariesConfigError(`libraries["${name}"] has options (${Object.keys(value).join(", ")}), and ${name} has no config plugin to give them to: write \`libraries: { "${name}": true }\``);
    }
    listed.set(name, value);
  }
  const wanted = withRequired(listed.keys());
  return { listed, enabled: libraryNames.filter((name) => wanted.includes(name)) };
}
function isLibraryPlugin(entry) {
  if (typeof entry !== "string") return false;
  if (PLUGIN_NAMES.has(entry)) return true;
  const path = entry.replace(/\\/g, "/").replace(/\/$/, "").replace(/\.js$/, "");
  return [...PLUGIN_NAMES].some((name) => path.endsWith(`/node_modules/${name}`));
}
function appPluginOptions(projectRoot, from = import.meta.url) {
  let plugins;
  try {
    const { getConfig } = createRequire3(from)("expo/config");
    plugins = getConfig(projectRoot, { skipSDKVersionRequirement: true }).exp.plugins;
  } catch (error) {
    return { unknown: `could not read the app's config: ${error instanceof Error ? error.message : String(error)}`, error };
  }
  const entry = (Array.isArray(plugins) ? plugins : []).find((plugin2) => isLibraryPlugin(Array.isArray(plugin2) ? plugin2[0] : plugin2));
  if (entry === void 0) return { unknown: "no entry of the app's `plugins` names expo-svelte" };
  const options = Array.isArray(entry) ? entry[1] : void 0;
  return { options: isObject(options) ? options : void 0 };
}
var LibrariesConfigError, libraryNames, isObject, PLUGIN_NAMES;
var init_libraries = __esm({
  "src/libraries.ts"() {
    "use strict";
    init_config();
    init_vendored();
    LibrariesConfigError = class extends Error {
      name = "LibrariesConfigError";
    };
    libraryNames = optionalPackages.map((vendored2) => vendored2.name);
    isObject = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
    PLUGIN_NAMES = /* @__PURE__ */ new Set(["expo-svelte", "expo-svelte/app.plugin", "expo-svelte/expo"]);
  }
});

// src/doctor/checks.ts
import { existsSync as existsSync6, readFileSync as readFileSync7 } from "node:fs";
import { join as join9 } from "node:path";
function environment(context) {
  const checks = [];
  const scope = context.repository ? "repository" : "app";
  const range = requirements.node[scope];
  if (context.node === void 0) {
    checks.push({ group: "environment", status: "unknown", message: `could not run node (needs ${range})`, fix: nodeAdvice[scope] });
  } else {
    const ok = satisfies(context.node, range);
    checks.push(ok ? { group: "environment", status: "pass", message: `node ${context.node} (needs ${range})` } : { group: "environment", status: "fail", message: `node ${context.node} does not satisfy ${range}`, fix: nodeAdvice[scope] });
  }
  const pnpm = context.pnpm();
  if (pnpm === void 0) {
    checks.push({ group: "environment", status: "unknown", message: `could not run pnpm (needs ${requirements.pnpm})`, fix: `install pnpm ${requirements.pnpm.slice(2)} or newer (corepack enable pnpm); the patches are applied by pnpm` });
  } else if (satisfies(pnpm, requirements.pnpm)) {
    checks.push({ group: "environment", status: "pass", message: `pnpm ${pnpm} (needs ${requirements.pnpm})` });
  } else {
    checks.push({ group: "environment", status: "fail", message: `pnpm ${pnpm} does not satisfy ${requirements.pnpm}`, fix: `use pnpm ${requirements.pnpm.slice(2)} or newer (corepack use pnpm@${requirements.pnpm.slice(2)})` });
  }
  return checks;
}
function library(context, name, version, appPackage) {
  const dependencies = { ...record(appPackage.dependencies), ...record(appPackage.devDependencies), ...record(appPackage.optionalDependencies) };
  return name in dependencies ? { group: "build integration", status: "pass", message: `${name} ${version} is a dependency of the app` } : { group: "build integration", status: "fail", message: `${name} is not a dependency of the app (${join9(context.appRoot, "package.json")})`, fix: `add it to the app's dependencies (README: "Install in an app"), or run \`pnpm exec expo-svelte init\`` };
}
function svelte(context, peers) {
  const installed = findPackage("svelte", context.appRoot);
  const fix = 'install the custom-renderer build of Svelte (sveltejs/svelte#18042, commit 216f258, 5.56.7): `pnpm exec expo-svelte init` does it (docs/10-getting-started/20-creating-a-project.md), or by hand, README "Install in an app"';
  if (!installed) return { group: "svelte", status: "fail", message: "svelte is not installed", fix };
  const entry = record(installed.json.exports)["./renderer"];
  const target = text2(entry) ?? text2(record(entry).default);
  const exported = target !== void 0 && existsSync6(join9(installed.directory, target));
  const compiler = ["src/compiler/validate-options.js", "compiler/index.js"].some((file) => {
    try {
      return readFileSync7(join9(installed.directory, file), "utf8").includes("customRenderer");
    } catch {
      return false;
    }
  });
  if (!exported || !compiler) {
    return {
      group: "svelte",
      status: "fail",
      message: `svelte ${installed.version} is the stock Svelte: ${!exported ? "it has no ./renderer export" : "its compiler has no customRenderer option"} (${installed.directory})`,
      fix
    };
  }
  const range = text2(peers.svelte);
  if (range !== void 0 && satisfies(installed.version, range) === false) {
    return { group: "svelte", status: "fail", message: `svelte ${installed.version} has ./renderer but does not satisfy ${range}`, fix };
  }
  return { group: "svelte", status: "pass", message: `svelte ${installed.version} has the ./renderer export and the customRenderer compiler option` };
}
function peerDependencies(context, peers, optional) {
  const checks = [];
  const absent = [];
  for (const [name, wanted] of Object.entries(peers).sort(([a], [b]) => a.localeCompare(b))) {
    const range = text2(wanted);
    if (range === void 0 || name === "svelte") continue;
    const installed = findPackage(name, context.appRoot);
    if (!installed) {
      if (optional.has(name)) absent.push(name);
      else checks.push({ group: "peer dependencies", status: "fail", message: `${name} is not installed (needs ${range})`, fix: `pnpm add ${name}@${range}` });
      continue;
    }
    const ok = satisfies(installed.version, range);
    if (ok === true) checks.push({ group: "peer dependencies", status: "pass", message: `${name} ${installed.version} satisfies ${range}` });
    else if (ok === false) checks.push({ group: "peer dependencies", status: "fail", message: `${name} ${installed.version} does not satisfy ${range}`, fix: `pnpm add ${name}@${range}` });
    else checks.push({ group: "peer dependencies", status: "unknown", message: `${name} ${installed.version}: could not compare it with ${range}` });
  }
  if (absent.length > 0) checks.push({ group: "peer dependencies", status: "skip", message: `optional peer dependencies not installed, nothing to check: ${absent.join(", ")}` });
  return checks;
}
function expoRuntime(context) {
  const expo2 = findPackage("expo", context.appRoot);
  if (!expo2) return [];
  const missing = EXPO_RUNTIME_FILES.filter((file) => !existsSync6(join9(expo2.directory, file)));
  if (missing.length === 0) return [{ group: "peer dependencies", status: "pass", message: `expo ${expo2.version} has src/winter, the runtime (URL, fetch, TextDecoder) that the library's polyfills import` }];
  return [{
    group: "peer dependencies",
    status: "fail",
    message: `expo ${expo2.version} has no ${missing.join(", ")} (${expo2.directory}): the library's polyfills import expo/src/winter for the standard URL, and the router starts blank without it`,
    fix: `npx expo install expo (the version this library was exercised on is in its peerDependencies)`
  }];
}
function vendored(context, libraryName) {
  const declared = new Set(declaredVendored(context.appRoot));
  const checks = [];
  const optionalCopies = [];
  for (const { name, version, optional } of vendoredPackages) {
    const directory = vendoredRoot(name, context.packageRoot);
    const copy = readJson2(join9(directory, "package.json"));
    if (copy === void 0 || copy.version !== version) {
      checks.push({
        group: "vendored packages",
        status: "fail",
        message: copy === void 0 ? `${libraryName} has no copy of ${name} (${directory}): the installed library is incomplete` : `${directory} is ${name} ${String(copy.version)}, the library pins ${version}`,
        fix: `install ${libraryName} again (a package manager that dropped the library's vendor/ folder, or a stale cache, leaves it incomplete)`
      });
    } else if (declared.has(name)) {
      checks.push({ group: "vendored packages", status: "fail", message: `${name} is a dependency of the app (${join9(context.appRoot, "package.json")}): ${collisionMessage([name], libraryName)}`, fix: `pnpm remove ${name}, then npx expo prebuild` });
    } else if (optional === void 0) {
      checks.push({ group: "vendored packages", status: "pass", message: `${name} ${version} comes with ${libraryName} (vendor/${name}); the app does not list it` });
    } else optionalCopies.push(name);
  }
  if (optionalCopies.length > 0) checks.push({ group: "vendored packages", status: "pass", message: `the ${optionalCopies.length} optional libraries come with ${libraryName} (vendor/), at the versions it pins; the app lists none of them` });
  checks.push(libraries(context, libraryName));
  return checks;
}
function libraries(context, libraryName) {
  const group3 = "vendored packages";
  const fix = `fix \`libraries\` in the ${libraryName} plugin's options (app.json or app.config.*), then prebuild again`;
  const read2 = appPluginOptions(context.appRoot, join9(context.appRoot, "package.json"));
  if ("error" in read2 && read2.error instanceof Error && read2.error.name === "LibrariesConfigError") {
    return { group: group3, status: "fail", message: read2.error.message, fix };
  }
  if ("unknown" in read2) return { group: group3, status: "skip", message: `${read2.unknown}, so the optional libraries it turns on were not checked (\`npx expo config\` shows the config)` };
  try {
    const { enabled, listed } = checkLibraries(read2.options?.libraries);
    if (enabled.length === 0) return { group: group3, status: "pass", message: "no optional library is turned on (libraries): none of their native code is in the app" };
    const implied = enabled.filter((name) => !listed.has(name));
    return { group: group3, status: "pass", message: `libraries turned on: ${enabled.join(", ")}${implied.length > 0 ? ` (${implied.join(", ")}: needed by another)` : ""}; the others are not linked, and Metro stubs them` };
  } catch (error) {
    if (!(error instanceof LibrariesConfigError)) throw error;
    return { group: group3, status: "fail", message: error.message, fix };
  }
}
function vendoredPatches(context, libraryName) {
  const checks = [];
  for (const spec of patchSpecs) {
    if (!spec.vendored) continue;
    const directory = vendoredRoot(spec.package, context.packageRoot);
    if (readJson2(join9(directory, "package.json")) === void 0) continue;
    const problems = spec.inspect(readerFor(directory), "");
    checks.push(problems.length === 0 ? { group: "vendored packages", status: "pass", message: `${spec.package}: ${spec.does} (in ${libraryName}'s copy)` } : { group: "vendored packages", status: "fail", message: `${spec.package} in ${libraryName}'s copy is not patched: ${spec.does}`, details: problems.slice(0, 4), fix: `install ${libraryName} again: the copy in vendor/${spec.package} is not the one the library was built with` });
  }
  return checks;
}
function patches(context, libraryName, optional) {
  const declared = declaredPatches(context.appRoot);
  const checks = [];
  for (const patch of patchFiles(join9(context.packageRoot, "patches"))) {
    const key = patchKey(patch);
    const spec = patchSpecs.find((candidate) => candidate.package === patch.package);
    if (!spec) continue;
    const parent = spec.via ? findPackage(spec.via, context.appRoot) : void 0;
    const installed = findPackage(patch.package, parent?.directory ?? context.appRoot);
    if (!installed) {
      checks.push(optional.has(patch.package) ? { group: "patches", status: "skip", message: `${key}: ${patch.package} is not installed (optional), nothing to patch` } : { group: "patches", status: "fail", message: `${key}: ${patch.package} is not installed${spec.via && !parent ? ` (${spec.via} is not either)` : ""}`, fix: `pnpm add ${patch.package}@${patch.version}` });
      continue;
    }
    if (installed.version !== patch.version) {
      const fix2 = spec.via ? `pin ${patch.package} for the install: \`overrides:\` with \`${patch.package}: ${patch.version}\` in pnpm-workspace.yaml (${spec.via} asks for it by a range, so a fresh install takes a newer version and pnpm reports ERR_PNPM_UNUSED_PATCH), then pnpm install (README: "Install in an app")` : `pnpm add ${patch.package}@${patch.version}`;
      checks.push({ group: "patches", status: "fail", message: `${patch.package} ${installed.version} is installed, the patch is for exactly ${patch.version}: pnpm would not apply it`, fix: fix2 });
      continue;
    }
    const reader = readerFor(installed.directory);
    const patchText = readFileSync7(patch.path, "utf8");
    const changed = spec.inspect(reader, patchText);
    const differing = changed.length === 0 ? missingFromPackage(patchText, reader) : [];
    if (changed.length === 0 && differing.length === 0) {
      checks.push({ group: "patches", status: "pass", message: `${key} applied: ${spec.does}` });
      continue;
    }
    const entry = declared.get(key);
    const copy = `node_modules/${libraryName}/patches/${patch.file}`;
    const fix = !entry ? `copy ${copy} into your repository (patches/expo-svelte/), declare "${key}: patches/expo-svelte/${patch.file}" under patchedDependencies in pnpm-workspace.yaml, then pnpm install (README: "Apply the patches")` : !existsSync6(entry.file) ? `${entry.source} declares ${key} at ${entry.path}, which does not exist: copy ${copy} there, then pnpm install` : `${entry.source} declares ${key} (${entry.path}); run pnpm install, and if the package is still not patched copy ${copy} over that file (an older copy of the patch does not match this version of the library)`;
    const problems = changed.length > 0 ? changed : differing;
    checks.push({
      group: "patches",
      status: "fail",
      message: changed.length > 0 ? `${key} is not applied: ${spec.does}` : `${key} is patched, but not with this version of the library's patch`,
      details: problems.slice(0, 4).concat(problems.length > 4 ? [`and ${problems.length - 4} more`] : []),
      fix
    });
  }
  return checks;
}
function integration(context, name) {
  const metro = (finding) => {
    const file = finding.file ?? "";
    if (finding.state === "found") return { group: "build integration", status: "pass", message: `${file} uses withExpoSvelte` };
    if (finding.state === "unclear") return { group: "build integration", status: "unknown", message: `could not tell: ${file} does not mention withExpoSvelte (a config that applies it from a file it imports is fine)`, fix: `module.exports = withExpoSvelte(getDefaultConfig(__dirname)), with withExpoSvelte from require("${name}/metro")` };
    return { group: "build integration", status: "fail", message: "no metro.config.js in the app: Expo's default Metro config does not know the library", fix: `create metro.config.js: module.exports = withExpoSvelte(getDefaultConfig(__dirname)), with withExpoSvelte from require("${name}/metro")` };
  };
  const plugin2 = (finding) => {
    const file = finding.file ?? "";
    if (finding.state === "found") return { group: "build integration", status: "pass", message: `${file} lists the ${finding.name ?? name} plugin` };
    if (finding.state === "removed") return { group: "build integration", status: "fail", message: `${file} lists ${finding.name}, a path removed in 0.4.0-rc.7 that no longer resolves: expo prebuild fails on it`, fix: `write "${name}" in plugins in ${file}, in place of "${finding.name}"` };
    if (finding.state === "unclear") return { group: "build integration", status: "unknown", message: `could not tell: ${file} does not name ${name} (a config that builds its plugins in code may add it)`, fix: `plugins: ["${name}"] in the Expo config` };
    if (finding.state === "absent") return { group: "build integration", status: "fail", message: `${file} does not list the ${name} plugin`, fix: `add "${name}" to plugins in ${file}` };
    return { group: "build integration", status: "fail", message: "no app.json or app.config.* in the app", fix: `create an Expo config with plugins: ["${name}"]` };
  };
  return [metro(metroFinding(context.appRoot)), plugin2(expoPluginFinding(context.appRoot, name))];
}
function runChecks(context) {
  const own2 = readJson2(join9(context.packageRoot, "package.json")) ?? {};
  const name = text2(own2.name) ?? "expo-svelte";
  const appPackage = readJson2(join9(context.appRoot, "package.json"));
  if (!appPackage) {
    return [{ group: "environment", status: "fail", message: `${context.appRoot} has no package.json: this is not an app directory`, fix: "run expo-svelte doctor from the app's directory" }];
  }
  const peers = record(own2.peerDependencies);
  const optional = new Set(Object.entries(record(own2.peerDependenciesMeta)).filter(([, meta]) => record(meta).optional === true).map(([peer]) => peer));
  return [
    ...environment(context),
    svelte(context, peers),
    ...peerDependencies(context, peers, optional),
    ...expoRuntime(context),
    ...vendored(context, name),
    ...vendoredPatches(context, name),
    ...patches(context, name, optional),
    library(context, name, text2(own2.version) ?? "?", appPackage),
    ...integration(context, name),
    ...pushChecks(context, { name, version: text2(own2.version) ?? "?" }, appPackage)
  ];
}
var text2, EXPO_RUNTIME_FILES;
var init_checks = __esm({
  "src/doctor/checks.ts"() {
    "use strict";
    init_declared();
    init_integration();
    init_hunks();
    init_patches();
    init_push();
    init_requirements();
    init_resolve();
    init_semver();
    init_libraries();
    init_vendored();
    text2 = (value) => typeof value === "string" ? value : void 0;
    EXPO_RUNTIME_FILES = ["src/winter/index.ts", "src/winter/runtime.native.ts"];
  }
});

// src/push/jwt.ts
import { createPrivateKey, sign } from "node:crypto";
function privateKeyOf(pem, algorithm, name) {
  let key;
  try {
    key = createPrivateKey(pemOf(pem));
  } catch (error) {
    throw new TypeError(`${name} is not a PEM private key (${error instanceof Error ? error.message : String(error)}).`, { cause: error });
  }
  const wanted = KEYS[algorithm];
  if (key.asymmetricKeyType !== wanted.type || wanted.curve !== void 0 && key.asymmetricKeyDetails?.namedCurve !== wanted.curve) {
    throw new TypeError(`${name} must be ${wanted.curve === void 0 ? "an RSA" : "a P-256 (prime256v1) elliptic-curve"} private key for ${algorithm}, not ${key.asymmetricKeyType ?? "another kind of key"}${key.asymmetricKeyDetails?.namedCurve ? ` on ${key.asymmetricKeyDetails.namedCurve}` : ""}.`);
  }
  return key;
}
function signJwt(algorithm, header, claims, key) {
  const input = `${encode({ alg: algorithm, ...header })}.${encode(claims)}`;
  const signature = sign("sha256", Buffer.from(input), algorithm === "ES256" ? { key, dsaEncoding: "ieee-p1363" } : key);
  return `${input}.${signature.toString("base64url")}`;
}
var KEYS, pemOf, encode;
var init_jwt = __esm({
  "src/push/jwt.ts"() {
    "use strict";
    KEYS = {
      RS256: { type: "rsa" },
      ES256: { type: "ec", curve: "prime256v1" }
    };
    pemOf = (value) => (value.includes("\n") ? value : value.replaceAll("\\n", "\n")).trim();
    encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  }
});

// src/push/apns.ts
import { connect } from "node:http2";
function createApns(options, timeout) {
  const names = ["key", "keyId", "teamId"];
  if (options === void 0 || names.every((name) => options[name] === void 0 || options[name] === "")) return void 0;
  for (const name of names) {
    if (typeof options[name] !== "string" || options[name] === "") throw new TypeError(`\`apns.${name}\` is needed beside the other two: the \`.p8\`'s contents, its key id and the team id.`);
  }
  return new ApnsSender({
    key: privateKeyOf(String(options.key), "ES256", "`apns.key`"),
    keyId: String(options.keyId),
    teamId: String(options.teamId),
    productionUrl: httpUrl(options.productionUrl ?? PRODUCTION_URL, "`apns.productionUrl`"),
    sandboxUrl: httpUrl(options.sandboxUrl ?? SANDBOX_URL, "`apns.sandboxUrl`"),
    timeout
  });
}
function apnsRequest(token, message) {
  const silent = message.silent === true;
  const headers = {
    ":method": "POST",
    // A token that is not hex is APNs's to refuse (`BadDeviceToken`); encoded, it cannot add to the path.
    ":path": `/3/device/${encodeURIComponent(token.token)}`,
    "apns-topic": headerText(token.app, "The token's `app`"),
    "apns-push-type": silent ? "background" : "alert"
  };
  const priority = silent ? "5" : message.priority === void 0 ? void 0 : message.priority === "high" ? "10" : "5";
  if (priority !== void 0) headers["apns-priority"] = priority;
  if (message.ttl !== void 0) headers["apns-expiration"] = String(message.ttl === 0 ? 0 : Math.floor(Date.now() / 1e3) + message.ttl);
  if (message.collapseKey !== void 0) headers["apns-collapse-id"] = headerText(message.collapseKey, "`collapseKey`");
  if (message.data !== void 0 && Object.hasOwn(message.data, "aps")) throw new TypeError("`data.aps` is APNs's own key and cannot carry data: name the key something else.");
  const aps = {};
  if (silent) {
    aps["content-available"] = 1;
  } else {
    aps.alert = { ...message.title !== void 0 ? { title: message.title } : {}, ...message.body !== void 0 ? { body: message.body } : {} };
    if (message.badge !== void 0) aps.badge = message.badge;
    if (message.sound !== null) aps.sound = "default";
  }
  return { headers, body: JSON.stringify({ ...message.data, ...message.url !== void 0 ? { url: message.url } : {}, aps }) };
}
function apnsFailure(status, reason, retryAfter) {
  const detail = reason ?? `HTTP ${status}`;
  if (reason === "BadDeviceToken" || reason === "DeviceTokenNotForTopic") return failure("invalid-token", detail, status);
  if (status === 410 && (reason === "Unregistered" || reason === "ExpiredToken")) return failure("gone", detail, status);
  if (status === 401 || status === 403) return failure("auth", detail, status);
  if (reason === "IdleTimeout") return failure("unavailable", detail, status, retryAfter);
  if (status === 429) return failure("rate-limited", detail, status, retryAfter);
  if (status >= 500) return failure("unavailable", detail, status, retryAfter);
  if (status === 400 || status === 413) return failure("invalid-message", detail, status);
  return failure("error", detail, status);
}
var PRODUCTION_URL, SANDBOX_URL, RENEW_AFTER, RENEW_NOT_BEFORE, headerText, Endpoint, ApnsSender;
var init_apns = __esm({
  "src/push/apns.ts"() {
    "use strict";
    init_common();
    init_jwt();
    PRODUCTION_URL = "https://api.push.apple.com";
    SANDBOX_URL = "https://api.sandbox.push.apple.com";
    RENEW_AFTER = 50 * 6e4;
    RENEW_NOT_BEFORE = 20 * 6e4;
    headerText = (value, name) => {
      if (!/^[\x21-\x7e]+$/.test(value)) throw new TypeError(`${name} must be printable ASCII without spaces to be sent as an APNs header, not ${JSON.stringify(value)}.`);
      return value;
    };
    Endpoint = class {
      #origin;
      #timeout;
      /** The session new requests use: one that is open, or none. */
      #current;
      /** Every session that has not closed, including one that got a GOAWAY and is finishing its requests: `close` waits for them all. */
      #sessions = /* @__PURE__ */ new Set();
      constructor(origin, timeout) {
        this.#origin = origin;
        this.#timeout = timeout;
      }
      /** Sends one request and resolves with the answer, or with why there is none. It never rejects. */
      request(headers, body) {
        return new Promise((resolve12) => {
          let session;
          let timer;
          let settled = false;
          const finish = (answer) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            resolve12(answer);
          };
          try {
            session = this.#session();
            const stream = session.request(headers);
            const current = session;
            let responseHeaders;
            let text3 = "";
            stream.setEncoding("utf8");
            stream.on("response", (received) => {
              responseHeaders = received;
            });
            stream.on("data", (chunk) => {
              text3 += chunk;
            });
            stream.on(
              "end",
              () => finish(responseHeaders === void 0 ? failure("unavailable", "The stream to APNs ended before APNs answered.") : { ok: true, status: Number(responseHeaders[":status"]), headers: responseHeaders, body: text3 })
            );
            stream.on("error", (error) => finish(failure("unavailable", describeNetworkError(error))));
            stream.on("close", () => finish(failure("unavailable", `The stream to APNs closed (code ${stream.rstCode}) before APNs answered.`)));
            timer = setTimeout(() => {
              finish(failure("unavailable", `APNs did not answer within ${this.#timeout} ms.`));
              this.#drop(current);
              current.destroy();
            }, this.#timeout);
            stream.end(body);
          } catch (error) {
            if (session !== void 0) this.#drop(session);
            finish(failure("unavailable", describeNetworkError(error)));
          }
        });
      }
      /** Ends the connection once the requests in flight are answered. */
      async close() {
        const sessions = [...this.#sessions];
        this.#current = void 0;
        await Promise.all(
          sessions.map(
            (session) => new Promise((resolve12) => {
              if (session.destroyed) return resolve12();
              session.once("close", resolve12);
              session.close();
            })
          )
        );
      }
      #session() {
        if (this.#current !== void 0 && !this.#current.closed && !this.#current.destroyed) return this.#current;
        const session = connect(this.#origin);
        this.#sessions.add(session);
        this.#current = session;
        session.on("error", () => this.#drop(session));
        session.on("goaway", () => {
          this.#drop(session);
          if (!session.closed && !session.destroyed) session.close();
        });
        session.on("close", () => {
          this.#drop(session);
          this.#sessions.delete(session);
        });
        return session;
      }
      /** Stops new requests from using `session`. */
      #drop(session) {
        if (this.#current === session) this.#current = void 0;
      }
    };
    ApnsSender = class {
      #config;
      #endpoints = /* @__PURE__ */ new Map();
      #token;
      constructor(config) {
        this.#config = config;
      }
      async send(token, message) {
        const { headers, body } = apnsRequest(token, message);
        const endpoint = this.#endpoint(token.environment === "development" ? this.#config.sandboxUrl : this.#config.productionUrl);
        let jwt = this.#providerToken();
        for (let attempt = 0; ; attempt++) {
          const answer = await endpoint.request({ ...headers, authorization: `bearer ${jwt}` }, body);
          if (!answer.ok) return answer;
          const parsed = parseJson(answer.body);
          const reason = isRecord(parsed) && typeof parsed.reason === "string" ? parsed.reason : void 0;
          if (answer.status === 200) {
            const id = answer.headers["apns-id"];
            return typeof id === "string" && id !== "" ? { ok: true, id } : failure("error", "APNs answered without an apns-id.", answer.status);
          }
          if (reason === "ExpiredProviderToken" && attempt === 0) {
            const renewed = this.#renew(jwt);
            if (renewed !== jwt) {
              jwt = renewed;
              continue;
            }
          }
          return apnsFailure(answer.status, reason, retryAfterOf(answer.headers["retry-after"]));
        }
      }
      async close() {
        await Promise.all([...this.#endpoints.values()].map((endpoint) => endpoint.close()));
      }
      #endpoint(origin) {
        let endpoint = this.#endpoints.get(origin);
        if (endpoint === void 0) {
          endpoint = new Endpoint(origin, this.#config.timeout);
          this.#endpoints.set(origin, endpoint);
        }
        return endpoint;
      }
      /** The provider token: the one signed less than 50 minutes ago, else a new one. The same token serves the production and the sandbox host. */
      #providerToken() {
        const now = Date.now();
        if (this.#token === void 0 || now - this.#token.issuedAt >= RENEW_AFTER) this.#token = this.#sign(now);
        return this.#token.jwt;
      }
      /**
       * Replaces `used`, the token a request was refused with, unless it is not the current one (another send already replaced it) or the current one is younger than the 20
       * minutes Apple allows between tokens. Returns the token to send with now, which is `used` when nothing was replaced.
       */
      #renew(used) {
        const now = Date.now();
        if (this.#token !== void 0 && this.#token.jwt === used && now - this.#token.issuedAt >= RENEW_NOT_BEFORE) this.#token = this.#sign(now);
        return this.#token?.jwt ?? used;
      }
      #sign(now) {
        const { key, keyId, teamId } = this.#config;
        return { jwt: signJwt("ES256", { kid: keyId }, { iss: teamId, iat: Math.floor(now / 1e3) }, key), issuedAt: now };
      }
    };
  }
});

// src/push/fcm.ts
function readAccount(value) {
  let account = value;
  if (typeof value === "string") {
    try {
      account = JSON.parse(value);
    } catch {
      throw new TypeError("`fcm.serviceAccount` is a string but not JSON: pass the service account key's file as it is, or the parsed object.");
    }
  }
  if (!isRecord(account)) throw new TypeError("`fcm.serviceAccount` must be the service account key's JSON, a string or an object.");
  for (const name of ["project_id", "client_email", "private_key"]) {
    if (typeof account[name] !== "string" || account[name] === "") throw new TypeError(`\`fcm.serviceAccount\` has no \`${name}\`: it is not a service account key.`);
  }
  if (account.token_uri !== void 0 && typeof account.token_uri !== "string") throw new TypeError("`fcm.serviceAccount.token_uri` must be a string.");
  return { projectId: String(account.project_id), clientEmail: String(account.client_email), privateKey: String(account.private_key), tokenUri: account.token_uri };
}
function createFcm(options, timeout) {
  if (options === void 0 || options.serviceAccount === void 0 || options.serviceAccount === "") return void 0;
  const account = readAccount(options.serviceAccount);
  const base = httpUrl(options.baseUrl ?? FCM_URL, "`fcm.baseUrl`");
  return new FcmSender({
    projectId: account.projectId,
    clientEmail: account.clientEmail,
    key: privateKeyOf(account.privateKey, "RS256", "`fcm.serviceAccount.private_key`"),
    tokenUrl: httpUrl(options.tokenUrl ?? account.tokenUri ?? TOKEN_URL, "`fcm.tokenUrl`"),
    sendUrl: `${base}/v1/projects/${encodeURIComponent(account.projectId)}/messages:send`,
    timeout
  });
}
function fcmBody(token, message) {
  const data = { ...message.data };
  if (message.url !== void 0) data.url = message.url;
  const android = {};
  if (message.collapseKey !== void 0) android.collapse_key = message.collapseKey;
  if (message.priority !== void 0) android.priority = message.priority === "high" ? "HIGH" : "NORMAL";
  if (message.ttl !== void 0) android.ttl = `${message.ttl}s`;
  if (!message.silent) {
    const notification = {};
    if (message.title !== void 0) notification.title = message.title;
    if (message.body !== void 0) notification.body = message.body;
    if (message.sound !== null) notification.sound = "default";
    if (message.channel !== void 0) notification.channel_id = message.channel;
    android.notification = notification;
  }
  return { message: { token: token.token, ...Object.keys(data).length > 0 ? { data } : {}, ...Object.keys(android).length > 0 ? { android } : {} } };
}
function readError(body) {
  const error = isRecord(body) && isRecord(body.error) ? body.error : void 0;
  if (error === void 0) return { aboutToken: false };
  const details = Array.isArray(error.details) ? error.details.filter(isRecord) : [];
  const fcm = details.find((detail) => typeof detail.errorCode === "string")?.errorCode;
  const message = typeof error.message === "string" ? error.message : void 0;
  const violations = details.flatMap((detail) => Array.isArray(detail.fieldViolations) ? detail.fieldViolations.filter(isRecord) : []);
  const aboutToken = violations.some((violation) => violation.field === "message.token") || /registration token/i.test(message ?? "");
  return { code: typeof fcm === "string" ? fcm : typeof error.status === "string" ? error.status : void 0, message, aboutToken };
}
function fcmFailure(status, body, text3, retryAfter) {
  const { code, message, aboutToken } = readError(body);
  const detail = message ?? code ?? (text3.trim() === "" ? `HTTP ${status}` : text3.trim().slice(0, 300));
  switch (code) {
    case "UNREGISTERED":
      return failure("gone", detail, status);
    case "SENDER_ID_MISMATCH":
      return failure("auth", `${detail}: the token belongs to another Firebase project than the service account's; check the server's credentials before suspecting the token`, status);
    case "INVALID_ARGUMENT":
      return failure(aboutToken ? "invalid-token" : "invalid-message", detail, status);
    case "QUOTA_EXCEEDED":
    case "RESOURCE_EXHAUSTED":
      return failure("rate-limited", detail, status, retryAfter);
    case "UNAVAILABLE":
    case "INTERNAL":
      return failure("unavailable", detail, status, retryAfter);
    case "UNAUTHENTICATED":
    case "THIRD_PARTY_AUTH_ERROR":
    case "PERMISSION_DENIED":
      return failure("auth", detail, status);
  }
  if (status === 404) return failure("error", `FCM answered 404 (${detail}): the endpoint or the project was not found; check the service account's \`project_id\` and \`fcm.baseUrl\`.`, status);
  if (status === 429) return failure("rate-limited", detail, status, retryAfter);
  if (status >= 500) return failure("unavailable", detail, status, retryAfter);
  if (status === 401 || status === 403) return failure("auth", detail, status);
  if (status === 400) return failure(aboutToken ? "invalid-token" : "invalid-message", detail, status);
  return failure("error", detail, status);
}
var SCOPE, FCM_URL, TOKEN_URL, ASSERTION_SECONDS, EXPIRY_MARGIN, FcmSender;
var init_fcm = __esm({
  "src/push/fcm.ts"() {
    "use strict";
    init_common();
    init_jwt();
    SCOPE = "https://www.googleapis.com/auth/firebase.messaging";
    FCM_URL = "https://fcm.googleapis.com";
    TOKEN_URL = "https://oauth2.googleapis.com/token";
    ASSERTION_SECONDS = 3600;
    EXPIRY_MARGIN = 5 * 6e4;
    FcmSender = class {
      #config;
      #access;
      /** The token request in flight: sends that need a token while one is on its way wait for it, and one request serves them all. */
      #pending;
      constructor(config) {
        this.#config = config;
      }
      async send(token, message) {
        const access = await this.#accessToken();
        if (typeof access !== "string") return access;
        let response;
        let text3;
        try {
          response = await fetch(this.#config.sendUrl, {
            method: "POST",
            headers: { authorization: `Bearer ${access}`, "content-type": "application/json; charset=utf-8" },
            body: JSON.stringify(fcmBody(token, message)),
            signal: AbortSignal.timeout(this.#config.timeout)
          });
          text3 = await response.text();
        } catch (error) {
          return failure("unavailable", describeNetworkError(error));
        }
        const body = parseJson(text3);
        if (response.ok) {
          const name = isRecord(body) && typeof body.name === "string" ? body.name : "";
          const id = name.slice(name.lastIndexOf("/") + 1);
          return id === "" ? failure("error", "FCM answered without a message name.", response.status) : { ok: true, id };
        }
        if (response.status === 401 && this.#access?.token === access) this.#access = void 0;
        return fcmFailure(response.status, body, text3, retryAfterOf(response.headers.get("retry-after")));
      }
      /**
       * Asks the token endpoint for an access token without sending anything: what `expo-svelte doctor --server` checks the service account's key with. It resolves with the
       * lifetime (seconds) of the token the endpoint gave, or with why there is none (`auth` for a key Google refuses: `invalid_grant`, with its description as the detail). The token
       * is kept for the next send, and never returned.
       */
      async verify() {
        const access = await this.#accessToken();
        return typeof access === "string" ? { ok: true, expiresIn: this.#access?.lifetime ?? 0 } : access;
      }
      /** The access token: the cached one while it has more than the margin left, else a new one that every send waiting for it shares. */
      #accessToken() {
        if (this.#access !== void 0 && this.#access.usableUntil > Date.now()) return Promise.resolve(this.#access.token);
        this.#pending ??= this.#exchange().finally(() => {
          this.#pending = void 0;
        });
        return this.#pending;
      }
      /** Signs an assertion with the service account's key and exchanges it at the token endpoint (RFC 7523): the access token, or why there is none. */
      async #exchange() {
        const { clientEmail, key, tokenUrl, timeout } = this.#config;
        const issuedAt = Math.floor(Date.now() / 1e3);
        const assertion = signJwt("RS256", { typ: "JWT" }, { iss: clientEmail, scope: SCOPE, aud: tokenUrl, iat: issuedAt, exp: issuedAt + ASSERTION_SECONDS }, key);
        let response;
        let text3;
        try {
          response = await fetch(tokenUrl, {
            method: "POST",
            headers: { "content-type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
            signal: AbortSignal.timeout(timeout)
          });
          text3 = await response.text();
        } catch (error) {
          return failure("unavailable", `The token request to ${hostOf(tokenUrl)} failed: ${describeNetworkError(error)}`);
        }
        const body = parseJson(text3);
        if (!response.ok) {
          const reason = isRecord(body) ? typeof body.error_description === "string" ? body.error_description : typeof body.error === "string" ? body.error : void 0 : void 0;
          const detail = reason ?? `The token endpoint answered ${response.status}.`;
          if (response.status === 429) return failure("rate-limited", detail, response.status, retryAfterOf(response.headers.get("retry-after")));
          if (response.status >= 500) return failure("unavailable", detail, response.status, retryAfterOf(response.headers.get("retry-after")));
          return failure(response.status >= 400 && response.status < 500 ? "auth" : "error", detail, response.status);
        }
        if (!isRecord(body) || typeof body.access_token !== "string" || body.access_token === "") return failure("error", "The token endpoint answered without an access token.", response.status);
        const lifetime = typeof body.expires_in === "number" ? body.expires_in : ASSERTION_SECONDS;
        this.#access = { token: body.access_token, usableUntil: Date.now() + lifetime * 1e3 - EXPIRY_MARGIN, lifetime };
        return body.access_token;
      }
    };
  }
});

// src/push/credentials.ts
import { readFileSync as readFileSync8 } from "node:fs";
import { resolve as resolve7 } from "node:path";
function textOrFile(env, name, cwd, isText, kind) {
  const value = valueSet(env, name) ?? "";
  if (isText(value)) return { text: value, source: { file: false } };
  const path = resolve7(cwd, value.trim());
  try {
    return { text: readFileSync8(path, "utf8"), source: { file: true, path } };
  } catch (error) {
    const code = error.code;
    return { problem: `is neither ${kind} nor the path of a file that can be read (${code === "ENOENT" ? `no such file, from ${cwd}` : code ?? "unreadable"}): set it to ${kind} itself, or to the path of its file` };
  }
}
function urlOf(env, name) {
  const value = valueSet(env, name);
  if (value === void 0) return {};
  try {
    const url = new URL(value.trim());
    if (url.protocol === "http:" || url.protocol === "https:") return { url: value.trim() };
  } catch {
  }
  return { problem: `${name} must be an http or https URL` };
}
function readFcm(env, cwd) {
  const name = variables.fcmServiceAccount;
  if (valueSet(env, name) === void 0) return { state: "unset" };
  const read2 = textOrFile(env, name, cwd, (value) => /^\s*[{[]/.test(value), "the service account key's JSON");
  if ("problem" in read2) return { state: "invalid", problem: `${name} ${read2.problem}` };
  let parsed;
  try {
    parsed = JSON.parse(read2.text);
  } catch {
    return { state: "invalid", problem: `${name} (${describeSource(read2.source)}) is not JSON: it must be the service account key's file as Google gave it` };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return { state: "invalid", problem: `${name} (${describeSource(read2.source)}) must be the service account key's JSON object` };
  const account = parsed;
  for (const field of ["project_id", "client_email", "private_key"]) {
    if (typeof account[field] !== "string" || account[field] === "") return { state: "invalid", problem: `${name} (${describeSource(read2.source)}) has no \`${field}\`: it is not a service account key` };
  }
  if (account.token_uri !== void 0 && typeof account.token_uri !== "string") return { state: "invalid", problem: `${name} (${describeSource(read2.source)}) has a \`token_uri\` that is not a string` };
  if (typeof account.token_uri === "string") {
    try {
      httpUrl(account.token_uri, "token_uri");
    } catch {
      return { state: "invalid", problem: `${name} (${describeSource(read2.source)}) has a \`token_uri\` that is not an http or https URL` };
    }
  }
  try {
    privateKeyOf(String(account.private_key), "RS256", `the private_key of ${name}`);
  } catch (error) {
    return { state: "invalid", problem: error instanceof Error ? error.message : String(error) };
  }
  const base = urlOf(env, variables.fcmBaseUrl);
  const token = urlOf(env, variables.fcmTokenUrl);
  const problem = base.problem ?? token.problem;
  if (problem) return { state: "invalid", problem };
  const tokenUrl = token.url ?? (typeof account.token_uri === "string" ? account.token_uri : TOKEN_URL);
  return {
    state: "ok",
    options: { serviceAccount: account, ...base.url ? { baseUrl: base.url } : {}, ...token.url ? { tokenUrl: token.url } : {} },
    projectId: String(account.project_id),
    clientEmail: String(account.client_email),
    source: read2.source,
    tokenHost: hostOf(tokenUrl)
  };
}
function readApns(env, cwd) {
  const names = [variables.apnsKey, variables.apnsKeyId, variables.apnsTeamId];
  const unset = names.filter((name) => valueSet(env, name) === void 0);
  if (unset.length === names.length) return { state: "unset" };
  if (unset.length > 0) return { state: "invalid", problem: `${unset.join(" and ")} ${unset.length > 1 ? "are" : "is"} not set: APNs needs ${names.join(", ")} together` };
  const key = textOrFile(env, variables.apnsKey, cwd, (value) => value.includes("-----BEGIN"), "the .p8 key's PEM");
  if ("problem" in key) return { state: "invalid", problem: `${variables.apnsKey} ${key.problem}` };
  try {
    privateKeyOf(key.text, "ES256", variables.apnsKey);
  } catch (error) {
    return { state: "invalid", problem: error instanceof Error ? error.message : String(error) };
  }
  const keyId = (valueSet(env, variables.apnsKeyId) ?? "").trim();
  const teamId = (valueSet(env, variables.apnsTeamId) ?? "").trim();
  for (const [name, value] of [[variables.apnsKeyId, keyId], [variables.apnsTeamId, teamId]]) {
    if (!tenCharacters.test(value)) return { state: "invalid", problem: `${name} must be 10 letters and digits (it has ${value.length} characters)` };
  }
  const production = urlOf(env, variables.apnsProductionUrl);
  const sandbox = urlOf(env, variables.apnsSandboxUrl);
  const problem = production.problem ?? sandbox.problem;
  if (problem) return { state: "invalid", problem };
  return {
    state: "ok",
    options: { key: key.text, keyId, teamId, ...production.url ? { productionUrl: production.url } : {}, ...sandbox.url ? { sandboxUrl: sandbox.url } : {} },
    keyId,
    teamId,
    source: key.source,
    sandboxHost: hostOf(sandbox.url ?? SANDBOX_URL)
  };
}
var variables, describeSource, valueSet, tenCharacters;
var init_credentials = __esm({
  "src/push/credentials.ts"() {
    "use strict";
    init_apns();
    init_common();
    init_fcm();
    init_jwt();
    variables = {
      fcmServiceAccount: "FCM_SERVICE_ACCOUNT",
      fcmBaseUrl: "FCM_BASE_URL",
      fcmTokenUrl: "FCM_TOKEN_URL",
      apnsKey: "APNS_KEY",
      apnsKeyId: "APNS_KEY_ID",
      apnsTeamId: "APNS_TEAM_ID",
      apnsProductionUrl: "APNS_PRODUCTION_URL",
      apnsSandboxUrl: "APNS_SANDBOX_URL"
    };
    describeSource = (source) => source.file ? `the file ${source.path}` : "the variable's text";
    valueSet = (env, name) => {
      const value = env[name];
      return value === void 0 || value.trim() === "" ? void 0 : value;
    };
    tenCharacters = /^[A-Za-z0-9]{10}$/;
  }
});

// src/doctor/server.ts
function sourceDetails(source) {
  return source.file ? [`read from ${describeSource(source)}`, "createPush takes the file's contents, not its path: the server's own variable must hold the text"] : [`read from ${describeSource(source)}`];
}
function fcmAdvice(detail) {
  const text3 = detail.toLowerCase();
  if (/short-lived|reasonable timeframe|\biat\b|\bexp\b|clock/.test(text3)) {
    return "the assertion's timestamps were refused: this machine's clock is off (compare `date -u` with a time server and fix the clock; Google accepts about five minutes of drift)";
  }
  if (/signature/.test(text3)) {
    return "Google does not accept the key's signature: the key was deleted or disabled (Google Cloud console, IAM and admin, Service accounts, Keys), or the private_key was changed; create a new key and set FCM_SERVICE_ACCOUNT again";
  }
  if (/invalid_client|oauth client|not a valid email|unauthorized_client/.test(text3)) {
    return "Google does not know this client_email as a service account of the key; use the key file of the service account as Google gave it";
  }
  if (/account not found|deleted|disabled/.test(text3)) {
    return "the service account was deleted or disabled (Google Cloud console, IAM and admin, Service accounts); use a key of a service account that exists";
  }
  return "Google refused the key: it was revoked or disabled, or the file was changed; create a new key (Google Cloud console, IAM and admin, Service accounts, Keys) and set FCM_SERVICE_ACCOUNT again";
}
async function fcmChecks(env, cwd, timeout) {
  const name = variables.fcmServiceAccount;
  const credential = readFcm(env, cwd);
  if (credential.state === "unset") return [{ group: group2, status: "skip", message: `${name} is not set: FCM (Android) is not configured here, nothing to check` }];
  if (credential.state === "invalid") return [{ group: group2, status: "fail", message: credential.problem, fix: `set ${name} to the service account key's JSON (or the path of its file): Firebase console, Project settings, Service accounts, Generate new private key (the role "Firebase Cloud Messaging API Admin")` }];
  const checks = [{
    group: group2,
    status: "pass",
    message: `${name} is a service account key for project ${credential.projectId} (${credential.clientEmail}) with a private key that loads as RSA`,
    details: sourceDetails(credential.source)
  }];
  const sender = createFcm(credential.options, timeout);
  if (sender === void 0) return checks;
  const result = await sender.verify();
  if (result.ok) {
    checks.push({ group: group2, status: "pass", message: `${credential.tokenHost} gave an access token for ${credential.clientEmail} (valid ${result.expiresIn} s): Google accepts the key` });
  } else if (result.reason === "auth") {
    checks.push({ group: group2, status: "fail", message: `${credential.tokenHost} refused the key${result.status ? ` (HTTP ${result.status})` : ""}: ${result.detail}`, fix: fcmAdvice(result.detail) });
  } else if (result.reason === "rate-limited") {
    checks.push({ group: group2, status: "unknown", message: `${credential.tokenHost} is rate limiting token requests (${result.detail})`, fix: "try again in a while" });
  } else {
    checks.push({ group: group2, status: "fail", message: `could not get an access token from ${credential.tokenHost}: ${result.detail}`, fix: `the server must reach ${credential.tokenHost} over HTTPS (a firewall or proxy may be in the way); if the failure is the provider's, try again` });
  }
  return checks;
}
function apnsAdvice(reason) {
  if (reason === "ExpiredProviderToken") return "APNs found the provider token expired: it is signed with the current time, so this machine's clock is off; fix the clock";
  if (reason === "InvalidProviderToken") {
    return "APNs does not accept the key with this key id and team id: APNS_KEY_ID must be the id of this very key (the .p8 is named AuthKey_<KEYID>.p8), APNS_TEAM_ID the team's (Apple Developer, Membership), and the key must not be revoked";
  }
  if (reason === "MissingProviderToken") return "APNs received no provider token: this is a fault of the doctor's request; report it";
  return "APNs refused the credentials: check APNS_KEY, APNS_KEY_ID and APNS_TEAM_ID against the key in the Apple Developer account (Certificates, Identifiers and Profiles, Keys), which must have Apple Push Notifications service enabled";
}
async function apnsChecks(env, cwd, timeout, app) {
  const credential = readApns(env, cwd);
  if (credential.state === "unset") return [{ group: group2, status: "skip", message: `${variables.apnsKey} is not set: APNs (iOS) is not configured here, nothing to check` }];
  if (credential.state === "invalid") return [{ group: group2, status: "fail", message: credential.problem, fix: `set ${variables.apnsKey} to the .p8's contents (or the path of the file), ${variables.apnsKeyId} to the key's id and ${variables.apnsTeamId} to the team's id (Apple Developer account, Keys: an APNs key with Apple Push Notifications service enabled)` }];
  const checks = [{
    group: group2,
    status: "pass",
    message: `${variables.apnsKey} loads as a P-256 key; key id ${credential.keyId}, team id ${credential.teamId}`,
    details: sourceDetails(credential.source)
  }];
  const sender = createApns(credential.options, timeout);
  if (sender === void 0) return checks;
  const topic = app ?? placeholderTopic;
  const host = credential.sandboxHost;
  try {
    const result = await sender.send({ provider: "apns", token: impossibleDeviceToken, environment: "development", app: topic }, { title: "expo-svelte doctor", body: "This device token does not exist." });
    if (result.ok) {
      checks.push({ group: group2, status: "pass", message: `${host} accepted a request signed with the key (it answered ok to a device token that cannot exist)` });
    } else if (result.reason === "invalid-token" && (result.detail === "BadDeviceToken" || result.detail === "DeviceTokenNotForTopic")) {
      checks.push({ group: group2, status: "pass", message: `${host} accepted the credentials: it signed in the provider token and then answered ${result.detail} to a device token that cannot exist` });
    } else if (result.reason === "auth") {
      checks.push({ group: group2, status: "fail", message: `${host} refused the credentials (HTTP ${result.status ?? "?"}): ${result.detail}`, fix: apnsAdvice(result.detail) });
    } else if (result.reason === "invalid-message" && /^(BadTopic|TopicDisallowed|MissingTopic)$/.test(result.detail)) {
      checks.push(app === void 0 ? { group: group2, status: "unknown", message: `${host} answered ${result.detail} to the placeholder topic ${topic}: it did not get as far as the device token, so the credentials are not confirmed`, fix: "run again with --app <the app's bundle id>, a topic that the key's team owns" } : { group: group2, status: "fail", message: `${host} answered ${result.detail} for the topic ${topic}: the key's team cannot push to it`, fix: `check that ${topic} is the app's bundle id, and that APNS_TEAM_ID is the team that owns the app` });
    } else if (result.reason === "rate-limited") {
      checks.push({ group: group2, status: "unknown", message: `${host} is rate limiting requests (${result.detail})`, fix: "try again in a while" });
    } else {
      checks.push({ group: group2, status: "fail", message: `could not get an answer to the credentials from ${host}: ${result.detail}${result.status ? ` (HTTP ${result.status})` : ""}`, fix: `the server must reach ${host} over HTTP/2 on port 443 (a firewall or proxy may be in the way); if the failure is Apple's, try again` });
    }
  } finally {
    await sender.close();
  }
  return checks;
}
async function serverChecks(options = {}) {
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  const timeout = options.timeout ?? 15e3;
  const checks = [...await fcmChecks(env, cwd, timeout), ...await apnsChecks(env, cwd, timeout, options.app)];
  if (checks.every((check) => check.status === "skip")) {
    checks.push({
      group: group2,
      status: "fail",
      message: "no push provider is configured in this environment: neither FCM_SERVICE_ACCOUNT nor APNS_KEY is set",
      fix: "set FCM_SERVICE_ACCOUNT (Android) and/or APNS_KEY, APNS_KEY_ID and APNS_TEAM_ID (iOS) in the server's environment, as the sender reads them"
    });
  }
  return checks;
}
var group2, placeholderTopic, impossibleDeviceToken;
var init_server = __esm({
  "src/doctor/server.ts"() {
    "use strict";
    init_apns();
    init_credentials();
    init_fcm();
    group2 = "push server";
    placeholderTopic = "com.example.expo-svelte-doctor";
    impossibleDeviceToken = "0".repeat(64);
  }
});

// src/doctor/index.ts
var doctor_exports = {};
__export(doctor_exports, {
  formatReport: () => formatReport,
  isRepositoryApp: () => isRepositoryApp,
  nodeVersion: () => nodeVersion,
  pnpmVersion: () => pnpmVersion,
  runChecks: () => runChecks,
  runDoctor: () => runDoctor
});
import { spawnSync as spawnSync2 } from "node:child_process";
import { existsSync as existsSync7, realpathSync as realpathSync3 } from "node:fs";
import { basename as basename2, dirname as dirname6, join as join10, resolve as resolve8 } from "node:path";
function formatReport(checks, { color = false, appRoot = "", title = "expo-svelte doctor" } = {}) {
  const paint = (status) => color ? `\x1B[${COLORS[status]}m${WORDS[status]}\x1B[0m` : WORDS[status];
  const lines = [`${title}${appRoot ? `: ${appRoot}` : ""}`];
  let group3;
  for (const check of checks) {
    if (check.group !== group3) {
      group3 = check.group;
      lines.push("", group3);
    }
    lines.push(`  ${paint(check.status)}  ${check.message}`);
    for (const detail of check.details ?? []) lines.push(`        ${detail}`);
    if (check.fix && (check.status === "fail" || check.status === "unknown")) lines.push(`        fix: ${check.fix}`);
  }
  const count2 = (status) => checks.filter((check) => check.status === status).length;
  lines.push("", `${count2("pass")} passed, ${count2("fail")} failed, ${count2("unknown")} could not tell, ${count2("skip")} skipped`);
  return `${lines.join("\n")}
`;
}
function nodeVersion() {
  if (!process.versions.bun) return process.versions.node;
  const result = spawnSync2("node", ["--version"], { encoding: "utf8", timeout: 15e3, shell: process.platform === "win32" });
  const version = result.status === 0 ? result.stdout.trim().replace(/^v/, "") : void 0;
  return version && /^\d+\.\d+\.\d+/.test(version) ? version : void 0;
}
function workspaceRoot(directory) {
  for (let current = directory; ; current = dirname6(current)) {
    if (existsSync7(join10(current, "pnpm-workspace.yaml"))) return current;
    if (dirname6(current) === current) return void 0;
  }
}
function isRepositoryApp(appRoot, packageRoot2) {
  const packages = dirname6(packageRoot2);
  if (basename2(packages) !== "packages") return false;
  try {
    const root2 = workspaceRoot(realpathSync3(appRoot));
    return root2 !== void 0 && root2 === realpathSync3(dirname6(packages));
  } catch {
    return false;
  }
}
function pnpmVersion(directory) {
  const result = spawnSync2("pnpm", ["--version"], { cwd: directory, encoding: "utf8", timeout: 6e4, shell: process.platform === "win32" });
  const version = result.status === 0 ? result.stdout.trim().split(/\r?\n/).pop() : void 0;
  return version && /^\d+\.\d+\.\d+/.test(version) ? version : void 0;
}
function parseArguments(args2) {
  const parsed = { json: false, server: false };
  for (let index = 0; index < args2.length; index++) {
    const arg = args2[index] ?? "";
    if (arg === "--json") parsed.json = true;
    else if (arg === "--server") parsed.server = true;
    else if (arg === "--app" || arg.startsWith("--app=")) {
      const value = arg === "--app" ? args2[++index] : arg.slice("--app=".length);
      if (value === void 0 || value === "" || value.startsWith("--")) return { ...parsed, problem: "--app needs the app's bundle id" };
      if (!/^[\x21-\x7e]+$/.test(value)) return { ...parsed, problem: "--app must be the app's bundle id (printable ASCII, no spaces)" };
      parsed.app = value;
    } else return { ...parsed, problem: `Unknown argument ${arg}` };
  }
  if (parsed.app !== void 0 && !parsed.server) return { ...parsed, problem: "--app goes with --server" };
  return parsed;
}
function runDoctor(root2, args2, out = process.stdout, context = {}, server = {}) {
  if (args2.includes("--help") || args2.includes("-h")) {
    out.write(USAGE2);
    return 0;
  }
  const parsed = parseArguments(args2);
  if (parsed.problem !== void 0) {
    out.write(`${parsed.problem}

${USAGE2}`);
    return 2;
  }
  const appRoot = resolve8(root2);
  const report2 = (checks, options) => {
    const failed = checks.some((check) => check.status === "fail");
    if (parsed.json) out.write(`${JSON.stringify({ ok: !failed, ...options.appRoot ? { appRoot: options.appRoot } : { server: true }, checks }, null, 2)}
`);
    else out.write(formatReport(checks, { color: out.isTTY === true && !process.env.NO_COLOR, ...options }));
    return failed ? 1 : 0;
  };
  if (parsed.server) {
    return serverChecks({ cwd: appRoot, ...parsed.app === void 0 ? {} : { app: parsed.app }, ...server }).then((checks) => report2(checks, { title: "expo-svelte doctor --server" }));
  }
  return report2(
    runChecks({
      appRoot,
      packageRoot,
      node: nodeVersion(),
      pnpm: () => pnpmVersion(appRoot),
      repository: isRepositoryApp(appRoot, packageRoot),
      ...context
    }),
    { appRoot }
  );
}
var USAGE2, WORDS, COLORS;
var init_doctor = __esm({
  "src/doctor/index.ts"() {
    "use strict";
    init_package_root();
    init_checks();
    init_server();
    init_checks();
    USAGE2 = `Usage: expo-svelte doctor [--json]
       expo-svelte doctor --server [--app <bundle id>] [--json]

Checks, from the app's directory, that the setup the library needs is complete: Node and pnpm, the custom-renderer Svelte, the peer
dependencies, the patches applied to the installed packages, and the app's Metro and Expo configs; and, when the app has push
(capabilities.push), its push setup: the Google services file, the iOS entitlement and background mode, and a prebuild as new as the config. One
line per check; the exit status is 1 when a required check fails.

  --json          print the checks as JSON instead of text
  --server        check the push server's environment instead of the app: FCM_SERVICE_ACCOUNT (the service account key's JSON, or the path of
                  its file), APNS_KEY (the .p8's PEM, or the path of its file), APNS_KEY_ID and APNS_TEAM_ID must load as the keys they are,
                  and one request each goes to Google's token endpoint and to the APNs sandbox to see that they are accepted. A provider whose
                  variables are unset is skipped. FCM_BASE_URL, FCM_TOKEN_URL, APNS_PRODUCTION_URL and APNS_SANDBOX_URL replace the endpoints.
  --app <id>      with --server: the app's bundle id, the topic of the APNs request (default: a placeholder, which APNs may refuse as a topic)
`;
    WORDS = { pass: "pass", fail: "FAIL", skip: "skip", unknown: "????" };
    COLORS = { pass: "32", fail: "31", skip: "2", unknown: "33" };
  }
});

// src/push/server.ts
import { inspect } from "node:util";
function checkText(name, value) {
  if (value !== void 0 && typeof value !== "string") throw new TypeError(`${name} must be a string, not ${show(value)}.`);
}
function checkName(name, value) {
  if (typeof value !== "string" || value === "") throw new TypeError(`${name} must be a non-empty string, not ${show(value)}.`);
}
function checkToken(token) {
  if (typeof token !== "object" || token === null) throw new TypeError(`A push token is the { provider, token, app } the device saved, not ${show(token)}.`);
  if (token.provider !== "fcm" && token.provider !== "apns") throw new TypeError(`The token's \`provider\` must be "fcm" or "apns", not ${show(token.provider)}.`);
  checkName("The token's `token`", token.token);
  checkName("The token's `app`", token.app);
  if (token.environment !== void 0 && token.environment !== "development" && token.environment !== "production") {
    throw new TypeError(`The token's \`environment\` must be "development" or "production", not ${show(token.environment)}.`);
  }
}
function checkMessage(message) {
  if (typeof message !== "object" || message === null) throw new TypeError(`A message is an object such as { title, body, url }, not ${show(message)}.`);
  checkText("`title`", message.title);
  checkText("`body`", message.body);
  checkText("`url`", message.url);
  if (message.collapseKey !== void 0) checkName("`collapseKey`", message.collapseKey);
  if (message.channel !== void 0) checkName("`channel`", message.channel);
  if (message.silent !== void 0 && typeof message.silent !== "boolean") throw new TypeError(`\`silent\` must be a boolean, not ${show(message.silent)}.`);
  if (message.badge !== void 0 && (!Number.isInteger(message.badge) || message.badge < 0)) throw new TypeError(`\`badge\` must be a whole number of 0 or more, not ${show(message.badge)}.`);
  if (message.sound !== void 0 && message.sound !== null && message.sound !== "default") throw new TypeError(`\`sound\` must be "default" or null, not ${show(message.sound)}.`);
  if (message.priority !== void 0 && message.priority !== "high" && message.priority !== "normal") throw new TypeError(`\`priority\` must be "high" or "normal", not ${show(message.priority)}.`);
  if (message.ttl !== void 0 && (!Number.isInteger(message.ttl) || message.ttl < 0)) throw new TypeError(`\`ttl\` must be a whole number of seconds, 0 or more, not ${show(message.ttl)}.`);
  if (message.data !== void 0) {
    if (typeof message.data !== "object" || message.data === null || Array.isArray(message.data)) throw new TypeError(`\`data\` must be an object of strings, not ${show(message.data)}.`);
    for (const [key, value] of Object.entries(message.data)) {
      if (typeof value !== "string") throw new TypeError(`\`data.${key}\` must be a string (both providers carry strings only), not ${show(value)}.`);
    }
    if (message.url !== void 0 && Object.hasOwn(message.data, "url")) throw new TypeError("`url` is carried as the data key `url`: pass the link as `url`, not also in `data`.");
  }
  if (message.silent) {
    for (const name of ["title", "body", "badge", "sound", "channel"]) {
      if (message[name] !== void 0 && message[name] !== null) throw new TypeError(`A \`silent\` message shows nothing, so it has no \`${name}\`.`);
    }
  } else if (!message.title && !message.body) {
    throw new TypeError("A notification needs a `title` or a `body`; a message for the app's background hook is `silent: true`.");
  }
}
function createPush(options = {}) {
  const timeout = options.timeout ?? DEFAULT_TIMEOUT;
  if (typeof timeout !== "number" || !Number.isFinite(timeout) || timeout <= 0 || timeout > MAX_TIMEOUT) throw new TypeError(`\`timeout\` must be a number of milliseconds above 0 and at most ${MAX_TIMEOUT}, not ${show(timeout)}.`);
  const fcm = createFcm(options.fcm, timeout);
  const apns = createApns(options.apns, timeout);
  let closed = false;
  const pending = /* @__PURE__ */ new Set();
  return {
    async send(token, message) {
      checkToken(token);
      checkMessage(message);
      const sender = token.provider === "fcm" ? fcm : apns;
      if (sender === void 0) {
        throw new TypeError(token.provider === "fcm" ? "A send to an FCM token needs `fcm: { serviceAccount }` in createPush's options." : "A send to an APNs token needs `apns: { key, keyId, teamId }` in createPush's options.");
      }
      if (closed) return failure("unavailable", "The sender was closed.");
      const work = deliver(sender, token, message);
      const settled = work.then(
        () => void 0,
        () => void 0
      );
      pending.add(settled);
      void settled.then(() => pending.delete(settled));
      return work;
    },
    async close() {
      closed = true;
      await Promise.all(pending);
      await apns?.close();
    }
  };
}
async function deliver(sender, token, message) {
  try {
    return await sender.send(token, message);
  } catch (error) {
    if (error instanceof TypeError) throw error;
    return failure("error", error instanceof Error ? error.message : String(error));
  }
}
var DEFAULT_TIMEOUT, MAX_TIMEOUT, show;
var init_server2 = __esm({
  "src/push/server.ts"() {
    "use strict";
    init_apns();
    init_common();
    init_fcm();
    DEFAULT_TIMEOUT = 3e4;
    MAX_TIMEOUT = 2147483647;
    show = (value) => inspect(value, { depth: 0 });
  }
});

// src/push/cli.ts
var cli_exports = {};
__export(cli_exports, {
  runPush: () => runPush
});
import { resolve as resolve9 } from "node:path";
function parseFlags(args2) {
  const values = /* @__PURE__ */ new Map();
  const switches = /* @__PURE__ */ new Set();
  for (let index = 0; index < args2.length; index++) {
    const arg = args2[index] ?? "";
    if (!arg.startsWith("--")) throw new UsageError(arg.startsWith("-") ? `Unknown option ${arg}` : `Unexpected argument ${arg}`);
    const equals = arg.indexOf("=");
    const name = arg.slice(2, equals < 0 ? void 0 : equals);
    if (SWITCHES.includes(name)) {
      if (equals >= 0) throw new UsageError(`--${name} takes no value`);
      switches.add(name);
      continue;
    }
    if (!VALUE_FLAGS.includes(name)) throw new UsageError(`Unknown option --${name}`);
    let value;
    if (equals >= 0) value = arg.slice(equals + 1);
    else {
      value = args2[index + 1];
      if (value === void 0 || value.startsWith("--")) throw new UsageError(`--${name} needs a value`);
      index++;
    }
    const seen = values.get(name) ?? [];
    if (seen.length > 0 && !REPEATED.has(name)) throw new UsageError(`--${name} is given twice`);
    values.set(name, [...seen, value]);
  }
  return { values, switches };
}
function wholeNumber(flags, name) {
  const value = flags.values.get(name)?.[0];
  if (value === void 0) return void 0;
  if (!/^\d+$/.test(value)) throw new UsageError(`--${name} must be a whole number of 0 or more`);
  return Number(value);
}
function choice(flags, name, allowed) {
  const value = flags.values.get(name)?.[0];
  if (value === void 0) return void 0;
  if (!allowed.includes(value)) throw new UsageError(`--${name} must be ${allowed.join(" or ")}`);
  return value;
}
function tokenOf(flags) {
  const given = flags.values.get("token")?.[0];
  if (given === void 0) throw new UsageError("--token is needed: the device's token (the PushToken's JSON, or a raw token with --provider and --app)");
  const provider = choice(flags, "provider", ["fcm", "apns"]);
  const app = flags.values.get("app")?.[0];
  const environment2 = choice(flags, "environment", ["development", "production"]);
  if (given.trim().startsWith("{")) {
    if (provider !== void 0 || app !== void 0 || environment2 !== void 0) throw new UsageError("--token is a PushToken's JSON, which has its provider, app and environment: --provider, --app and --environment are for a raw token");
    let parsed;
    try {
      parsed = JSON.parse(given);
    } catch {
      throw new UsageError("--token starts with { but is not valid JSON: pass the PushToken as `push.subscribe`'s save received it");
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new UsageError("--token must be a PushToken's JSON object");
    const token = parsed;
    if (token.provider !== "fcm" && token.provider !== "apns") throw new UsageError(`The token's "provider" must be "fcm" or "apns"`);
    if (typeof token.token !== "string" || token.token === "") throw new UsageError(`The token's "token" must be a text that is not empty`);
    if (typeof token.app !== "string" || token.app === "") throw new UsageError(`The token's "app" must be a text that is not empty: the Android package or the iOS bundle id`);
    if (token.environment !== void 0 && token.environment !== "development" && token.environment !== "production") throw new UsageError(`The token's "environment" must be "development" or "production"`);
    return { provider: token.provider, token: token.token, app: token.app, ...token.environment === void 0 ? {} : { environment: token.environment } };
  }
  if (provider === void 0) throw new UsageError("A raw --token needs --provider fcm|apns (or pass the PushToken's JSON)");
  if (app === void 0) throw new UsageError("A raw --token needs --app: the Android package or the iOS bundle id");
  if (provider === "apns" && environment2 === void 0) throw new UsageError("An APNs --token needs --environment development|production: the token belongs to one APNs, and the other answers BadDeviceToken");
  if (provider === "fcm" && environment2 !== void 0) throw new UsageError("--environment is for an APNs token");
  return { provider, token: given, app, ...environment2 === void 0 ? {} : { environment: environment2 } };
}
function messageOf(flags) {
  const message = {};
  const text3 = (flag, key) => {
    const value = flags.values.get(flag)?.[0];
    if (value !== void 0) message[key] = value;
  };
  text3("title", "title");
  text3("body", "body");
  text3("url", "url");
  text3("channel", "channel");
  const collapseKey = flags.values.get("collapse-key")?.[0];
  if (collapseKey !== void 0) message.collapseKey = collapseKey;
  const data = flags.values.get("data");
  if (data !== void 0) {
    message.data = {};
    for (const entry of data) {
      const equals = entry.indexOf("=");
      if (equals < 1) throw new UsageError("--data takes key=value, with a key");
      const key = entry.slice(0, equals);
      if (Object.hasOwn(message.data, key)) throw new UsageError(`--data ${key} is given twice`);
      message.data[key] = entry.slice(equals + 1);
    }
  }
  if (flags.switches.has("silent")) message.silent = true;
  const badge = wholeNumber(flags, "badge");
  if (badge !== void 0) message.badge = badge;
  const ttl = wholeNumber(flags, "ttl");
  if (ttl !== void 0) message.ttl = ttl;
  const sound = choice(flags, "sound", ["default", "none"]);
  if (sound !== void 0) message.sound = sound === "none" ? null : "default";
  const priority = choice(flags, "priority", ["high", "normal"]);
  if (priority !== void 0) message.priority = priority;
  return message;
}
function optionsFor(token, io) {
  const timeout = io.timeout === void 0 ? {} : { timeout: io.timeout };
  if (token.provider === "fcm") {
    const fcm = readFcm(io.env, io.cwd);
    if (fcm.state === "unset") throw new UsageError(`${variables.fcmServiceAccount} is not set: an FCM token is sent with the service account key (its JSON, or the path of its file)`);
    if (fcm.state === "invalid") throw new UsageError(fcm.problem);
    return { fcm: fcm.options, ...timeout };
  }
  const apns = readApns(io.env, io.cwd);
  if (apns.state === "unset") throw new UsageError(`${variables.apnsKey}, ${variables.apnsKeyId} and ${variables.apnsTeamId} are not set: an APNs token is sent with the .p8 key (its PEM, or the path of its file), its key id and the team id`);
  if (apns.state === "invalid") throw new UsageError(apns.problem);
  return { apns: apns.options, ...timeout };
}
function report(result, token, json) {
  if (json) return `${JSON.stringify(result, null, 2)}
`;
  if (result.ok) return `sent to ${token.provider} (${token.app}): ${result.id}
`;
  const lines = [`not sent (${token.provider}, ${token.app}): ${result.reason}${result.status === void 0 ? "" : ` (HTTP ${result.status})`}: ${result.detail}`];
  if (result.retryAfter !== void 0) lines.push(`retry after ${result.retryAfter} ms`);
  lines.push(ADVICE[result.reason]);
  return `${lines.join("\n")}
`;
}
async function runPush(root2, args2, io = {}) {
  const full = { out: process.stdout, err: process.stderr, env: process.env, cwd: resolve9(root2), ...io };
  const [command2, ...rest] = args2;
  if (command2 === "--help" || command2 === "-h" || command2 === "help") {
    full.out.write(USAGE3);
    return 0;
  }
  if (command2 === void 0) {
    full.err.write(`Missing command

${USAGE3}`);
    return 2;
  }
  if (command2 !== "send") {
    full.err.write(`Unknown command ${command2}

${USAGE3}`);
    return 2;
  }
  if (rest.includes("--help") || rest.includes("-h")) {
    full.out.write(SEND_USAGE);
    return 0;
  }
  let token;
  let message;
  let options;
  let json;
  try {
    const flags = parseFlags(rest);
    json = flags.switches.has("json");
    token = tokenOf(flags);
    message = messageOf(flags);
    options = optionsFor(token, full);
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    full.err.write(`expo-svelte push send: ${error.message}

Run \`expo-svelte push send --help\` for the options.
`);
    return 2;
  }
  let push;
  try {
    push = createPush(options);
    const result = await push.send(token, message);
    full.out.write(report(result, token, json));
    return result.ok ? 0 : 1;
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
    full.err.write(`expo-svelte push send: ${error.message}
`);
    return 2;
  } finally {
    await push?.close();
  }
}
var SEND_USAGE, USAGE3, VALUE_FLAGS, REPEATED, SWITCHES, UsageError, ADVICE;
var init_cli = __esm({
  "src/push/cli.ts"() {
    "use strict";
    init_credentials();
    init_server2();
    SEND_USAGE = `Usage: expo-svelte push send --token <token> [options]

Sends one message to one device with the credentials of the server's environment (the variables \`expo-svelte doctor --server\` checks), and prints what the provider
answered. Exits 0 when the message was accepted, 1 when it was not, and 2 when nothing was sent because an argument or the environment is not usable.

Which device:
  --token <token>        the device's token: the JSON of the PushToken exactly as \`push.subscribe\`'s save received it
                         ({"provider":"fcm","token":"…","app":"io.example.app"}), or a raw token string, with the three options below
  --provider fcm|apns    a raw token's provider
  --app <id>             a raw token's app: the Android package or the iOS bundle id (the APNs topic)
  --environment <env>    an APNs raw token's environment: development or production (which APNs host it is sent to)

The message (a notification needs a title or a body; a silent one neither):
  --title <text>         the notification's title
  --body <text>          the notification's text
  --url <link>           the link a tap opens: a path of the app (/orders/42) or a full link
  --data key=value       a data entry (repeat it for more); strings only
  --silent               a data message: nothing is shown, the app's background hook gets it
  --badge <n>            iOS: the badge number
  --sound default|none   default: the default sound; none: no sound
  --channel <id>         Android: the notification channel's id
  --collapse-key <key>   a newer message with the same key replaces the older one
  --priority high|normal
  --ttl <seconds>        how long the provider keeps the message for a device that is offline

Output:
  --json                 print the result as JSON ({"ok":true,"id":…} or {"ok":false,"reason":…,"detail":…})

Environment (nothing is passed on the command line, so no key lands in a shell history):
  FCM_SERVICE_ACCOUNT    the service account key's JSON, or the path of its file (Android tokens)
  APNS_KEY               the .p8's PEM, or the path of its file; with APNS_KEY_ID and APNS_TEAM_ID (iOS tokens)
  FCM_BASE_URL, FCM_TOKEN_URL, APNS_PRODUCTION_URL, APNS_SANDBOX_URL   replace the provider's endpoints (tests, proxies)
`;
    USAGE3 = `Usage: expo-svelte push <command>

  send     send one message to one device with the server's credentials; \`push send --help\` lists its options
`;
    VALUE_FLAGS = ["token", "provider", "app", "environment", "title", "body", "url", "data", "badge", "sound", "channel", "collapse-key", "priority", "ttl"];
    REPEATED = /* @__PURE__ */ new Set(["data"]);
    SWITCHES = ["silent", "json", "help"];
    UsageError = class extends Error {
    };
    ADVICE = {
      gone: "the token will never work again (uninstalled, expired, unregistered): delete it",
      "invalid-token": "the provider does not take this token for this app or environment; do not retry it as it is",
      "invalid-message": "the provider refused the message itself; do not retry it as it is",
      "rate-limited": "try again later",
      unavailable: "the provider could not be reached or did not answer: try again later",
      auth: "the server's credentials are wrong or revoked: run `expo-svelte doctor --server`",
      error: "the provider answered something the sender cannot place; the detail is its own text"
    };
  }
});

// src/autolinking.ts
var autolinking_exports = {};
__export(autolinking_exports, {
  deferNitroLibraries: () => deferNitroLibraries,
  deferredNitroPackages: () => deferredNitroPackages,
  nitroPackage: () => nitroPackage,
  relinkedPackage: () => relinkedPackage,
  runAndroidAutolinking: () => runAndroidAutolinking,
  runIosAutolinking: () => runIosAutolinking,
  splitLinks: () => splitLinks
});
import { spawnSync as spawnSync3 } from "node:child_process";
function relinkedPackage(name) {
  const deferred = deferredNitroPackages[name];
  if (deferred) return { packageImportPath: `import ${core}.DeferredNitroPackage;`, packageInstance: `new DeferredNitroPackage("${deferred.library}")` };
  if (name === nitroPackage.name) return { packageImportPath: `import ${core}.NitroGate;`, packageInstance: "new NitroGate(new com.margelo.nitro.NitroModulesPackage())" };
  return void 0;
}
function deferNitroLibraries(config) {
  const dependencies = config.dependencies ?? {};
  if (!linkedAsDefault(dependencies[nitroPackage.name]?.platforms?.android, nitroPackage)) return config;
  const deferred = Object.keys(deferredNitroPackages).filter((name) => linkedAsDefault(dependencies[name]?.platforms?.android, deferredNitroPackages[name]));
  if (deferred.length === 0) return config;
  const relinked = { ...dependencies };
  for (const name of [...deferred, nitroPackage.name]) {
    const dependency = dependencies[name];
    relinked[name] = { ...dependency, platforms: { ...dependency.platforms, android: { ...dependency.platforms.android, ...relinkedPackage(name) } } };
  }
  return { ...config, dependencies: relinked };
}
function splitLinks(argv) {
  const link = [];
  let index = 0;
  while (argv[index] === "--link") {
    const name = argv[index + 1];
    if (name === void 0) break;
    link.push(name);
    index += 2;
  }
  return { link, command: argv.slice(index) };
}
function runAutolinking(name, platform, given, transform) {
  const { link, command: command2 } = splitLinks(given);
  const [program, ...args2] = command2;
  if (!program) {
    console.error(`expo-svelte ${name}: no command (${platform === "android" ? "settings.gradle" : "the Podfile"} gives it React Native's config command)`);
    return 2;
  }
  const result = spawnSync3(program, args2, { encoding: "utf8", stdio: ["inherit", "pipe", "inherit"], maxBuffer: 256 * 1024 * 1024 });
  if (result.error) {
    console.error(`expo-svelte ${name}: could not run ${program}: ${result.error.message}`);
    return 1;
  }
  if (result.status !== 0) {
    process.stdout.write(result.stdout);
    return result.status ?? 1;
  }
  let config;
  try {
    config = JSON.parse(result.stdout);
  } catch {
    process.stdout.write(result.stdout);
    return 0;
  }
  if (config === null || typeof config !== "object" || Array.isArray(config)) {
    process.stdout.write(result.stdout);
    return 0;
  }
  try {
    process.stdout.write(JSON.stringify(transform(linkVendored(config, platform, void 0, link))));
  } catch (error) {
    if (!(error instanceof VendoredCollision)) throw error;
    console.error(`expo-svelte ${name}: ${error.message}`);
    return 1;
  }
  return 0;
}
var core, deferredNitroPackages, nitroPackage, linkedAsDefault, runAndroidAutolinking, runIosAutolinking;
var init_autolinking = __esm({
  "src/autolinking.ts"() {
    "use strict";
    init_vendored();
    core = "expo.modules.sveltecore";
    deferredNitroPackages = {
      "react-native-mmkv": { packageImportPath: "import com.margelo.nitro.mmkv.NitroMmkvPackage;", packageInstance: "new NitroMmkvPackage()", library: "NitroMmkv" },
      "react-native-quick-crypto": { packageImportPath: "import com.margelo.nitro.quickcrypto.QuickCryptoPackage;", packageInstance: "new QuickCryptoPackage()", library: "QuickCrypto" }
    };
    nitroPackage = { name: "react-native-nitro-modules", packageImportPath: "import com.margelo.nitro.NitroModulesPackage;", packageInstance: "new NitroModulesPackage()" };
    linkedAsDefault = (android, linked) => android != null && android.packageImportPath === linked.packageImportPath && android.packageInstance === linked.packageInstance;
    runAndroidAutolinking = (command2) => runAutolinking("android-autolinking", "android", command2, deferNitroLibraries);
    runIosAutolinking = (command2) => runAutolinking("ios-autolinking", "ios", command2, (config) => config);
  }
});

// src/css/parse.ts
function readChunk(css, from) {
  let text3 = "";
  let depth = 0;
  let i = from;
  let space = false;
  while (i < css.length) {
    const c = css[i];
    if (c === "/" && css[i + 1] === "*") {
      const close = css.indexOf("*/", i + 2);
      i = close < 0 ? css.length : close + 2;
      space = true;
      continue;
    }
    if (c === "\\") {
      if (space && text3 !== "") text3 += " ";
      space = false;
      text3 += c + (css[i + 1] ?? "");
      i += 2;
      continue;
    }
    if (c === '"' || c === "'") {
      if (space && text3 !== "") text3 += " ";
      space = false;
      let j = i + 1;
      while (j < css.length && css[j] !== c) j += css[j] === "\\" ? 2 : 1;
      text3 += css.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    if (depth === 0 && (c === ";" || c === "{" || c === "}")) break;
    if (c === "(" || c === "[") depth++;
    else if (c === ")" || c === "]") depth = Math.max(0, depth - 1);
    if (c === " " || c === "\n" || c === "	" || c === "\r" || c === "\f") {
      space = true;
      i++;
      continue;
    }
    if (space && text3 !== "") text3 += " ";
    space = false;
    text3 += c;
    i++;
  }
  return { text: text3, end: i };
}
function skipBlank(css, from) {
  let i = from;
  while (i < css.length) {
    const c = css[i];
    if (c === " " || c === "\n" || c === "	" || c === "\r" || c === "\f") i++;
    else if (c === "/" && css[i + 1] === "*") {
      const close = css.indexOf("*/", i + 2);
      i = close < 0 ? css.length : close + 2;
    } else break;
  }
  return i;
}
function parseBody(css, from, nested) {
  const items = [];
  let i = from;
  while (true) {
    i = skipBlank(css, i);
    if (i >= css.length) return { items, end: i };
    const c = css[i];
    if (c === "}" && nested) return { items, end: i + 1 };
    if (c === ";" || c === "}") {
      i++;
      continue;
    }
    if (c === "@") {
      const { text: text4, end: end2 } = readChunk(css, i + 1);
      const space = text4.search(/[\s(]/);
      const name = (space < 0 ? text4 : text4.slice(0, space)).toLowerCase();
      const prelude = space < 0 ? "" : text4.slice(space).trim();
      if (css[end2] === "{") {
        const inner = parseBody(css, end2 + 1, true);
        items.push({ kind: "at", name, prelude, body: inner.items });
        i = inner.end;
      } else {
        items.push({ kind: "at", name, prelude, body: null });
        i = end2 + 1;
      }
      continue;
    }
    const { text: text3, end } = readChunk(css, i);
    if (css[end] === "{") {
      const inner = parseBody(css, end + 1, true);
      items.push({ kind: "rule", selector: text3, body: inner.items });
      i = inner.end;
      continue;
    }
    i = css[end] === ";" ? end + 1 : end;
    const colon = indexOfTop(text3, ":");
    if (colon <= 0) continue;
    const property = text3.slice(0, colon).trim();
    let value = text3.slice(colon + 1).trim();
    let important = false;
    const bang = /\s*!\s*important\s*$/i.exec(value);
    if (bang) {
      important = true;
      value = value.slice(0, bang.index);
    }
    items.push({ kind: "decl", property: property.startsWith("--") ? property : property.toLowerCase(), value, important });
  }
}
function parseCss(css) {
  return parseBody(css, 0, false).items;
}
function indexOfTop(text3, char) {
  let depth = 0;
  for (let i = 0; i < text3.length; i++) {
    const c = text3[i];
    if (c === "\\") i++;
    else if (c === '"' || c === "'") {
      i++;
      while (i < text3.length && text3[i] !== c) i += text3[i] === "\\" ? 2 : 1;
    } else if (c === "(" || c === "[") depth++;
    else if (c === ")" || c === "]") depth--;
    else if (depth === 0 && c === char) return i;
  }
  return -1;
}
function splitTop(text3, separator) {
  const parts = [];
  let depth = 0;
  let start = 0;
  const push = (end) => {
    const part = text3.slice(start, end).trim();
    if (part !== "" || separator === ",") parts.push(part);
  };
  for (let i = 0; i < text3.length; i++) {
    const c = text3[i];
    if (c === "\\") i++;
    else if (c === '"' || c === "'") {
      i++;
      while (i < text3.length && text3[i] !== c) i += text3[i] === "\\" ? 2 : 1;
    } else if (c === "(" || c === "[") depth++;
    else if (c === ")" || c === "]") depth--;
    else if (depth === 0 && (separator === "," ? c === "," : c === " ")) {
      push(i);
      start = i + 1;
    }
  }
  push(text3.length);
  return parts;
}
function readIdent(text3, from) {
  let name = "";
  let i = from;
  while (i < text3.length) {
    const c = text3[i];
    if (c === "\\") {
      const hex = /^[0-9a-fA-F]{1,6}/.exec(text3.slice(i + 1, i + 7));
      if (hex) {
        const code = Number.parseInt(hex[0], 16);
        name += String.fromCodePoint(code === 0 || code > 1114111 ? 65533 : code);
        i += 1 + hex[0].length;
        if (/\s/.test(text3[i] ?? "")) i++;
      } else {
        name += text3[i + 1] ?? "";
        i += 2;
      }
    } else if (/[\w-]/.test(c) || c.charCodeAt(0) > 127) {
      name += c;
      i++;
    } else break;
  }
  return { name, end: i };
}
function classifySelector(selector) {
  const text3 = selector.trim();
  if (ROOT_SELECTORS.has(text3)) return { kind: "root" };
  if (text3[0] === "." && text3.length > 1) {
    const { name, end } = readIdent(text3, 1);
    if (end === text3.length && name !== "") return { kind: "class", className: name };
  }
  return { kind: "unsupported", className: firstClass(text3), reason: describeSelector(text3) };
}
function firstClass(text3) {
  for (let i = 0; i < text3.length; i++) {
    const c = text3[i];
    if (c === "\\") i++;
    else if (c === '"' || c === "'") {
      i++;
      while (i < text3.length && text3[i] !== c) i += text3[i] === "\\" ? 2 : 1;
    } else if (c === "[") {
      const close = text3.indexOf("]", i);
      i = close < 0 ? text3.length : close;
    } else if (c === ".") {
      const { name, end } = readIdent(text3, i + 1);
      if (name !== "") return name;
      i = end;
    }
  }
  return null;
}
function describeSelector(text3) {
  const pseudo = [];
  for (let i = 0; i < text3.length; i++) {
    const c = text3[i];
    if (c === "\\") i++;
    else if (c === ":") {
      const element2 = text3[i + 1] === ":";
      const { name, end } = readIdent(text3, i + (element2 ? 2 : 1));
      pseudo.push({ element: element2, name });
      i = end - 1;
    }
  }
  const element = pseudo.find((p) => p.element);
  if (element) return `pseudo-element ::${element.name} (selector ${text3})`;
  if (/[>~]|\s\+\s/.test(text3)) return `combinator in selector ${text3}`;
  const wrappers = /* @__PURE__ */ new Set(["is", "where", "not", "has", "matches"]);
  const named = pseudo.find((p) => !wrappers.has(p.name));
  if (named) return `pseudo-class :${named.name} (selector ${text3})`;
  if (pseudo.length > 0) return `functional pseudo-class :${pseudo[0].name}() depends on other elements (selector ${text3})`;
  if (splitTop(text3, " ").length > 1) return `combinator in selector ${text3}`;
  if (text3.startsWith(".") && text3.indexOf(".", 1) > 0) return `several classes in selector ${text3}`;
  if (text3[0] !== ".") return `not a class selector (${text3})`;
  return `selector ${text3} is not a single class`;
}
var ROOT_SELECTORS;
var init_parse = __esm({
  "src/css/parse.ts"() {
    "use strict";
    ROOT_SELECTORS = /* @__PURE__ */ new Set([":root", ":host", "html"]);
  }
});

// src/css/color.ts
function toLinear(c) {
  const s = Math.sign(c);
  const v = Math.abs(c);
  return s * (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
}
function toGamma(x) {
  const s = Math.sign(x);
  const v = Math.abs(x);
  return s * (v <= 31308e-7 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);
}
function oklabToSrgb([L, a, b]) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    toGamma(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    toGamma(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    toGamma(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s)
  ];
}
function srgbToOklab([r, g, b]) {
  const lr = toLinear(r);
  const lg = toLinear(g);
  const lb = toLinear(b);
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  ];
}
function hex2(v) {
  return Math.round(clamp01(v) * 255).toString(16).padStart(2, "0");
}
function toRgbString(color) {
  const srgb = color.space === "srgb" ? color.c : oklabToSrgb(color.c);
  const alpha = clamp01(color.alpha);
  if (alpha >= 1) return `#${hex2(srgb[0])}${hex2(srgb[1])}${hex2(srgb[2])}`;
  const channel = (v) => Math.round(clamp01(v) * 255);
  return `rgba(${channel(srgb[0])}, ${channel(srgb[1])}, ${channel(srgb[2])}, ${Number(alpha.toFixed(3))})`;
}
function toOklab(color) {
  return color.space === "oklab" ? color.c : srgbToOklab(color.c);
}
function toSrgb(color) {
  return color.space === "srgb" ? color.c : oklabToSrgb(color.c);
}
function component(text3, percentScale) {
  if (text3 === "none") return 0;
  const match = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)(%?)$/i.exec(text3);
  if (!match) return null;
  const n = Number(match[1]);
  return match[2] === "%" ? n / 100 * percentScale : n;
}
function angle(text3) {
  if (text3 === "none") return 0;
  const match = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)(deg|grad|rad|turn)?$/i.exec(text3);
  if (!match) return null;
  const n = Number(match[1]);
  switch ((match[2] ?? "deg").toLowerCase()) {
    case "grad":
      return n * 0.9;
    case "rad":
      return n * 180 / Math.PI;
    case "turn":
      return n * 360;
    default:
      return n;
  }
}
function alphaOf(text3) {
  if (text3 === void 0) return 1;
  const value = component(text3, 1);
  return value === null ? null : clamp01(value);
}
function functionArgs(inner) {
  const slash = indexOfTop(inner, "/");
  if (slash >= 0) return { channels: splitTop(inner.slice(0, slash).replaceAll(",", " "), " "), alpha: inner.slice(slash + 1).trim() };
  const commas = splitTop(inner, ",");
  if (commas.length > 1) return { channels: commas.slice(0, 3), alpha: commas[3] };
  const spaced = splitTop(inner, " ");
  return { channels: spaced.slice(0, 3), alpha: spaced[3] };
}
function parseFunction(name, inner) {
  const { channels, alpha: alphaText } = functionArgs(inner);
  if (channels.length !== 3) return { error: `${name}() takes three channels` };
  const alpha = alphaOf(alphaText);
  if (alpha === null) return { error: `alpha ${alphaText} is not a number` };
  const [x, y, z] = channels;
  switch (name) {
    case "rgb":
    case "rgba": {
      const r = component(x, 255);
      const g = component(y, 255);
      const b = component(z, 255);
      if (r === null || g === null || b === null) return { error: `rgb(${inner}) is not understood` };
      return { space: "srgb", c: [r / 255, g / 255, b / 255], alpha };
    }
    case "hsl":
    case "hsla": {
      const h = angle(x);
      const s = component(y, 1);
      const l = component(z, 1);
      if (h === null || s === null || l === null) return { error: `hsl(${inner}) is not understood` };
      return { space: "srgb", c: hslToSrgb(h, clamp01(s), clamp01(l)), alpha };
    }
    case "oklab": {
      const L = component(x, 1);
      const a = component(y, 0.4);
      const b = component(z, 0.4);
      if (L === null || a === null || b === null) return { error: `oklab(${inner}) is not understood` };
      return { space: "oklab", c: [L, a, b], alpha };
    }
    case "oklch": {
      const L = component(x, 1);
      const C = component(y, 0.4);
      const h = angle(z);
      if (L === null || C === null || h === null) return { error: `oklch(${inner}) is not understood` };
      const rad = h * Math.PI / 180;
      return { space: "oklab", c: [L, C * Math.cos(rad), C * Math.sin(rad)], alpha };
    }
    default:
      return { error: `${name}() is not supported` };
  }
}
function hslToSrgb(h, s, l) {
  const hue = (h % 360 + 360) % 360 / 30;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => {
    const k = (n + hue) % 12;
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [f(0), f(8), f(4)];
}
function parseHex(text3) {
  const digits = text3.slice(1);
  if (!/^[0-9a-f]+$/i.test(digits) || ![3, 4, 6, 8].includes(digits.length)) return { error: `${text3} is not a hex color` };
  const full = digits.length <= 4 ? [...digits].map((d) => d + d).join("") : digits;
  const byte = (i) => Number.parseInt(full.slice(i * 2, i * 2 + 2), 16) / 255;
  return { space: "srgb", c: [byte(0), byte(1), byte(2)], alpha: full.length === 8 ? byte(3) : 1 };
}
function parseColor(text3) {
  const value = text3.trim();
  const lower = value.toLowerCase();
  if (value.startsWith("#")) return parseHex(value);
  if (lower === "transparent") return { space: "srgb", c: [0, 0, 0], alpha: 0 };
  const hexOfName = Object.hasOwn(NAMED, lower) ? NAMED[lower] : void 0;
  if (hexOfName !== void 0) return parseHex(`#${hexOfName}`);
  if (lower === "currentcolor" || lower === "inherit") return { error: `${lower} depends on the element and is not supported` };
  const open = value.indexOf("(");
  if (open > 0 && value.endsWith(")")) {
    const name = lower.slice(0, open);
    const inner = value.slice(open + 1, -1).trim();
    if (name === "color-mix") return parseColorMix(inner);
    return parseFunction(name, inner);
  }
  return { error: `${value} is not a color this converter understands` };
}
function parseColorMix(inner) {
  const parts = splitTop(inner, ",");
  const method = /^in\s+(\S+)(?:\s+(shorter|longer|increasing|decreasing)\s+hue)?$/i.exec(parts[0] ?? "");
  if (!method || parts.length !== 3) return { error: `color-mix(${inner}) is not understood` };
  const space = method[1].toLowerCase();
  if (space !== "srgb" && space !== "oklab" && space !== "oklch") return { error: `color-mix in ${space} is not supported (srgb, oklab and oklch are)` };
  if (method[2] !== void 0 && method[2].toLowerCase() !== "shorter") return { error: "color-mix hue interpolation other than shorter is not supported" };
  const entries = [];
  for (const part of parts.slice(1)) {
    let percent = null;
    let text3 = part;
    const lead = /^(\d+\.?\d*|\.\d+)%\s+(.+)$/.exec(part);
    const tail = /^(.+?)\s+(\d+\.?\d*|\.\d+)%$/.exec(part);
    if (lead) {
      percent = Number(lead[1]);
      text3 = lead[2];
    } else if (tail) {
      percent = Number(tail[2]);
      text3 = tail[1];
    }
    const color = parseColor(text3);
    if (isError(color)) return color;
    entries.push({ color, percent });
  }
  const [first, second] = entries;
  let p1 = first.percent;
  let p2 = second.percent;
  if (p1 === null && p2 === null) {
    p1 = 50;
    p2 = 50;
  } else if (p1 === null) p1 = 100 - p2;
  else if (p2 === null) p2 = 100 - p1;
  const sum = p1 + p2;
  if (sum <= 0) return { error: "color-mix percentages add up to 0" };
  const w1 = p1 / sum;
  const w2 = p2 / sum;
  const multiplier = sum < 100 ? sum / 100 : 1;
  const alpha = first.color.alpha * w1 + second.color.alpha * w2;
  if (alpha === 0) return { space: "srgb", c: [0, 0, 0], alpha: 0 };
  const mixed = mixChannels(space, first.color, second.color, w1, w2, alpha);
  return { space: space === "srgb" ? "srgb" : "oklab", c: mixed, alpha: alpha * multiplier };
}
function mixChannels(space, c1, c2, w1, w2, alpha) {
  const a1 = c1.alpha;
  const a2 = c2.alpha;
  const mixPremultiplied = (x2, y2) => (x2 * a1 * w1 + y2 * a2 * w2) / alpha;
  if (space === "srgb") {
    const x2 = toSrgb(c1);
    const y2 = toSrgb(c2);
    return [mixPremultiplied(x2[0], y2[0]), mixPremultiplied(x2[1], y2[1]), mixPremultiplied(x2[2], y2[2])];
  }
  const x = toOklab(c1);
  const y = toOklab(c2);
  if (space === "oklab") return [mixPremultiplied(x[0], y[0]), mixPremultiplied(x[1], y[1]), mixPremultiplied(x[2], y[2])];
  const polar = (v) => ({ L: v[0], C: Math.hypot(v[1], v[2]), h: Math.atan2(v[2], v[1]) * 180 / Math.PI });
  const p = polar(x);
  const q = polar(y);
  const none1 = p.C < 1e-6 || a1 === 0;
  const none2 = q.C < 1e-6 || a2 === 0;
  let h1 = none1 ? q.h : p.h;
  let h2 = none2 ? p.h : q.h;
  if (none1 && none2) {
    h1 = 0;
    h2 = 0;
  }
  const delta = ((h2 - h1) % 360 + 540) % 360 - 180;
  const hue = (h1 + delta * w2) * Math.PI / 180;
  const L = mixPremultiplied(p.L, q.L);
  const C = mixPremultiplied(p.C, q.C);
  return [L, C * Math.cos(hue), C * Math.sin(hue)];
}
function convertColor(text3) {
  const parsed = parseColor(text3);
  if (isError(parsed)) return parsed;
  return { color: toRgbString(parsed) };
}
function colorAlpha(color) {
  const match = /^rgba\(.*,\s*([\d.]+)\)$/.exec(color);
  return match ? Number(match[1]) : 1;
}
var NAMED, clamp01, isError;
var init_color = __esm({
  "src/css/color.ts"() {
    "use strict";
    init_parse();
    NAMED = {
      aliceblue: "f0f8ff",
      antiquewhite: "faebd7",
      aqua: "00ffff",
      aquamarine: "7fffd4",
      azure: "f0ffff",
      beige: "f5f5dc",
      bisque: "ffe4c4",
      black: "000000",
      blanchedalmond: "ffebcd",
      blue: "0000ff",
      blueviolet: "8a2be2",
      brown: "a52a2a",
      burlywood: "deb887",
      cadetblue: "5f9ea0",
      chartreuse: "7fff00",
      chocolate: "d2691e",
      coral: "ff7f50",
      cornflowerblue: "6495ed",
      cornsilk: "fff8dc",
      crimson: "dc143c",
      cyan: "00ffff",
      darkblue: "00008b",
      darkcyan: "008b8b",
      darkgoldenrod: "b8860b",
      darkgray: "a9a9a9",
      darkgreen: "006400",
      darkgrey: "a9a9a9",
      darkkhaki: "bdb76b",
      darkmagenta: "8b008b",
      darkolivegreen: "556b2f",
      darkorange: "ff8c00",
      darkorchid: "9932cc",
      darkred: "8b0000",
      darksalmon: "e9967a",
      darkseagreen: "8fbc8f",
      darkslateblue: "483d8b",
      darkslategray: "2f4f4f",
      darkslategrey: "2f4f4f",
      darkturquoise: "00ced1",
      darkviolet: "9400d3",
      deeppink: "ff1493",
      deepskyblue: "00bfff",
      dimgray: "696969",
      dimgrey: "696969",
      dodgerblue: "1e90ff",
      firebrick: "b22222",
      floralwhite: "fffaf0",
      forestgreen: "228b22",
      fuchsia: "ff00ff",
      gainsboro: "dcdcdc",
      ghostwhite: "f8f8ff",
      gold: "ffd700",
      goldenrod: "daa520",
      gray: "808080",
      green: "008000",
      greenyellow: "adff2f",
      grey: "808080",
      honeydew: "f0fff0",
      hotpink: "ff69b4",
      indianred: "cd5c5c",
      indigo: "4b0082",
      ivory: "fffff0",
      khaki: "f0e68c",
      lavender: "e6e6fa",
      lavenderblush: "fff0f5",
      lawngreen: "7cfc00",
      lemonchiffon: "fffacd",
      lightblue: "add8e6",
      lightcoral: "f08080",
      lightcyan: "e0ffff",
      lightgoldenrodyellow: "fafad2",
      lightgray: "d3d3d3",
      lightgreen: "90ee90",
      lightgrey: "d3d3d3",
      lightpink: "ffb6c1",
      lightsalmon: "ffa07a",
      lightseagreen: "20b2aa",
      lightskyblue: "87cefa",
      lightslategray: "778899",
      lightslategrey: "778899",
      lightsteelblue: "b0c4de",
      lightyellow: "ffffe0",
      lime: "00ff00",
      limegreen: "32cd32",
      linen: "faf0e6",
      magenta: "ff00ff",
      maroon: "800000",
      mediumaquamarine: "66cdaa",
      mediumblue: "0000cd",
      mediumorchid: "ba55d3",
      mediumpurple: "9370db",
      mediumseagreen: "3cb371",
      mediumslateblue: "7b68ee",
      mediumspringgreen: "00fa9a",
      mediumturquoise: "48d1cc",
      mediumvioletred: "c71585",
      midnightblue: "191970",
      mintcream: "f5fffa",
      mistyrose: "ffe4e1",
      moccasin: "ffe4b5",
      navajowhite: "ffdead",
      navy: "000080",
      oldlace: "fdf5e6",
      olive: "808000",
      olivedrab: "6b8e23",
      orange: "ffa500",
      orangered: "ff4500",
      orchid: "da70d6",
      palegoldenrod: "eee8aa",
      palegreen: "98fb98",
      paleturquoise: "afeeee",
      palevioletred: "db7093",
      papayawhip: "ffefd5",
      peachpuff: "ffdab9",
      peru: "cd853f",
      pink: "ffc0cb",
      plum: "dda0dd",
      powderblue: "b0e0e6",
      purple: "800080",
      rebeccapurple: "663399",
      red: "ff0000",
      rosybrown: "bc8f8f",
      royalblue: "4169e1",
      saddlebrown: "8b4513",
      salmon: "fa8072",
      sandybrown: "f4a460",
      seagreen: "2e8b57",
      seashell: "fff5ee",
      sienna: "a0522d",
      silver: "c0c0c0",
      skyblue: "87ceeb",
      slateblue: "6a5acd",
      slategray: "708090",
      slategrey: "708090",
      snow: "fffafa",
      springgreen: "00ff7f",
      steelblue: "4682b4",
      tan: "d2b48c",
      teal: "008080",
      thistle: "d8bfd8",
      tomato: "ff6347",
      turquoise: "40e0d0",
      violet: "ee82ee",
      wheat: "f5deb3",
      white: "ffffff",
      whitesmoke: "f5f5f5",
      yellow: "ffff00",
      yellowgreen: "9acd32"
    };
    clamp01 = (v) => Math.min(1, Math.max(0, v));
    isError = (value) => "error" in value;
  }
});

// src/css/table.ts
var TRANSFORM_KEYS;
var init_table = __esm({
  "src/css/table.ts"() {
    "use strict";
    TRANSFORM_KEYS = ["transform:translateX", "transform:translateY", "transform:rotate", "transform:rotateX", "transform:rotateY", "transform:scaleX", "transform:scaleY"];
  }
});

// src/css/values.ts
function closingParen(text3, open) {
  let depth = 0;
  for (let i = open; i < text3.length; i++) {
    const c = text3[i];
    if (c === "\\") i++;
    else if (c === '"' || c === "'") {
      i++;
      while (i < text3.length && text3[i] !== c) i += text3[i] === "\\" ? 2 : 1;
    } else if (c === "(") depth++;
    else if (c === ")" && --depth === 0) return i;
  }
  return -1;
}
function nextVar(text3, from) {
  for (let i = from; i < text3.length; i++) {
    const c = text3[i];
    if (c === '"' || c === "'") {
      i++;
      while (i < text3.length && text3[i] !== c) i += text3[i] === "\\" ? 2 : 1;
    } else if (c === "v" && text3.startsWith("var(", i) && !/[\w-]/.test(text3[i - 1] ?? " ")) return i;
  }
  return -1;
}
function substituteVars(text3, lookup, depth = 0) {
  if (depth > 32) return { error: "var() references itself" };
  let out = "";
  let i = 0;
  while (i < text3.length) {
    const at = nextVar(text3, i);
    if (at < 0) {
      out += text3.slice(i);
      break;
    }
    out += text3.slice(i, at);
    const close = closingParen(text3, at + 3);
    if (close < 0) return { error: `unbalanced var() in ${text3}` };
    const inner = text3.slice(at + 4, close);
    const comma = indexOfTop(inner, ",");
    const name = (comma < 0 ? inner : inner.slice(0, comma)).trim();
    const fallback = comma < 0 ? void 0 : inner.slice(comma + 1).trim();
    const found = lookup(name);
    const source = found !== void 0 ? found.value : fallback;
    if (source === void 0) return { error: `${name} is not defined` };
    const resolved = substituteVars(source, lookup, depth + 1);
    if ("error" in resolved) return resolved;
    out += resolved.text;
    i = close + 1;
  }
  return { text: out };
}
function soleVar(text3) {
  const match = /^var\(\s*(--[^\s,()]+)\s*\)$/.exec(text3.trim());
  return match ? match[1] : null;
}
function clean(x) {
  const rounded = Math.round(x * 1e6) / 1e6;
  return Math.abs(rounded - x) < 1e-9 ? rounded : x;
}
function singleUnit(args2) {
  let unit = null;
  for (const arg of args2) {
    const keys = Object.keys(arg);
    if (keys.length !== 1) return null;
    if (unit !== null && unit !== keys[0]) return null;
    unit = keys[0];
  }
  return unit;
}
function evaluate(text3, remPx) {
  return new Evaluator(text3.trim(), remPx).run();
}
function toLength(q, options) {
  const dims = Object.keys(q).filter((k) => q[k] !== 0);
  if (dims.includes("")) return { error: "a number without a unit is not a length" };
  if (dims.includes("deg")) return { error: "an angle is not a length" };
  if (dims.includes("em")) return { error: "em is relative to the font size and is not supported here" };
  for (const k of dims) if (!Number.isFinite(q[k])) return { error: "an infinite length" };
  if (dims.length === 0) return { value: 0 };
  const px = q.px ?? 0;
  const others = dims.filter((k) => k !== "px");
  if (others.length === 0) return { value: clean(px) };
  if (others.length > 1) return { error: `mixes ${others.join(" and ")}${px !== 0 ? " and px" : ""}, which cannot be one value` };
  const unit = others[0];
  const amount = q[unit];
  if (unit === "%") {
    if (px !== 0) return { error: "mixes a percentage and a length, which needs the parent's size" };
    return options.percent ? { value: `${Number(amount.toFixed(6))}%` } : { error: "a percentage is not supported here" };
  }
  const add = px !== 0 ? { add: clean(px) } : {};
  if (unit === "vw" || unit === "vh") return { dynamic: { window: unit === "vw" ? "width" : "height", scale: clean(amount / 100), ...add } };
  const inset = unit;
  return { dynamic: { inset, ...amount !== 1 ? { scale: clean(amount) } : {}, ...add } };
}
function toNumber(q, options = {}) {
  const dims = Object.keys(q).filter((k) => q[k] !== 0);
  let value;
  if (dims.length === 0) value = 0;
  else if (dims.length === 1 && dims[0] === "") value = q[""];
  else if (dims.length === 1 && dims[0] === "%" && options.percent) value = q["%"] / 100;
  else return { error: "not a number" };
  return Number.isFinite(value) ? { value: clean(value) } : { error: "an infinite number" };
}
function toAngle(q) {
  const dims = Object.keys(q).filter((k) => q[k] !== 0);
  if (dims.length === 0) return { value: "0deg" };
  if (dims.length === 1 && dims[0] === "deg") return { value: `${clean(q.deg)}deg` };
  return { error: "not an angle" };
}
var INSETS, ABSOLUTE_PX, WINDOW_WIDTH_UNITS, WINDOW_HEIGHT_UNITS, isNumber, merge, scale, Evaluator;
var init_values = __esm({
  "src/css/values.ts"() {
    "use strict";
    init_parse();
    INSETS = ["top", "right", "bottom", "left"];
    ABSOLUTE_PX = { px: 1, pt: 96 / 72, pc: 16, in: 96, cm: 96 / 2.54, mm: 96 / 25.4, q: 96 / 101.6 };
    WINDOW_WIDTH_UNITS = /* @__PURE__ */ new Set(["vw", "svw", "lvw", "dvw"]);
    WINDOW_HEIGHT_UNITS = /* @__PURE__ */ new Set(["vh", "svh", "lvh", "dvh"]);
    isNumber = (q) => Object.keys(q).every((k) => k === "");
    merge = (a, b, sign2) => {
      const hasPlain = (q) => "" in q;
      if (hasPlain(a) !== hasPlain(b)) return null;
      const out = { ...a };
      for (const [k, v] of Object.entries(b)) out[k] = (out[k] ?? 0) + sign2 * v;
      return out;
    };
    scale = (q, factor) => Object.fromEntries(Object.entries(q).map(([k, v]) => [k, v * factor]));
    Evaluator = class _Evaluator {
      pos = 0;
      // Fields, not parameter properties: Node strips the types of a file it loads itself (the transformer from the sources) and does not do those.
      text;
      remPx;
      constructor(text3, remPx) {
        this.text = text3;
        this.remPx = remPx;
      }
      run() {
        try {
          const q = this.sum();
          this.blank();
          if (this.pos < this.text.length) throw new Error(`unexpected ${this.text.slice(this.pos, this.pos + 12)} in ${this.text}`);
          return { q };
        } catch (error) {
          if (error instanceof Error) return { error: error.message };
          throw error;
        }
      }
      blank() {
        while (this.pos < this.text.length && /\s/.test(this.text[this.pos])) this.pos++;
      }
      sum() {
        let left = this.product();
        while (true) {
          this.blank();
          const op = this.text[this.pos];
          if (op !== "+" && op !== "-") return left;
          this.pos++;
          const right = this.product();
          const next = merge(left, right, op === "+" ? 1 : -1);
          if (next === null) throw new Error(`cannot add a number and a length in ${this.text}`);
          left = next;
        }
      }
      product() {
        let left = this.unary();
        while (true) {
          this.blank();
          const op = this.text[this.pos];
          if (op !== "*" && op !== "/") return left;
          this.pos++;
          const right = this.unary();
          if (op === "*") {
            if (isNumber(right)) left = scale(left, right[""] ?? 0);
            else if (isNumber(left)) left = scale(right, left[""] ?? 0);
            else throw new Error(`cannot multiply two lengths in ${this.text}`);
          } else {
            if (!isNumber(right)) throw new Error(`cannot divide by a length in ${this.text}`);
            const divisor = right[""] ?? 1;
            left = Object.fromEntries(Object.entries(left).map(([k, v]) => [k, v / divisor]));
          }
        }
      }
      unary() {
        this.blank();
        const sign2 = this.text[this.pos];
        if ((sign2 === "+" || sign2 === "-") && !/[\d.]/.test(this.text[this.pos + 1] ?? "")) {
          this.pos++;
          const value = this.unary();
          return sign2 === "-" ? scale(value, -1) : value;
        }
        return this.primary();
      }
      primary() {
        this.blank();
        const rest = this.text.slice(this.pos);
        const number = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/i.exec(rest);
        if (number) {
          this.pos += number[0].length;
          const n = Number(number[0]);
          const unit = /^(%|[a-z]+)/i.exec(this.text.slice(this.pos));
          if (!unit) return { "": n };
          this.pos += unit[0].length;
          return this.dimension(n, unit[0].toLowerCase());
        }
        if (rest[0] === "(") {
          this.pos++;
          const inner = this.sum();
          this.blank();
          if (this.text[this.pos] !== ")") throw new Error(`missing ) in ${this.text}`);
          this.pos++;
          return inner;
        }
        const ident = /^[a-z][\w-]*/i.exec(rest);
        if (!ident) throw new Error(`unexpected ${rest.slice(0, 12)} in ${this.text}`);
        const name = ident[0].toLowerCase();
        this.pos += ident[0].length;
        if (this.text[this.pos] === "(") {
          const close = closingParen(this.text, this.pos);
          if (close < 0) throw new Error(`missing ) in ${this.text}`);
          const inner = this.text.slice(this.pos + 1, close);
          this.pos = close + 1;
          return this.call(name, inner);
        }
        if (name === "infinity") return { "": Number.POSITIVE_INFINITY };
        if (name === "pi") return { "": Math.PI };
        if (name === "e") return { "": Math.E };
        throw new Error(`${ident[0]} is not a number or a length`);
      }
      dimension(n, unit) {
        if (unit === "%") return { "%": n };
        if (unit === "rem") return { px: n * this.remPx };
        if (unit === "em") return { em: n };
        const absolute = Object.hasOwn(ABSOLUTE_PX, unit) ? ABSOLUTE_PX[unit] : void 0;
        if (absolute !== void 0) return { px: n * absolute };
        if (WINDOW_WIDTH_UNITS.has(unit)) return { vw: n };
        if (WINDOW_HEIGHT_UNITS.has(unit)) return { vh: n };
        if (unit === "deg") return { deg: n };
        if (unit === "grad") return { deg: n * 0.9 };
        if (unit === "rad") return { deg: n * 180 / Math.PI };
        if (unit === "turn") return { deg: n * 360 };
        throw new Error(`the unit ${unit} is not supported`);
      }
      sub(text3) {
        const result = new _Evaluator(text3, this.remPx).run();
        if ("error" in result) throw new Error(result.error);
        return result.q;
      }
      call(name, inner) {
        if (name === "calc") return this.sub(inner);
        if (name === "env") {
          const [first] = splitTop(inner, ",");
          const match = /^safe-area-inset-(top|right|bottom|left)$/.exec((first ?? "").trim());
          if (!match) throw new Error(`env(${first ?? ""}) is not supported (only the safe-area insets are)`);
          return { [match[1]]: 1 };
        }
        if (name === "min" || name === "max" || name === "clamp") {
          const args2 = splitTop(inner, ",").map((arg) => this.sub(arg));
          const unit = singleUnit(args2);
          if (unit === null || INSETS.some((side) => side === unit) || unit === "vw" || unit === "vh") {
            throw new Error(`${name}() over different units, or over the device's insets or window, cannot be resolved at build time`);
          }
          const values = args2.map((arg) => arg[unit] ?? 0);
          let result;
          if (name === "min") result = Math.min(...values);
          else if (name === "max") result = Math.max(...values);
          else {
            if (values.length !== 3) throw new Error("clamp() takes three arguments");
            result = Math.max(values[0], Math.min(values[1], values[2]));
          }
          return { [unit]: result };
        }
        throw new Error(`${name}() is not supported`);
      }
    };
  }
});

// src/css/properties.ts
function own(table, key) {
  return Object.hasOwn(table, key) ? table[key] : void 0;
}
function around(parts) {
  const [a, b, c, d] = parts;
  if (a === void 0 || parts.length > 4) return null;
  if (b === void 0) return [a, a, a, a];
  if (c === void 0) return [a, b, a, b];
  if (d === void 0) return [a, b, c, b];
  return [a, b, c, d];
}
function pair(parts) {
  const [a, b] = parts;
  if (a === void 0 || parts.length > 2) return null;
  return [a, b ?? a];
}
function edges(keys, write) {
  return (d, text3) => {
    const values = around(splitTop(text3, " "));
    if (values === null) return d.fail(`${text3} is not one to four values`);
    for (const [i, key] of keys.entries()) write(d, key, values[i]);
  };
}
function twoEdges(keys, write) {
  return (d, text3) => {
    const values = pair(splitTop(text3, " "));
    if (values === null) return d.fail(`${text3} is not one or two values`);
    for (const [i, key] of keys.entries()) write(d, key, values[i]);
  };
}
function one(key, write) {
  return (d, text3) => write(d, key, text3);
}
function boxFamily(prefix, cssPrefix, suffix, cssSuffix, write, handlers2) {
  const [top, right, bottom, left] = SIDE_KEYS(prefix, suffix);
  const sides = [top, right, bottom, left];
  handlers2[`${cssPrefix}${cssSuffix}`] = edges(sides, write);
  for (const [name, key] of [["top", top], ["right", right], ["bottom", bottom], ["left", left]]) handlers2[`${cssPrefix}-${name}${cssSuffix}`] = one(key, write);
  handlers2[`${cssPrefix}-inline${cssSuffix}`] = twoEdges([left, right], write);
  handlers2[`${cssPrefix}-block${cssSuffix}`] = twoEdges([top, bottom], write);
  handlers2[`${cssPrefix}-inline-start${cssSuffix}`] = one(`${prefix}Start${suffix}`, write);
  handlers2[`${cssPrefix}-inline-end${cssSuffix}`] = one(`${prefix}End${suffix}`, write);
  handlers2[`${cssPrefix}-block-start${cssSuffix}`] = one(top, write);
  handlers2[`${cssPrefix}-block-end${cssSuffix}`] = one(bottom, write);
}
function noBorder(d) {
  d.set("borderStyle", null);
  for (const key of SIDE_KEYS("border", "Width")) d.set(key, 0);
}
function borderShorthand(widthKeys, colorKeys) {
  return (d, text3) => {
    for (const part of splitTop(text3, " ")) {
      const word = part.toLowerCase();
      if (word === "solid" || word === "dashed" || word === "dotted") d.set("borderStyle", word);
      else if (word === "none" || word === "hidden") {
        d.set("borderStyle", null);
        for (const key of widthKeys) d.set(key, 0);
      } else if (["double", "groove", "ridge", "inset", "outset"].includes(word)) d.fail(`border style ${word} is not supported`);
      else if (["thin", "medium", "thick"].includes(word) || "q" in evaluate(part, d.env.remPx)) for (const key of widthKeys) borderWidth(d, key, part);
      else d.color([...colorKeys], part);
    }
  };
}
function components(d, text3) {
  const out = [];
  for (const part of splitTop(text3, " ")) {
    const name = soleVar(part);
    if (name !== null && d.env.lookup(name)?.source === "default") {
      out.push(null);
      continue;
    }
    const resolved = substituteVars(part, d.env.lookup);
    if ("error" in resolved) {
      d.fail(resolved.error);
      return null;
    }
    out.push(resolved.text);
  }
  return out;
}
function convertDeclaration(property, value, env, out, report2) {
  const raw = own(rawHandlers, property);
  const handler = raw ?? own(handlers, property);
  const declaration = new Declaration(property, env, out, report2);
  if (handler === void 0) {
    declaration.fail(`no React Native style for ${property}`);
    return;
  }
  if (raw !== void 0) {
    raw(declaration, value);
    return;
  }
  const sole = soleVar(value);
  if (sole !== null && env.lookup(sole)?.source === "default") return;
  const resolved = substituteVars(value, env.lookup);
  if ("error" in resolved) {
    declaration.fail(resolved.error);
    return;
  }
  const text3 = resolved.text.trim();
  if (GLOBAL_KEYWORDS.has(text3.toLowerCase())) declaration.fail(`${text3} has no meaning in a class table`);
  else if (text3 === "") declaration.fail("empty value");
  else handler(declaration, text3);
}
var emptyResult, isEmptyResult, Declaration, same, spacing, margin, sizing, maxSizing, borderWidth, borderColor, radius, SIDE_KEYS, handlers, decorationLine, rawHandlers, GLOBAL_KEYWORDS;
var init_properties = __esm({
  "src/css/properties.ts"() {
    "use strict";
    init_color();
    init_parse();
    init_table();
    init_values();
    emptyResult = () => ({ style: {}, dynamic: {}, fontRelative: {} });
    isEmptyResult = (result) => Object.keys(result.style).length + Object.keys(result.dynamic).length + Object.keys(result.fontRelative).length === 0;
    Declaration = class {
      // Fields, not parameter properties: Node strips the types of a file it loads itself (the transformer from the sources, `lower-html.ts` through `inline.ts`) and does not do those.
      property;
      env;
      out;
      report;
      constructor(property, env, out, report2) {
        this.property = property;
        this.env = env;
        this.out = out;
        this.report = report2;
      }
      fail(reason) {
        this.report(this.property, reason);
      }
      // A later declaration of the same key replaces an earlier one, whichever of the three places the earlier one put it in.
      set(key, value) {
        delete this.out.dynamic[key];
        if (key === "lineHeight" || key === "letterSpacing") delete this.out.fontRelative[key];
        this.out.style[key] = value;
      }
      setDynamic(key, value) {
        delete this.out.style[key];
        this.out.dynamic[key] = value;
      }
      setRelative(key, value) {
        delete this.out.style[key];
        this.out.fontRelative[key] = value;
      }
      /** Writes a length to `key`: dp, a percentage string, a keyword (`null` for one that resets the key), or a dynamic value. Returns false (after reporting) when it is none of them. */
      length(key, text3, options = {}) {
        const keyword = options.keywords === void 0 ? void 0 : own(options.keywords, text3.trim().toLowerCase());
        if (keyword !== void 0) {
          this.set(key, keyword);
          return true;
        }
        if (/^[a-z][a-z-]*$/i.test(text3.trim()) && !/^(infinity|pi|e)$/i.test(text3.trim())) return this.bad(`${text3} has no React Native equivalent`);
        const evaluated = evaluate(text3, this.env.remPx);
        if ("error" in evaluated) return this.bad(evaluated.error);
        const length = toLength(evaluated.q, { percent: options.percent === true });
        if ("error" in length) return this.bad(`${text3}: ${length.error}`);
        if ("dynamic" in length) this.setDynamic(key, length.dynamic);
        else this.set(key, length.value);
        return true;
      }
      number(key, text3, options = {}) {
        const evaluated = evaluate(text3, this.env.remPx);
        if ("error" in evaluated) return this.bad(evaluated.error);
        const number = toNumber(evaluated.q, options);
        if ("error" in number) return this.bad(`${text3} is not a number`);
        this.set(key, number.value);
        return true;
      }
      color(keys, text3) {
        const color = convertColor(text3);
        if ("error" in color) return this.bad(color.error);
        for (const key of keys) this.set(key, color.color);
        return true;
      }
      keyword(key, text3, map) {
        const value = own(map, text3.trim().toLowerCase());
        if (value === void 0) return this.bad(`${text3} has no React Native equivalent`);
        this.set(key, value);
        return true;
      }
      quantity(text3) {
        const evaluated = evaluate(text3, this.env.remPx);
        if ("error" in evaluated) {
          this.bad(evaluated.error);
          return null;
        }
        return evaluated.q;
      }
      bad(reason) {
        this.fail(reason);
        return false;
      }
    };
    same = (...words) => Object.fromEntries(words.map((word) => [word, word]));
    spacing = (d, key, text3) => d.length(key, text3, { percent: true });
    margin = (d, key, text3) => d.length(key, text3, { percent: true, keywords: { auto: "auto" } });
    sizing = (d, key, text3) => d.length(key, text3, { percent: true, keywords: { auto: "auto" } });
    maxSizing = (d, key, text3) => d.length(key, text3, { percent: true, keywords: { auto: "auto", none: null } });
    borderWidth = (d, key, text3) => d.length(key, text3, { keywords: { thin: 1, medium: 3, thick: 5 } });
    borderColor = (d, key, text3) => void d.color([key], text3);
    radius = (d, key, text3) => {
      const q = d.quantity(text3);
      if (q === null) return;
      const px = q.px ?? 0;
      if (Object.keys(q).length === 1 && "px" in q && px > 1e6) d.set(key, 9999);
      else d.length(key, text3, { percent: true });
    };
    SIDE_KEYS = (prefix, suffix = "") => [`${prefix}Top${suffix}`, `${prefix}Right${suffix}`, `${prefix}Bottom${suffix}`, `${prefix}Left${suffix}`];
    handlers = {};
    boxFamily("padding", "padding", "", "", spacing, handlers);
    boxFamily("margin", "margin", "", "", margin, handlers);
    boxFamily("border", "border", "Width", "-width", borderWidth, handlers);
    boxFamily("border", "border", "Color", "-color", borderColor, handlers);
    {
      const keys = ["top", "right", "bottom", "left"];
      handlers.inset = edges(keys, sizing);
      for (const key of keys) handlers[key] = one(key, sizing);
      handlers["inset-inline"] = twoEdges(["left", "right"], sizing);
      handlers["inset-block"] = twoEdges(["top", "bottom"], sizing);
      handlers["inset-inline-start"] = one("start", sizing);
      handlers["inset-inline-end"] = one("end", sizing);
      handlers["inset-block-start"] = one("top", sizing);
      handlers["inset-block-end"] = one("bottom", sizing);
    }
    for (const [property, key] of [["width", "width"], ["height", "height"], ["min-width", "minWidth"], ["min-height", "minHeight"]]) {
      handlers[property] = one(key, sizing);
    }
    handlers["max-width"] = one("maxWidth", maxSizing);
    handlers["max-height"] = one("maxHeight", maxSizing);
    handlers["border-radius"] = (d, text3) => {
      if (text3.includes("/")) return d.fail("elliptical radii (a / b) are not supported");
      const values = around(splitTop(text3, " "));
      if (values === null) return d.fail(`${text3} is not one to four values`);
      const keys = ["borderTopLeftRadius", "borderTopRightRadius", "borderBottomRightRadius", "borderBottomLeftRadius"];
      for (const [i, key] of keys.entries()) radius(d, key, values[i]);
    };
    for (const [property, key] of [
      ["border-top-left-radius", "borderTopLeftRadius"],
      ["border-top-right-radius", "borderTopRightRadius"],
      ["border-bottom-right-radius", "borderBottomRightRadius"],
      ["border-bottom-left-radius", "borderBottomLeftRadius"],
      ["border-start-start-radius", "borderStartStartRadius"],
      ["border-start-end-radius", "borderStartEndRadius"],
      ["border-end-start-radius", "borderEndStartRadius"],
      ["border-end-end-radius", "borderEndEndRadius"]
    ]) {
      handlers[property] = (d, text3) => {
        if (splitTop(text3, " ").length > 1) return d.fail("elliptical radii (two values) are not supported");
        radius(d, key, text3);
      };
    }
    handlers["border-style"] = (d, text3) => {
      const values = splitTop(text3, " ");
      if (values.some((value) => value !== values[0])) return d.fail("a different border style per side is not supported");
      if (values[0] === "none" || values[0] === "hidden") return noBorder(d);
      d.keyword("borderStyle", values[0] ?? "", same("solid", "dashed", "dotted"));
    };
    for (const side of ["top", "right", "bottom", "left", "inline", "block", "inline-start", "inline-end", "block-start", "block-end"]) {
      handlers[`border-${side}-style`] = (d) => d.fail("a border style per side is not supported (React Native has one borderStyle)");
    }
    handlers.border = borderShorthand(SIDE_KEYS("border", "Width"), SIDE_KEYS("border", "Color"));
    for (const side of ["Top", "Right", "Bottom", "Left"]) handlers[`border-${side.toLowerCase()}`] = borderShorthand([`border${side}Width`], [`border${side}Color`]);
    handlers["border-inline"] = borderShorthand(["borderLeftWidth", "borderRightWidth"], ["borderLeftColor", "borderRightColor"]);
    handlers["border-block"] = borderShorthand(["borderTopWidth", "borderBottomWidth"], ["borderTopColor", "borderBottomColor"]);
    handlers["background-color"] = (d, text3) => void d.color(["backgroundColor"], text3);
    handlers.color = (d, text3) => void d.color(["color"], text3);
    handlers.background = (d, text3) => {
      if (splitTop(text3, " ").length > 1 || /^(url|linear-gradient|radial-gradient|conic-gradient)\(/i.test(text3)) return d.fail("only a background color is supported");
      d.color(["backgroundColor"], text3);
    };
    handlers.display = (d, text3) => {
      if (d.keyword("display", text3, { flex: "flex", "inline-flex": "flex", block: "flex", "inline-block": "flex", inline: "flex", "flow-root": "flex", none: "none", contents: "contents" })) d.set("htmlDisplay", text3.trim().toLowerCase());
    };
    handlers.position = (d, text3) => void d.keyword("position", text3, same("absolute", "relative", "static"));
    handlers.direction = (d, text3) => void d.keyword("direction", text3, same("ltr", "rtl"));
    handlers["z-index"] = (d, text3) => text3.trim() === "auto" ? d.set("zIndex", null) : void d.number("zIndex", text3);
    handlers.overflow = (d, text3) => {
      const values = splitTop(text3, " ");
      if (values.length > 1 && values[0] !== values[1]) return d.fail("a different overflow per axis is not supported");
      d.keyword("overflow", values[0] ?? "", { visible: "visible", hidden: "hidden", clip: "hidden", scroll: "scroll", auto: "scroll" });
    };
    handlers.opacity = (d, text3) => void d.number("opacity", text3, { percent: true });
    handlers["flex-direction"] = (d, text3) => void d.keyword("flexDirection", text3, same("row", "row-reverse", "column", "column-reverse"));
    handlers["flex-wrap"] = (d, text3) => void d.keyword("flexWrap", text3, same("wrap", "nowrap", "wrap-reverse"));
    handlers["flex-grow"] = (d, text3) => void d.number("flexGrow", text3);
    handlers["flex-shrink"] = (d, text3) => void d.number("flexShrink", text3);
    handlers["flex-basis"] = (d, text3) => void d.length("flexBasis", text3, { percent: true, keywords: { auto: "auto" } });
    handlers.flex = (d, text3) => {
      const word = text3.trim().toLowerCase();
      const presets = { none: [0, 0, "auto"], auto: [1, 1, "auto"], initial: [0, 1, "auto"] };
      const preset = own(presets, word);
      if (preset !== void 0) {
        d.set("flexGrow", preset[0]);
        d.set("flexShrink", preset[1]);
        d.set("flexBasis", preset[2]);
        return;
      }
      const parts = splitTop(text3, " ");
      const isFactor = (part) => /^[+-]?(\d+\.?\d*|\.\d+)$/.test(part) || /^calc\(\s*[\d.\s*/+-]+\)$/.test(part);
      const factors = [];
      while (parts.length > 0 && factors.length < 2 && isFactor(parts[0])) factors.push(parts.shift());
      if (parts.length > 1) return d.fail(`${text3} is not a flex shorthand`);
      d.number("flexGrow", factors[0] ?? "1");
      d.number("flexShrink", factors[1] ?? "1");
      if (parts[0] === void 0) return d.set("flexBasis", 0);
      d.length("flexBasis", parts[0], { percent: true, keywords: { auto: "auto" } });
      if (d.out.style.flexBasis === "0%") d.set("flexBasis", 0);
    };
    handlers["align-items"] = (d, text3) => void d.keyword("alignItems", text3, { "flex-start": "flex-start", start: "flex-start", "flex-end": "flex-end", end: "flex-end", center: "center", stretch: "stretch", normal: "stretch", baseline: "baseline" });
    handlers["align-self"] = (d, text3) => void d.keyword("alignSelf", text3, { auto: "auto", "flex-start": "flex-start", start: "flex-start", "flex-end": "flex-end", end: "flex-end", center: "center", stretch: "stretch", baseline: "baseline" });
    handlers["align-content"] = (d, text3) => {
      d.keyword("alignContent", text3, { "flex-start": "flex-start", start: "flex-start", "flex-end": "flex-end", end: "flex-end", center: "center", stretch: "stretch", normal: "stretch", "space-between": "space-between", "space-around": "space-around", "space-evenly": "space-evenly" });
    };
    handlers["justify-content"] = (d, text3) => {
      d.keyword("justifyContent", text3, { "flex-start": "flex-start", start: "flex-start", normal: "flex-start", "flex-end": "flex-end", end: "flex-end", center: "center", "space-between": "space-between", "space-around": "space-around", "space-evenly": "space-evenly" });
    };
    handlers.gap = (d, text3) => {
      const values = pair(splitTop(text3, " "));
      if (values === null) return d.fail(`${text3} is not one or two values`);
      d.length("rowGap", values[0]);
      d.length("columnGap", values[1]);
    };
    handlers["row-gap"] = (d, text3) => void d.length("rowGap", text3);
    handlers["column-gap"] = (d, text3) => void d.length("columnGap", text3);
    handlers["aspect-ratio"] = (d, text3) => {
      if (text3.trim() === "auto") return d.set("aspectRatio", null);
      const [a, b, extra] = text3.split("/");
      if (extra !== void 0 || a?.trim() === "auto") return d.fail(`${text3} has no React Native equivalent`);
      const ratio = (part) => {
        const q = d.quantity(part);
        const n = q === null ? null : toNumber(q);
        return n === null || "error" in n ? null : n.value;
      };
      const numerator = ratio(a ?? "");
      const denominator = b === void 0 ? 1 : ratio(b);
      if (numerator === null || denominator === null || denominator === 0) return d.fail(`${text3} is not a ratio`);
      d.set("aspectRatio", numerator / denominator);
    };
    handlers["font-size"] = (d, text3) => void d.length("fontSize", text3);
    handlers["font-weight"] = (d, text3) => {
      const word = text3.trim().toLowerCase();
      if (word === "normal") return d.set("fontWeight", "400");
      if (word === "bold") return d.set("fontWeight", "700");
      const q = d.quantity(text3);
      const n = q === null ? null : toNumber(q);
      if (n === null || "error" in n) return d.fail(`font-weight ${text3} is not a number`);
      d.set("fontWeight", String(n.value));
    };
    handlers["font-style"] = (d, text3) => void d.keyword("fontStyle", text3, { normal: "normal", italic: "italic", oblique: "italic" });
    handlers["font-family"] = (d, text3) => {
      const first = (splitTop(text3, ",")[0] ?? "").replace(/^["']|["']$/g, "").trim();
      if (first === "") return d.fail("empty font-family");
      const alias = { "ui-monospace": "monospace", "ui-serif": "serif", "ui-sans-serif": "System", "ui-rounded": "System", "system-ui": "System", "-apple-system": "System", blinkmacsystemfont: "System" };
      d.set("fontFamily", own(alias, first.toLowerCase()) ?? first);
    };
    handlers["line-height"] = (d, text3) => {
      if (text3.trim().toLowerCase() === "normal") return d.set("lineHeight", null);
      const q = d.quantity(text3);
      if (q === null) return;
      const dims = Object.keys(q).filter((k) => q[k] !== 0);
      if (dims.length === 1 && dims[0] === "") d.setRelative("lineHeight", clean(q[""]));
      else if (dims.length === 1 && dims[0] === "em") d.setRelative("lineHeight", clean(q.em));
      else if (dims.length === 1 && dims[0] === "%") d.setRelative("lineHeight", clean(q["%"] / 100));
      else d.length("lineHeight", text3);
    };
    handlers["letter-spacing"] = (d, text3) => {
      if (text3.trim().toLowerCase() === "normal") return d.set("letterSpacing", 0);
      const q = d.quantity(text3);
      if (q === null) return;
      const dims = Object.keys(q).filter((k) => q[k] !== 0);
      if (dims.length === 1 && dims[0] === "em") d.setRelative("letterSpacing", clean(q.em));
      else d.length("letterSpacing", text3);
    };
    handlers["text-align"] = (d, text3) => void d.keyword("textAlign", text3, { left: "left", right: "right", center: "center", justify: "justify", start: "auto" });
    handlers["text-transform"] = (d, text3) => void d.keyword("textTransform", text3, same("none", "uppercase", "lowercase", "capitalize"));
    decorationLine = (d, text3) => {
      const words = splitTop(text3.toLowerCase(), " ");
      if (words.some((word) => !["underline", "line-through", "none"].includes(word))) return d.fail(`${text3} is not supported (underline, line-through and none are)`);
      d.set("textDecorationLine", words.join(" "));
    };
    handlers["text-decoration-line"] = decorationLine;
    handlers["text-decoration"] = (d, text3) => {
      if (splitTop(text3, " ").length > 1) return d.fail("only the decoration line is supported in text-decoration");
      decorationLine(d, text3);
    };
    rawHandlers = {
      translate(d, text3) {
        if (text3.trim() === "none") {
          d.set("transform:translateX", null);
          d.set("transform:translateY", null);
          return;
        }
        const resolved = components(d, text3);
        if (resolved === null) return;
        const [x, y, z] = resolved;
        for (const [key, part] of [["transform:translateX", x], ["transform:translateY", y]]) {
          if (part === null || part === void 0) continue;
          const q = d.quantity(part);
          if (q === null) continue;
          if ((q["%"] ?? 0) !== 0) {
            d.fail("a percentage translation depends on the element's own size, which a style cannot express");
            continue;
          }
          const length = toLength(q, { percent: false });
          if ("error" in length) d.fail(`${part}: ${length.error}`);
          else if ("dynamic" in length) d.setDynamic(key, length.dynamic);
          else d.set(key, length.value);
        }
        if (z !== null && z !== void 0 && z !== "0" && z !== "0px") d.fail("translateZ has no React Native equivalent");
      },
      scale(d, text3) {
        if (text3.trim() === "none") {
          d.set("transform:scaleX", null);
          d.set("transform:scaleY", null);
          return;
        }
        const resolved = components(d, text3);
        if (resolved === null) return;
        const [x, y] = resolved;
        const factor = (part) => {
          const q = d.quantity(part);
          const n = q === null ? null : toNumber(q, { percent: true });
          if (n === null || "error" in n) {
            d.fail(`${part} is not a scale factor`);
            return null;
          }
          return n.value;
        };
        if (x !== null && x !== void 0) {
          const value = factor(x);
          if (value !== null) {
            d.set("transform:scaleX", value);
            if (resolved.length === 1) d.set("transform:scaleY", value);
          }
        }
        if (y !== null && y !== void 0) {
          const value = factor(y);
          if (value !== null) d.set("transform:scaleY", value);
        }
      },
      rotate(d, text3) {
        if (text3.trim() === "none") {
          for (const key of ["transform:rotate", "transform:rotateX", "transform:rotateY"]) d.set(key, null);
          return;
        }
        const resolved = components(d, text3);
        if (resolved === null) return;
        const words = resolved.filter((part) => part !== null).join(" ").split(/\s+/);
        const axis = /^[xyz]$/i.test(words[0] ?? "") ? words.shift().toLowerCase() : "z";
        const q = d.quantity(words.join(" "));
        if (q === null) return;
        const angle2 = toAngle(q);
        if ("error" in angle2) return d.fail(`${words.join(" ")} is not an angle`);
        d.set(axis === "x" ? "transform:rotateX" : axis === "y" ? "transform:rotateY" : "transform:rotate", angle2.value);
      }
    };
    handlers["box-shadow"] = (d, text3) => {
      if (text3.trim().toLowerCase() === "none") return d.set("boxShadow", null);
      const layers = [];
      for (const layer of splitTop(text3, ",")) {
        if (layer === "") continue;
        const tokens = splitTop(layer, " ");
        let inset = false;
        let colorText;
        const lengths = [];
        for (const token of tokens) {
          if (token.toLowerCase() === "inset") {
            inset = true;
            continue;
          }
          const q = evaluate(token, d.env.remPx);
          if ("q" in q) {
            const length = toLength(q.q, { percent: false });
            if ("error" in length || "dynamic" in length) return d.fail(`box-shadow length ${token} cannot be resolved at build time`);
            lengths.push(length.value);
          } else colorText = token;
        }
        if (lengths.length < 2 || lengths.length > 4) return d.fail(`box-shadow layer ${layer} needs two to four lengths`);
        if (colorText === void 0) return d.fail("a box-shadow layer without a color takes the text color (currentColor), which is not supported");
        const color = convertColor(colorText);
        if ("error" in color) return d.fail(`box-shadow color: ${color.error}`);
        if (colorAlpha(color.color) === 0) continue;
        const [x, y, blur = 0, spread = 0] = lengths;
        layers.push(`${inset ? "inset " : ""}${x}px ${y}px ${blur}px ${spread}px ${color.color}`);
      }
      d.set("boxShadow", layers.length > 0 ? layers.join(", ") : null);
    };
    handlers.transform = (d, text3) => {
      if (text3.trim().toLowerCase() !== "none") return d.fail(`transform: ${text3} is not supported (the translate, rotate and scale properties are)`);
      for (const key of TRANSFORM_KEYS) d.set(key, null);
    };
    GLOBAL_KEYWORDS = /* @__PURE__ */ new Set(["inherit", "initial", "unset", "revert", "revert-layer"]);
  }
});

// src/css/convert.ts
function combine(a, b) {
  const out = { ...a };
  if (b.scheme !== void 0) {
    if (out.scheme !== void 0 && out.scheme !== b.scheme) return null;
    out.scheme = b.scheme;
  }
  if (b.platform !== void 0) {
    if (out.platform !== void 0 && out.platform !== b.platform) return null;
    out.platform = b.platform;
  }
  if (b.minWidth !== void 0) out.minWidth = Math.max(out.minWidth ?? 0, b.minWidth);
  if (b.maxWidth !== void 0) out.maxWidth = Math.min(out.maxWidth ?? Number.POSITIVE_INFINITY, b.maxWidth);
  if (out.minWidth !== void 0 && out.maxWidth !== void 0 && out.minWidth >= out.maxWidth) return null;
  return out;
}
function narrow(base, prelude, remPx) {
  let when = base;
  const queries = splitTop(prelude.toLowerCase(), ",");
  if (queries.length !== 1) return { error: `media query list ${prelude} is not supported` };
  const text3 = queries[0].replace(/^only\s+/, "");
  if (/^not\s/.test(text3)) return { error: `@media ${prelude} is not supported` };
  for (const part of text3.split(/\s+and\s+/)) {
    const word = part.trim();
    if (word === "all" || word === "screen") continue;
    const feature = /^\((.*)\)$/.exec(word);
    if (!feature) return { error: `media type ${word} is not supported` };
    const next = parseFeature(feature[1].trim(), remPx);
    if ("error" in next) return next;
    when = when === null ? null : combine(when, next.when);
  }
  return { when };
}
function pixels(text3, remPx) {
  const q = evaluate(text3, remPx);
  if ("error" in q) return null;
  const dims = Object.keys(q.q).filter((k) => q.q[k] !== 0);
  if (dims.length === 0) return 0;
  return dims.length === 1 && dims[0] === "px" ? q.q.px : null;
}
function parseFeature(feature, remPx) {
  const unsupported = { error: `media feature (${feature}) is not supported` };
  const scheme = /^prefers-color-scheme\s*:\s*(dark|light)$/.exec(feature);
  if (scheme) return { when: { scheme: scheme[1] } };
  const platform = /^platform\s*:\s*(ios|android)$/.exec(feature);
  if (platform) return { when: { platform: platform[1] } };
  const legacy = /^(min|max)-width\s*:\s*(.+)$/.exec(feature);
  if (legacy) {
    const px = pixels(legacy[2], remPx);
    if (px === null) return unsupported;
    return { when: legacy[1] === "min" ? { minWidth: px } : { maxWidth: px } };
  }
  const double = /^(.+?)\s*(<=|<)\s*width\s*(<=|<)\s*(.+)$/.exec(feature);
  if (double) {
    const low = pixels(double[1], remPx);
    const high = pixels(double[4], remPx);
    return low === null || high === null ? unsupported : { when: { minWidth: low, maxWidth: high } };
  }
  const feat = /^width\s*(>=|<=|>|<)\s*(.+)$/.exec(feature);
  if (feat) {
    const px = pixels(feat[2], remPx);
    if (px === null) return unsupported;
    return { when: feat[1] === ">=" || feat[1] === ">" ? { minWidth: px } : { maxWidth: px } };
  }
  const reversed = /^(.+?)\s*(>=|<=|>|<)\s*width$/.exec(feature);
  if (reversed) {
    const px = pixels(reversed[1], remPx);
    if (px === null) return unsupported;
    return { when: reversed[2] === "<=" || reversed[2] === "<" ? { minWidth: px } : { maxWidth: px } };
  }
  return unsupported;
}
function supportsColorMix(prelude) {
  return /^\(\s*color\s*:\s*color-mix\(.*\)\s*\)$/i.test(prelude.trim());
}
function inlineSupports(items) {
  return items.flatMap((item) => item.kind === "at" && item.name === "supports" && item.body !== null && supportsColorMix(item.prelude) ? inlineSupports(item.body) : [item]);
}
function convertCss(css, options = {}) {
  return new Converter(options.remPx ?? 16).run(css);
}
var SILENT_AT_RULES, Converter;
var init_convert = __esm({
  "src/css/convert.ts"() {
    "use strict";
    init_parse();
    init_properties();
    init_values();
    SILENT_AT_RULES = /* @__PURE__ */ new Set(["property", "keyframes", "font-face", "import", "charset", "namespace", "page", "counter-style", "font-palette-values", "font-feature-values", "view-transition"]);
    Converter = class {
      constructor(remPx) {
        this.remPx = remPx;
      }
      remPx;
      layers = /* @__PURE__ */ new Map();
      themeVars = /* @__PURE__ */ new Map();
      propertyDefaults = /* @__PURE__ */ new Map();
      pending = [];
      unsupported = [];
      seen = /* @__PURE__ */ new Set();
      seq = 0;
      run(css) {
        const items = parseCss(css);
        this.registerLayers(items, null);
        this.collect(items, { layer: null, when: {}, blocked: null });
        this.emit(items, { layer: null, when: {}, blocked: null });
        return { table: this.table(), unsupported: this.unsupported };
      }
      // Layers: ranked by the first time a name appears, in a statement or a block.
      registerLayers(items, parent) {
        for (const item of items) {
          if (item.kind === "at" && item.name === "layer") {
            const names = splitTop(item.prelude, ",").filter((name) => name !== "");
            for (const name of names) {
              const qualified = parent === null ? name : `${parent}.${name}`;
              if (!this.layers.has(qualified)) this.layers.set(qualified, this.layers.size);
              if (item.body !== null && names.length === 1) this.registerLayers(item.body, qualified);
            }
          } else if (item.kind === "at" && item.body !== null) this.registerLayers(item.body, parent);
          else if (item.kind === "rule") this.registerLayers(item.body, parent);
        }
      }
      rank(layer, important) {
        if (important) return this.layers.size + 1;
        return layer === null ? this.layers.size : this.layers.get(layer) ?? this.layers.size;
      }
      /** The layer a `@layer` block puts its rules in (an anonymous block stays in the layer around it). */
      qualify(layer, prelude) {
        if (prelude === "") return layer;
        return layer === null ? prelude : `${layer}.${prelude}`;
      }
      // --- Pass 1: variables ---------------------------------------------------------------------------------------------------
      /** Theme variables (`:root`, `:host`), `@property` initial values and the `@layer properties` defaults. */
      collect(items, ctx) {
        for (const item of items) {
          if (item.kind === "at") {
            if (item.name === "layer" && item.body !== null) this.collect(item.body, { ...ctx, layer: this.qualify(ctx.layer, item.prelude) });
            else if (item.name === "property") this.collectProperty(item);
            else if (item.name === "media" && item.body !== null) {
              const media = narrow(ctx.when, item.prelude, this.remPx);
              if (!("error" in media) && media.when !== null) this.collect(item.body, { ...ctx, when: media.when });
            } else if (item.name === "supports" && item.body !== null) {
              if (supportsColorMix(item.prelude) || ctx.layer === "properties") this.collect(item.body, ctx);
            }
          } else if (item.kind === "rule") this.collectRule(item.selector, item.body, ctx);
        }
      }
      collectProperty(item) {
        const initial = item.body?.find((i) => i.kind === "decl" && i.property === "initial-value");
        if (initial !== void 0) this.propertyDefaults.set(item.prelude.trim(), initial.value);
      }
      collectRule(selector, body, ctx) {
        const parts = splitTop(selector, ",").map((part) => classifySelector(part));
        if (ctx.layer === "properties") {
          for (const decl of inlineSupports(body)) {
            if (decl.kind !== "decl" || !decl.property.startsWith("--")) continue;
            if (decl.value.trim() === "initial") this.propertyDefaults.delete(decl.property);
            else this.propertyDefaults.set(decl.property, decl.value);
          }
          return;
        }
        if (!parts.some((part) => part.kind === "root")) return;
        this.collectRootBody(body, ctx);
      }
      collectRootBody(body, ctx) {
        for (const item of inlineSupports(body)) {
          if (item.kind === "decl") {
            if (!item.property.startsWith("--")) continue;
            if (ctx.when.minWidth !== void 0 || ctx.when.maxWidth !== void 0 || ctx.when.platform !== void 0) continue;
            const defs = this.themeVars.get(item.property) ?? [];
            defs.push({ value: item.value, scheme: ctx.when.scheme, rank: this.rank(ctx.layer, item.important), seq: this.seq++ });
            this.themeVars.set(item.property, defs);
          } else if (item.kind === "at" && item.name === "media" && item.body !== null) {
            const media = narrow(ctx.when, item.prelude, this.remPx);
            if (!("error" in media) && media.when !== null) this.collectRootBody(item.body, { ...ctx, when: media.when });
          }
        }
      }
      // --- Pass 2: classes -----------------------------------------------------------------------------------------------------
      emit(items, ctx) {
        for (const item of items) {
          if (item.kind === "decl") continue;
          if (item.kind === "rule") this.emitRule(item.selector, item.body, ctx);
          else if (item.body === null || SILENT_AT_RULES.has(item.name)) continue;
          else if (item.name === "layer") this.emit(item.body, { ...ctx, layer: this.qualify(ctx.layer, item.prelude) });
          else if (item.name === "media") {
            const media = narrow(ctx.when, item.prelude, this.remPx);
            if ("error" in media) this.emit(item.body, { ...ctx, blocked: ctx.blocked ?? { property: "@media", reason: media.error } });
            else if (media.when !== null) this.emit(item.body, { ...ctx, when: media.when });
          } else if (item.name === "supports") {
            if (supportsColorMix(item.prelude)) this.emit(item.body, ctx);
            else this.emit(item.body, { ...ctx, blocked: ctx.blocked ?? { property: "@supports", reason: `@supports ${item.prelude} is not supported` } });
          } else this.emit(item.body, { ...ctx, blocked: ctx.blocked ?? { property: `@${item.name}`, reason: `@${item.name} is not supported` } });
        }
      }
      report(className, property, reason) {
        const key = `${className}\0${property}\0${reason}`;
        if (this.seen.has(key)) return;
        this.seen.add(key);
        this.unsupported.push({ className, property, reason });
      }
      /** What to say about a selector the table cannot hold; element selectors in Tailwind's own layers are not classes and not worth a word. */
      reportSelector(sel, part, ctx) {
        if (sel.className === null) {
          if (ctx.layer === "theme" || ctx.layer === "base" || ctx.layer === "properties") return;
          this.report(part.trim(), "selector", sel.reason);
          return;
        }
        this.report(sel.className, "selector", sel.reason);
      }
      emitRule(selector, body, ctx) {
        for (const part of splitTop(selector, ",")) {
          const sel = classifySelector(part);
          if (sel.kind === "root") continue;
          if (sel.kind === "unsupported") this.reportSelector(sel, part, ctx);
          else if (ctx.blocked !== null) this.report(sel.className, ctx.blocked.property, ctx.blocked.reason);
          else this.emitBody(sel.className, part.trim(), body, ctx, /* @__PURE__ */ new Map());
        }
      }
      /** The rules of one class from a rule body: its declarations in runs, a nested block ending the run before it. */
      emitBody(className, selector, body, ctx, inherited) {
        const items = inlineSupports(body);
        const own2 = new Map(inherited);
        for (const item of items) if (item.kind === "decl" && item.property.startsWith("--")) own2.set(item.property, item.value);
        if (items.length > 0 && items.every((item) => item.kind === "decl" && item.property.startsWith("--"))) {
          this.report(className, [...new Set(items.map((item) => item.property))].join(", "), "sets only custom properties, which another class's declaration would read; a class table does not compose classes");
        }
        let run = [];
        const flush = () => {
          if (run.length > 0) this.emitDeclarations(className, run, ctx, own2);
          run = [];
        };
        for (const item of items) {
          if (item.kind === "decl") {
            if (!item.property.startsWith("--")) run.push(item);
            continue;
          }
          flush();
          this.emitNested(className, selector, item, ctx, own2);
        }
        flush();
      }
      emitNested(className, selector, item, ctx, own2) {
        if (item.kind === "rule") {
          for (const part of splitTop(item.selector, ",")) {
            const full = part.includes("&") ? part.replaceAll("&", selector) : `${selector} ${part}`;
            const sel = classifySelector(full);
            if (sel.kind === "class") this.emitBody(sel.className, full.trim(), item.body, ctx, own2);
            else if (sel.kind === "unsupported") this.report(sel.className ?? className, "selector", sel.reason);
          }
          return;
        }
        if (item.body === null || SILENT_AT_RULES.has(item.name)) return;
        if (item.name === "layer") this.emitBody(className, selector, item.body, ctx, own2);
        else if (item.name === "media") {
          const media = narrow(ctx.when, item.prelude, this.remPx);
          if ("error" in media) this.report(className, "@media", media.error);
          else if (media.when !== null) this.emitBody(className, selector, item.body, { ...ctx, when: media.when }, own2);
        } else this.report(className, `@${item.name}`, `@${item.name} ${item.prelude} is not supported`);
      }
      /** Converts one run of declarations (normal ones, then the `!important` ones above every layer) into rules, once per scheme the values depend on. */
      emitDeclarations(className, decls, ctx, own2) {
        for (const important of [false, true]) {
          const group3 = decls.filter((decl) => decl.important === important);
          if (group3.length === 0) continue;
          const seq = this.seq++;
          const rank = this.rank(ctx.layer, important);
          const results = this.resultsFor(className, group3, ctx.when.scheme, own2);
          for (const { scheme, result } of results) {
            if (isEmptyResult(result)) continue;
            const when = { ...ctx.when, ...scheme !== void 0 ? { scheme } : {} };
            const rule = { ...Object.keys(when).length > 0 ? { when } : {}, style: result.style };
            if (Object.keys(result.dynamic).length > 0) rule.dynamic = result.dynamic;
            if (Object.keys(result.fontRelative).length > 0) rule.fontRelative = result.fontRelative;
            this.pending.push({ className, rank, seq, rule });
          }
        }
      }
      /**
       * The declarations' style under each scheme they could apply in: one result when no variable they read has a light/dark pair
       * (or the rule is already in a scheme), two when some does and the styles differ.
       */
      resultsFor(className, decls, scheme, own2) {
        if (scheme !== void 0) return [{ result: this.evaluateDecls(className, decls, scheme, own2).result }];
        const light = this.evaluateDecls(className, decls, "light", own2);
        if (!light.dependsOnScheme) return [{ result: light.result }];
        const dark = this.evaluateDecls(className, decls, "dark", own2);
        if (JSON.stringify(light.result) === JSON.stringify(dark.result)) return [{ result: light.result }];
        return [
          { scheme: "light", result: light.result },
          { scheme: "dark", result: dark.result }
        ];
      }
      evaluateDecls(className, decls, scheme, own2) {
        let dependsOnScheme = false;
        const lookup = (name) => {
          const mine = own2.get(name);
          if (mine !== void 0) return mine.trim() === "initial" ? void 0 : { value: mine, source: "own" };
          const defs = this.themeVars.get(name);
          if (defs !== void 0) {
            if (defs.some((def) => def.scheme !== void 0)) dependsOnScheme = true;
            const applicable = defs.filter((def) => def.scheme === void 0 || def.scheme === scheme);
            const best = applicable.reduce((a, b) => a === void 0 || b.rank > a.rank || b.rank === a.rank && b.seq > a.seq ? b : a, void 0);
            if (best !== void 0) return { value: best.value, source: "theme" };
          }
          const fallback = this.propertyDefaults.get(name);
          return fallback === void 0 ? void 0 : { value: fallback, source: "default" };
        };
        const result = emptyResult();
        for (const decl of decls) convertDeclaration(decl.property, decl.value, { remPx: this.remPx, lookup }, result, (property, reason) => this.report(className, property, reason));
        return { result, dependsOnScheme };
      }
      // --- Output --------------------------------------------------------------------------------------------------------------
      /** Orders the rules by layer, then source (the light and dark twins of one rule share a place), and groups them by class. */
      table() {
        const sorted = [...this.pending].sort((a, b) => a.rank - b.rank || a.seq - b.seq);
        const classes = /* @__PURE__ */ new Map();
        let order = 0;
        let last = "";
        for (const { className, rank, seq, rule } of sorted) {
          const key = `${rank}:${seq}`;
          if (key !== last) order++;
          last = key;
          const rules = classes.get(className) ?? [];
          rules.push({ order, ...rule });
          classes.set(className, rules);
        }
        return { version: 1, classes: Object.fromEntries(classes) };
      }
    };
  }
});

// src/css/build.ts
var build_exports = {};
__export(build_exports, {
  TAILWIND_VERSION: () => TAILWIND_VERSION,
  buildClasses: () => buildClasses,
  buildClassesSync: () => buildClassesSync,
  candidatesIn: () => candidatesIn,
  candidatesOf: () => candidatesOf,
  reportSkipped: () => reportSkipped,
  reportUnsupported: () => reportUnsupported,
  resetReports: () => resetReports,
  sourceFiles: () => sourceFiles,
  unsupportedReasons: () => unsupportedReasons,
  watchClasses: () => watchClasses
});
import { spawnSync as spawnSync4 } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync as existsSync8, mkdirSync as mkdirSync3, readdirSync as readdirSync6, readFileSync as readFileSync9, statSync as statSync2, watch as watch3, writeFileSync as writeFileSync3 } from "node:fs";
import { createRequire as createRequire4 } from "node:module";
import { dirname as dirname7, extname, isAbsolute as isAbsolute2, join as join11, relative as relative4, resolve as resolve10, sep as sep5 } from "node:path";
function sourceFiles(root2) {
  const files = [];
  const walk = (directory) => {
    for (const item of readdirSync6(directory, { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : 1)) {
      const path = join11(directory, item.name);
      if (item.isDirectory()) {
        if (!SKIPPED_DIRECTORIES.has(item.name)) walk(path);
      } else if (SOURCE_EXTENSIONS.has(extname(item.name))) files.push(path);
    }
  };
  if (existsSync8(join11(root2, "src"))) walk(join11(root2, "src"));
  return files;
}
function closingBracket(source, start) {
  let depth = 0;
  for (let index = start; index < source.length; index++) {
    const code = source.charCodeAt(index);
    if (code === 91) depth++;
    else if (code === 93 && --depth === 0) return index + 1;
    else if (code === 32 || code === 34 || code === 96 || code === 10 || code === 13 || code === 9) return -1;
  }
  return -1;
}
function candidatesIn(source, into = /* @__PURE__ */ new Set()) {
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
function candidatesOf(root2) {
  const candidates = /* @__PURE__ */ new Set();
  for (const file of sourceFiles(root2)) candidatesIn(readFileSync9(file, "utf8"), candidates);
  return [...candidates].sort();
}
function loadTailwind(root2) {
  const fromApp = createRequire4(join11(root2, "package.json"));
  const install = `pnpm add -D tailwindcss@${TAILWIND_VERSION}`;
  let directory;
  let manifest;
  try {
    const manifestFile = fromApp.resolve("tailwindcss/package.json");
    directory = dirname7(manifestFile);
    manifest = JSON.parse(readFileSync9(manifestFile, "utf8"));
  } catch (error) {
    throw new Error(`expo-svelte: the css option needs Tailwind CSS in the app: ${install} (${error.message.split("\n")[0]})`, { cause: error });
  }
  if (!manifest.version?.startsWith("4.")) throw new Error(`expo-svelte: the css option needs Tailwind CSS 4, the app has ${manifest.version ?? "an unknown version"}: ${install}`);
  return { tailwind: fromApp("tailwindcss"), directory };
}
function exportedStylesheet(exports, key) {
  const pick = (target) => {
    if (typeof target === "string") return target;
    if (target === null || typeof target !== "object") return void 0;
    const conditions = target;
    for (const condition of ["style", "import", "require", "default"]) {
      const found = pick(conditions[condition]);
      if (found !== void 0) return found;
    }
    return void 0;
  };
  if (exports === null || typeof exports !== "object" || Array.isArray(exports)) return key === "." ? pick(exports) : void 0;
  const entries = exports;
  return Object.keys(entries).some((name) => name.startsWith(".")) ? pick(entries[key]) : key === "." ? pick(entries) : void 0;
}
function packageStylesheet(id, base) {
  const name = id.startsWith("@") ? id.split("/").slice(0, 2).join("/") : id.split("/")[0];
  const subpath = id.slice(name.length);
  for (let directory = base; ; directory = dirname7(directory)) {
    const packageDirectory = join11(directory, "node_modules", name);
    const manifestFile = join11(packageDirectory, "package.json");
    if (existsSync8(manifestFile)) {
      const manifest = JSON.parse(readFileSync9(manifestFile, "utf8"));
      let target;
      if (subpath === "") target = exportedStylesheet(manifest.exports, ".") ?? manifest.style ?? (manifest.main?.endsWith(".css") ? manifest.main : void 0);
      else {
        for (const file of [join11(packageDirectory, subpath), join11(packageDirectory, `${subpath}.css`)]) if (existsSync8(file) && statSync2(file).isFile()) return file;
        target = exportedStylesheet(manifest.exports, `.${subpath}`);
      }
      return target === void 0 ? void 0 : resolve10(packageDirectory, target);
    }
    if (dirname7(directory) === directory) return void 0;
  }
}
function stylesheetLoader(tailwindDirectory, read2) {
  return async (id, base) => {
    let file;
    if (id === "tailwindcss") file = join11(tailwindDirectory, "index.css");
    else if (id.startsWith("tailwindcss/")) file = join11(tailwindDirectory, `${id.slice("tailwindcss/".length).replace(/\.css$/, "")}.css`);
    else if (id.startsWith(".") || isAbsolute2(id)) file = resolve10(base, id);
    else {
      const next = resolve10(base, id);
      file = existsSync8(next) && statSync2(next).isFile() ? next : packageStylesheet(id, base);
      if (file === void 0) {
        try {
          file = createRequire4(join11(base, "noop.js")).resolve(id);
        } catch (error) {
          throw new Error(`expo-svelte: cannot resolve @import "${id}" from ${base}: ${error.message.split("\n")[0]}`, { cause: error });
        }
        if (!file.endsWith(".css")) throw new Error(`expo-svelte: cannot resolve @import "${id}" from ${base}: ${id} has no CSS file (a "style" export condition or field, or a .css file)`);
      }
    }
    let content;
    try {
      content = readFileSync9(file, "utf8");
    } catch (error) {
      throw new Error(`expo-svelte: cannot read @import "${id}" from ${base}: ${error.code ?? error.message}`, { cause: error });
    }
    read2.add(file);
    return { path: file, base: dirname7(file), content };
  };
}
function tableSource(table) {
  const lines = (entries) => Object.entries(entries).map(([name, value]) => `${JSON.stringify(name)}: ${JSON.stringify(value)}`);
  const block2 = (name, entries) => entries.length === 0 ? "" : `  ${JSON.stringify(name)}: {
    ${entries.join(",\n    ")}
  },
`;
  return `// Generated by expo-svelte (the css option of withExpoSvelte): the classes of the app's CSS as React Native styles.
import type Table from "expo-svelte/classes-table";

export default {
  "version": ${JSON.stringify(table.version)},
${block2("classes", lines(table.classes)) || '  "classes": {},\n'}${block2("unsupported", lines(table.unsupported ?? {}))}} as typeof Table;
`;
}
function unsupportedReasons(unsupported) {
  const reasons = /* @__PURE__ */ new Map();
  for (const { className, property, reason } of unsupported) {
    const line = `${property}: ${reason}`;
    const lines = reasons.get(className) ?? [];
    if (!lines.includes(line)) lines.push(line);
    reasons.set(className, lines);
  }
  return Object.fromEntries([...reasons].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([className, lines]) => [className, lines.join("; ")]));
}
function writeIfChanged(file, content) {
  let current;
  try {
    current = readFileSync9(file, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (current === content) return false;
  mkdirSync3(dirname7(file), { recursive: true });
  writeFileSync3(file, content);
  return true;
}
function inputsOf(candidates, entry, stylesheets) {
  const hash = createHash("sha256");
  hash.update(candidates.join("\n"));
  for (const sheet of /* @__PURE__ */ new Set([entry, ...stylesheets])) {
    hash.update("\0");
    try {
      hash.update(readFileSync9(sheet));
    } catch {
      hash.update("missing");
    }
  }
  return hash.digest("hex");
}
async function buildClasses(options) {
  const root2 = resolve10(options.root);
  const entry = resolve10(root2, options.css);
  const file = join11(root2, ".expo-svelte", classesTableFile(options.variant));
  if (!existsSync8(entry)) throw new Error(`expo-svelte: the css option names ${options.css}, which is not a file (relative to ${root2})`);
  const candidates = candidatesOf(root2);
  const previous = built.get(file);
  const inputs = inputsOf(candidates, entry, previous?.result.stylesheets ?? []);
  if (previous !== void 0 && previous.inputs === inputs && existsSync8(file)) return { ...previous.result, changed: false };
  const { tailwind, directory } = loadTailwind(root2);
  const read2 = /* @__PURE__ */ new Set([entry]);
  const skipped = /* @__PURE__ */ new Set();
  const compiler = await tailwind.compile(readFileSync9(entry, "utf8"), {
    base: dirname7(entry),
    from: entry,
    loadStylesheet: stylesheetLoader(directory, read2),
    loadModule: async (id, base, hint) => {
      skipped.add(`@${hint} "${id}"`);
      return { path: id, base, module: hint === "plugin" ? noPlugin : {} };
    }
  });
  const { table, unsupported } = (options.convert ?? convertCss)(compiler.build(candidates));
  const reasons = unsupportedReasons(unsupported);
  const written = Object.keys(reasons).length === 0 ? table : { ...table, unsupported: { ...table.unsupported, ...reasons } };
  const result = { file, changed: writeIfChanged(file, tableSource(written)), unsupported, stylesheets: [...read2], skipped: [...skipped] };
  built.set(file, { inputs: inputsOf(candidates, entry, result.stylesheets), result });
  return result;
}
function buildClassesSync(options) {
  const root2 = resolve10(options.root);
  const entry = resolve10(root2, options.css);
  const file = join11(root2, ".expo-svelte", classesTableFile(options.variant));
  const previous = built.get(file);
  const candidates = candidatesOf(root2);
  const inputs = existsSync8(entry) ? inputsOf(candidates, entry, previous?.result.stylesheets ?? []) : "";
  if (previous !== void 0 && previous.inputs === inputs && existsSync8(file)) return { ...previous.result, changed: false };
  const cli = process.versions.bun !== void 0 && import.meta.filename.endsWith(".ts") ? sourceFile("cli.ts") : join11(packageRoot, "dist/node/cli.js");
  const run = spawnSync4(process.execPath, [cli, "css", options.css, "--variant", options.variant, "--json"], { cwd: root2, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  if (run.error) throw new Error(`expo-svelte: could not run the CSS build (${run.error.message})`, { cause: run.error });
  if (run.status !== 0) throw new Error(run.stderr.trim() || `expo-svelte: the CSS build exited with ${run.status}`);
  const result = JSON.parse(run.stdout);
  built.set(file, { inputs: inputsOf(candidates, entry, result.stylesheets), result });
  return result;
}
function reportUnsupported(unsupported, development = process.env.NODE_ENV === "development") {
  if (!development) return;
  const before = reported.size;
  for (const { className } of unsupported) reported.add(className);
  if (reported.size === before) return;
  const count2 = reported.size;
  console.warn(`expo-svelte: ${count2} ${count2 === 1 ? "class the sources mention is" : "classes the sources mention are"} not supported on native; a class that is used warns when it renders`);
}
function resetReports() {
  reported.clear();
  reportedSkipped.clear();
}
function reportSkipped(skipped) {
  const fresh = skipped.filter((line) => !reportedSkipped.has(line));
  if (fresh.length === 0) return;
  for (const line of fresh) reportedSkipped.add(line);
  console.warn(`expo-svelte: plugins and JS config do not apply on native: ${fresh.join(", ")} ${fresh.length === 1 ? "is" : "are"} ignored`);
}
function watchClasses(options, stylesheets = [], debounceMs = 100) {
  const root2 = resolve10(options.root);
  const source = join11(root2, "src");
  const watchers = /* @__PURE__ */ new Map();
  let timer;
  let running = Promise.resolve();
  let closed = false;
  const watchDirectory = (directory, recursive) => {
    if (closed || watchers.has(directory) || !existsSync8(directory)) return;
    const watcher = watch3(directory, { recursive }, schedule);
    watcher.unref();
    watchers.set(directory, watcher);
  };
  const followStylesheets = (files) => {
    for (const directory of new Set(files.map((file) => dirname7(file))))
      if (!directory.split(sep5).includes("node_modules") && relative4(source, directory).startsWith("..")) watchDirectory(directory, false);
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
  const tree = watchTree(source, schedule, { debounceMs: 0, skip: (name) => SKIPPED_DIRECTORIES.has(name) });
  followStylesheets([resolve10(root2, options.css), ...stylesheets]);
  return {
    close() {
      closed = true;
      clearTimeout(timer);
      tree.close();
      for (const watcher of watchers.values()) watcher.close();
      watchers.clear();
    }
  };
}
var TAILWIND_VERSION, SOURCE_EXTENSIONS, SKIPPED_DIRECTORIES, LONGEST_CANDIDATE, isClassCharacter, noPlugin, built, reported, reportedSkipped;
var init_build2 = __esm({
  "src/css/build.ts"() {
    "use strict";
    init_build();
    init_package_root();
    init_variant();
    init_convert();
    init_watch_tree();
    TAILWIND_VERSION = "4.3.3";
    SOURCE_EXTENSIONS = /* @__PURE__ */ new Set([".svelte", ".ts", ".js"]);
    SKIPPED_DIRECTORIES = /* @__PURE__ */ new Set(["node_modules", ".expo-svelte"]);
    LONGEST_CANDIDATE = 300;
    isClassCharacter = (code) => code >= 48 && code <= 58 || code >= 65 && code <= 90 || code >= 97 && code <= 122 || code === 45 || code === 95 || code === 47 || code === 46 || code === 37 || code === 35 || code === 33 || code === 64 || code === 42 || code === 40 || code === 41;
    noPlugin = Object.assign(() => ({ handler: () => {
    } }), { __isOptionsFunction: true });
    built = /* @__PURE__ */ new Map();
    reported = /* @__PURE__ */ new Set();
    reportedSkipped = /* @__PURE__ */ new Set();
  }
});

// src/cli.ts
init_build();
init_variant();
import { watch as watch4 } from "node:fs";
import { resolve as resolve11 } from "node:path";
var [command = "dev", ...args] = process.argv.slice(2);
var root = process.cwd();
if (command === "help" || command === "--help" || command === "-h") {
  console.log(`Usage: expo-svelte <command>

  init       turn a SvelteKit project (npx sv create) into an Expo Svelte app; \`init --help\` lists its options
  doctor     check the app's setup (peer versions, patches, Metro and Expo wiring, push); \`doctor --server\` checks the push server's credentials instead
  push       \`push send\` sends one push message to one device with the server's credentials; \`push --help\` and \`push send --help\` list the options
  android    sync, prebuild if android/ is missing, build and run on a device or emulator (arguments go to expo run:android)
  ios        the same for iOS (a Mac with Xcode)
  dev        regenerate .expo-svelte/ when a route file changes and start Metro (arguments go to expo start)
  build      export the Hermes bytecode of a platform (--platform android|ios) without building the host
  sync       only regenerate .expo-svelte/
  css <file> compile the app's CSS file (Tailwind 4) into the class table of \`class\` (.expo-svelte/classes.<variant>.ts); --variant <name> picks the variant, --json prints the result as JSON`);
  process.exit(0);
}
if (command === "init") {
  const { runInit: runInit2 } = await Promise.resolve().then(() => (init_init_app(), init_app_exports));
  process.exit(runInit2(root, args));
}
async function exitAfterFlush(status) {
  for (const stream of [process.stdout, process.stderr]) await new Promise((flushed) => stream.write("", () => flushed()));
  process.exit(status);
}
if (command === "doctor") {
  const { runDoctor: runDoctor2 } = await Promise.resolve().then(() => (init_doctor(), doctor_exports));
  await exitAfterFlush(await runDoctor2(root, args));
}
if (command === "push") {
  const { runPush: runPush2 } = await Promise.resolve().then(() => (init_cli(), cli_exports));
  await exitAfterFlush(await runPush2(root, args));
}
if (command === "android-autolinking") {
  const { runAndroidAutolinking: runAndroidAutolinking2 } = await Promise.resolve().then(() => (init_autolinking(), autolinking_exports));
  const status = runAndroidAutolinking2(args);
  await new Promise((flushed) => process.stdout.write("", () => flushed()));
  process.exit(status);
}
if (command === "ios-autolinking") {
  const { runIosAutolinking: runIosAutolinking2 } = await Promise.resolve().then(() => (init_autolinking(), autolinking_exports));
  await exitAfterFlush(runIosAutolinking2(args));
}
if (command === "css") {
  const { buildClasses: buildClasses2 } = await Promise.resolve().then(() => (init_build2(), build_exports));
  const variantIndex = args.indexOf("--variant");
  const file = args.find((arg, index) => !arg.startsWith("--") && (variantIndex < 0 || index !== variantIndex + 1));
  if (file === void 0) throw new Error("Usage: expo-svelte css <css file> [--variant <name>] [--json]");
  try {
    const result = await buildClasses2({ root, css: file, variant: variantIndex < 0 ? variantName() : args[variantIndex + 1] ?? variantName() });
    if (args.includes("--json")) await new Promise((flushed) => process.stdout.write(JSON.stringify(result), () => flushed()));
    else {
      console.log(`expo-svelte: ${result.changed ? "wrote" : "kept"} ${result.file}`);
      for (const { className, property, reason } of result.unsupported) console.log(`  ${className}: ${property}: ${reason}`);
      for (const line of result.skipped) console.log(`  ${line}: ignored (plugins and JS config do not apply on native)`);
    }
    process.exit(0);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
await syncNative(root);
if (command === "build") {
  const platformIndex = args.indexOf("--platform");
  const platform = platformIndex < 0 ? "android" : args[platformIndex + 1];
  if (platform !== "ios" && platform !== "android") throw new Error("Choose --platform android or ios");
  await exportNative(root, platform);
} else if (command === "android" || command === "ios") {
  const child = runExpo(root, [`run:${command}`, ...args]);
  process.once("SIGINT", () => child.kill("SIGINT"));
  process.once("SIGTERM", () => child.kill("SIGTERM"));
  child.once("error", (error) => {
    console.error(error);
    process.exitCode = 1;
  });
  child.once("exit", (code) => {
    process.exitCode = code ?? 1;
  });
} else if (command === "dev") {
  await syncNative(root);
  let syncing = Promise.resolve();
  const watcher = watch4(resolve11(root, "src/routes"), { recursive: true }, (_event, file) => {
    if (file && /\+(?:mobile|layout\.mobile)\.svelte$/.test(file)) {
      syncing = syncing.then(() => syncNative(root)).catch((error) => {
        console.error(error);
      });
    }
  });
  const child = runExpo(root, ["start", ...args]);
  const stop = () => {
    watcher.close();
    child.kill("SIGTERM");
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  child.once("error", (error) => {
    watcher.close();
    console.error(error);
    process.exitCode = 1;
  });
  child.once("exit", (code) => {
    watcher.close();
    process.exitCode = code ?? 1;
  });
} else if (command !== "sync") {
  throw new Error(`Unknown command: ${command}. Use init, dev, android, ios, build, sync, css, doctor or push.`);
}
