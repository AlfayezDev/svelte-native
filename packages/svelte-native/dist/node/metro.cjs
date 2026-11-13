"use strict";
var __importMetaUrl = require("node:url").pathToFileURL(__filename).href;
"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/metro.ts
var metro_exports = {};
__export(metro_exports, {
  INITIALIZE_CORE: () => INITIALIZE_CORE,
  LITE_ORIGINS: () => LITE_ORIGINS,
  RENDERER_STUBS: () => RENDERER_STUBS,
  closeWatchers: () => closeWatchers,
  isInPackage: () => isInPackage,
  libraryChanged: () => libraryChanged,
  stubCoreSource: () => stubCoreSource,
  stubSource: () => stubSource,
  withSvelteNative: () => withSvelteNative
});
module.exports = __toCommonJS(metro_exports);
var import_node_fs6 = require("node:fs");
var import_node_module5 = require("node:module");
var import_node_path9 = require("node:path");

// src/build.ts
var import_node_fs3 = require("node:fs");
var import_node_module = require("node:module");
var import_node_path4 = require("node:path");

// src/compile-options.ts
var import_node_path2 = require("node:path");

// src/package-root.ts
var import_node_fs = require("node:fs");
var import_node_path = require("node:path");
function findPackageRoot(from) {
  for (let directory = from; ; directory = (0, import_node_path.dirname)(directory)) {
    if ((0, import_node_fs.existsSync)((0, import_node_path.join)(directory, "package.json"))) return directory;
    if ((0, import_node_path.dirname)(directory) === directory) throw new Error(`No package.json above ${from}: the package's files moved`);
  }
}
var packageRoot = findPackageRoot(__dirname);
var sourceDirectory = (0, import_node_path.join)(packageRoot, "src");
function sourceFile(path) {
  const file = (0, import_node_path.resolve)(sourceDirectory, path);
  if (!(0, import_node_fs.existsSync)(file)) throw new Error(`${file} is not in the package: the Node-side code names a source file that is missing`);
  return file;
}

// src/compile-options.ts
var RUNES_ENVIRONMENT_VARIABLE = "SVELTE_NATIVE_RUNES";
var runesEnvironment = (runes) => runes === void 0 ? {} : { [RUNES_ENVIRONMENT_VARIABLE]: runes ? "1" : "0" };
var ASYNC_ENVIRONMENT_VARIABLE = "SVELTE_NATIVE_ASYNC";
var asyncEnvironment = (enabled) => enabled === void 0 ? {} : { [ASYNC_ENVIRONMENT_VARIABLE]: enabled ? "1" : "0" };
var ownSources = sourceDirectory + import_node_path2.sep;

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
      const relative4 = source.directory.slice(tabs.directory.length);
      let groups = 0;
      while (groups < relative4.length && isGroup(relative4[groups])) groups++;
      if (groups === relative4.length) {
        const isPage = pages.get(source.key) === source;
        if (isPage || navigators.has(source.key)) throw new Error(`${source.path}: a ${isPage ? "page" : "navigator layout"} directly under a tabs layout has no pane to show in; move it into a pane directory`);
        continue;
      }
      const key = relative4[groups];
      const directory = tabs.directory.concat(relative4.slice(0, groups + 1));
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
var classesTableFile = (variant) => `classes.${variant.replace(/[^A-Za-z0-9_-]/g, "_")}.ts`;

// src/watch-tree.ts
var import_node_fs2 = require("node:fs");
var import_node_path3 = require("node:path");
function watchTree(root, onChange, options = {}) {
  const base = (0, import_node_path3.resolve)(root);
  const debounceMs = options.debounceMs ?? 50;
  const skip = options.skip ?? ((name) => name === "node_modules" || name.startsWith("."));
  const watchers2 = /* @__PURE__ */ new Map();
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
    if (closed || watchers2.has(directory)) return;
    let watcher;
    try {
      watcher = (0, import_node_fs2.watch)(directory, (_event, name) => {
        if (name) seen((0, import_node_path3.join)(directory, name.toString()), name.toString());
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
    watchers2.set(directory, watcher);
  };
  const seen = (path, name) => {
    if (watchers2.has(path)) dropTree(path);
    if (!skip(name) && isDirectory(path)) addTree(path);
  };
  const addTree = (directory) => {
    add(directory);
    let entries;
    try {
      entries = (0, import_node_fs2.readdirSync)(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) if (entry.isDirectory() && !skip(entry.name)) addTree((0, import_node_path3.join)(directory, entry.name));
  };
  const dropTree = (directory) => {
    for (const [path, watcher] of watchers2) {
      if (path === directory || path.startsWith(directory + import_node_path3.sep)) {
        watcher.close();
        watchers2.delete(path);
      }
    }
  };
  const waitForRoot = () => {
    let above = (0, import_node_path3.dirname)(base);
    while (!isDirectory(above) && (0, import_node_path3.dirname)(above) !== above) above = (0, import_node_path3.dirname)(above);
    try {
      waiting = (0, import_node_fs2.watch)(above, () => {
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
      for (const watcher of watchers2.values()) watcher.close();
      watchers2.clear();
    }
  };
}
var warned = false;
function refused(directory, error) {
  const code = error.code;
  if (code === "ENOENT" || code === "ENOTDIR" || warned) return;
  warned = true;
  const hint = code === "ENOSPC" ? " The system's limit on watches is reached: raise fs.inotify.max_user_watches (sysctl)." : "";
  console.warn(`svelte-native: cannot watch ${directory} (${code ?? String(error)}); changes below it are not picked up until Metro restarts.${hint}`);
}
function isDirectory(path) {
  try {
    return (0, import_node_fs2.statSync)(path).isDirectory();
  } catch {
    return false;
  }
}

// src/build.ts
var require2 = (0, import_node_module.createRequire)(__importMetaUrl);
var posix = (path) => path.split(import_node_path4.sep).join("/");
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
    for (const item of (0, import_node_fs3.readdirSync)(directory, { withFileTypes: true })) {
      const path = (0, import_node_path4.resolve)(directory, item.name);
      if (item.isDirectory()) {
        if (lab || item.name !== LAB_DIRECTORY) walk(path);
      } else paths.push(posix((0, import_node_path4.relative)(routesRoot, path)));
    }
  }
  walk(routesRoot);
  const { parse: parse2 } = require2("svelte/compiler");
  const files = [];
  const labDirectories = [];
  for (const path of paths.sort((a, b) => a.localeCompare(b))) {
    const name = path.slice(path.lastIndexOf("/") + 1);
    if (name !== "+mobile.svelte" && name !== "+layout.mobile.svelte") continue;
    const ast = parse2((0, import_node_fs3.readFileSync)((0, import_node_path4.resolve)(routesRoot, path), "utf8"), { modern: true, filename: path });
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
  const code = (file) => `require(${json(posix((0, import_node_path4.relative)(output, (0, import_node_path4.resolve)(routesRoot, file))))}).default`;
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
import type { StackNode } from '@alfayez/svelte-native/router';

export const variant = ${json(variant)};
export const lab = ${lab};
export const tree: StackNode = ${nodeOf(tree, "").trimStart()};
`;
}
function syncRoutes(root, options = {}) {
  const variant = options.variant ?? variantName();
  const lab = options.lab ?? labIncludedFor(variant);
  const routesRoot = (0, import_node_path4.resolve)(root, "src/routes");
  const output = (0, import_node_path4.resolve)(root, ".svelte-native");
  (0, import_node_fs3.mkdirSync)(output, { recursive: true });
  const manifest = treeModule(buildTree(routeFilesSync(routesRoot, { lab })), routesRoot, output, variant, lab);
  const customRoot = process.env.SVELTE_NATIVE_ROOT;
  const prelude = "import '@alfayez/svelte-native/init';\nimport '@alfayez/svelte-native/polyfills';\nimport { createFabricApp, remountSurfaces } from '@alfayez/svelte-native/fabric';\n";
  const hot = "declare const module: { hot?: { accept(callback?: () => void): void } };\nif (__DEV__) module.hot?.accept(() => remountSurfaces());\n";
  const entry = customRoot ? `${prelude}import App from ${JSON.stringify(posix((0, import_node_path4.relative)(output, (0, import_node_path4.resolve)(root, customRoot))))};
createFabricApp(App, {});
${hot}` : `${prelude}import App from '../src/routes/+layout.mobile.svelte';
import { tree } from './routes';
createFabricApp(App, { tree });
${hot}`;
  const files = [[routesTableFile(variant), manifest]];
  if (options.entry !== "keep" || customRoot !== void 0 || !(0, import_node_fs3.existsSync)((0, import_node_path4.resolve)(output, "entry.ts"))) files.push(["entry.ts", entry]);
  for (const [file, content] of files) {
    const destination = (0, import_node_path4.resolve)(output, file);
    let current = "";
    try {
      current = (0, import_node_fs3.readFileSync)(destination, "utf8");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    if (current !== content) (0, import_node_fs3.writeFileSync)(destination, content);
  }
  (0, import_node_fs3.rmSync)((0, import_node_path4.resolve)(output, "routes.ts"), { force: true });
}
function unrefTimer(timer) {
  timer.unref?.();
}
function watchRoutes(root, options = {}, debounceMs = 50) {
  return watchTree((0, import_node_path4.resolve)(root, "src/routes"), () => {
    try {
      syncRoutes(root, options);
    } catch (error) {
      console.error(error);
    }
  }, { debounceMs, skip: (name) => name === "node_modules" });
}

// src/css/build.ts
var import_node_child_process = require("node:child_process");
var import_node_crypto = require("node:crypto");
var import_node_fs4 = require("node:fs");
var import_node_module2 = require("node:module");
var import_node_path5 = require("node:path");

// src/css/parse.ts
function readChunk(css, from) {
  let text = "";
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
      if (space && text !== "") text += " ";
      space = false;
      text += c + (css[i + 1] ?? "");
      i += 2;
      continue;
    }
    if (c === '"' || c === "'") {
      if (space && text !== "") text += " ";
      space = false;
      let j = i + 1;
      while (j < css.length && css[j] !== c) j += css[j] === "\\" ? 2 : 1;
      text += css.slice(i, j + 1);
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
    if (space && text !== "") text += " ";
    space = false;
    text += c;
    i++;
  }
  return { text, end: i };
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
      const { text: text2, end: end2 } = readChunk(css, i + 1);
      const space = text2.search(/[\s(]/);
      const name = (space < 0 ? text2 : text2.slice(0, space)).toLowerCase();
      const prelude = space < 0 ? "" : text2.slice(space).trim();
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
    const { text, end } = readChunk(css, i);
    if (css[end] === "{") {
      const inner = parseBody(css, end + 1, true);
      items.push({ kind: "rule", selector: text, body: inner.items });
      i = inner.end;
      continue;
    }
    i = css[end] === ";" ? end + 1 : end;
    const colon = indexOfTop(text, ":");
    if (colon <= 0) continue;
    const property = text.slice(0, colon).trim();
    let value = text.slice(colon + 1).trim();
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
function indexOfTop(text, char) {
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "\\") i++;
    else if (c === '"' || c === "'") {
      i++;
      while (i < text.length && text[i] !== c) i += text[i] === "\\" ? 2 : 1;
    } else if (c === "(" || c === "[") depth++;
    else if (c === ")" || c === "]") depth--;
    else if (depth === 0 && c === char) return i;
  }
  return -1;
}
function splitTop(text, separator) {
  const parts = [];
  let depth = 0;
  let start = 0;
  const push = (end) => {
    const part = text.slice(start, end).trim();
    if (part !== "" || separator === ",") parts.push(part);
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "\\") i++;
    else if (c === '"' || c === "'") {
      i++;
      while (i < text.length && text[i] !== c) i += text[i] === "\\" ? 2 : 1;
    } else if (c === "(" || c === "[") depth++;
    else if (c === ")" || c === "]") depth--;
    else if (depth === 0 && (separator === "," ? c === "," : c === " ")) {
      push(i);
      start = i + 1;
    }
  }
  push(text.length);
  return parts;
}
function readIdent(text, from) {
  let name = "";
  let i = from;
  while (i < text.length) {
    const c = text[i];
    if (c === "\\") {
      const hex = /^[0-9a-fA-F]{1,6}/.exec(text.slice(i + 1, i + 7));
      if (hex) {
        const code = Number.parseInt(hex[0], 16);
        name += String.fromCodePoint(code === 0 || code > 1114111 ? 65533 : code);
        i += 1 + hex[0].length;
        if (/\s/.test(text[i] ?? "")) i++;
      } else {
        name += text[i + 1] ?? "";
        i += 2;
      }
    } else if (/[\w-]/.test(c) || c.charCodeAt(0) > 127) {
      name += c;
      i++;
    } else break;
  }
  return { name, end: i };
}
var ROOT_SELECTORS = /* @__PURE__ */ new Set([":root", ":host", "html"]);
function classifySelector(selector) {
  const text = selector.trim();
  if (ROOT_SELECTORS.has(text)) return { kind: "root" };
  if (text[0] === "." && text.length > 1) {
    const { name, end } = readIdent(text, 1);
    if (end === text.length && name !== "") return { kind: "class", className: name };
  }
  return { kind: "unsupported", className: firstClass(text), reason: describeSelector(text) };
}
function firstClass(text) {
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "\\") i++;
    else if (c === '"' || c === "'") {
      i++;
      while (i < text.length && text[i] !== c) i += text[i] === "\\" ? 2 : 1;
    } else if (c === "[") {
      const close = text.indexOf("]", i);
      i = close < 0 ? text.length : close;
    } else if (c === ".") {
      const { name, end } = readIdent(text, i + 1);
      if (name !== "") return name;
      i = end;
    }
  }
  return null;
}
function describeSelector(text) {
  const pseudo = [];
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "\\") i++;
    else if (c === ":") {
      const element2 = text[i + 1] === ":";
      const { name, end } = readIdent(text, i + (element2 ? 2 : 1));
      pseudo.push({ element: element2, name });
      i = end - 1;
    }
  }
  const element = pseudo.find((p) => p.element);
  if (element) return `pseudo-element ::${element.name} (selector ${text})`;
  if (/[>~]|\s\+\s/.test(text)) return `combinator in selector ${text}`;
  const wrappers = /* @__PURE__ */ new Set(["is", "where", "not", "has", "matches"]);
  const named = pseudo.find((p) => !wrappers.has(p.name));
  if (named) return `pseudo-class :${named.name} (selector ${text})`;
  if (pseudo.length > 0) return `functional pseudo-class :${pseudo[0].name}() depends on other elements (selector ${text})`;
  if (splitTop(text, " ").length > 1) return `combinator in selector ${text}`;
  if (text.startsWith(".") && text.indexOf(".", 1) > 0) return `several classes in selector ${text}`;
  if (text[0] !== ".") return `not a class selector (${text})`;
  return `selector ${text} is not a single class`;
}

// src/css/color.ts
var NAMED = {
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
var clamp01 = (v) => Math.min(1, Math.max(0, v));
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
var isError = (value) => "error" in value;
function component(text, percentScale) {
  if (text === "none") return 0;
  const match = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)(%?)$/i.exec(text);
  if (!match) return null;
  const n = Number(match[1]);
  return match[2] === "%" ? n / 100 * percentScale : n;
}
function angle(text) {
  if (text === "none") return 0;
  const match = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)(deg|grad|rad|turn)?$/i.exec(text);
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
function alphaOf(text) {
  if (text === void 0) return 1;
  const value = component(text, 1);
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
function parseHex(text) {
  const digits = text.slice(1);
  if (!/^[0-9a-f]+$/i.test(digits) || ![3, 4, 6, 8].includes(digits.length)) return { error: `${text} is not a hex color` };
  const full = digits.length <= 4 ? [...digits].map((d) => d + d).join("") : digits;
  const byte = (i) => Number.parseInt(full.slice(i * 2, i * 2 + 2), 16) / 255;
  return { space: "srgb", c: [byte(0), byte(1), byte(2)], alpha: full.length === 8 ? byte(3) : 1 };
}
function parseColor(text) {
  const value = text.trim();
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
    let text = part;
    const lead = /^(\d+\.?\d*|\.\d+)%\s+(.+)$/.exec(part);
    const tail = /^(.+?)\s+(\d+\.?\d*|\.\d+)%$/.exec(part);
    if (lead) {
      percent = Number(lead[1]);
      text = lead[2];
    } else if (tail) {
      percent = Number(tail[2]);
      text = tail[1];
    }
    const color = parseColor(text);
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
function convertColor(text) {
  const parsed = parseColor(text);
  if (isError(parsed)) return parsed;
  return { color: toRgbString(parsed) };
}
function colorAlpha(color) {
  const match = /^rgba\(.*,\s*([\d.]+)\)$/.exec(color);
  return match ? Number(match[1]) : 1;
}

// src/css/table.ts
var TRANSFORM_KEYS = ["transform:translateX", "transform:translateY", "transform:rotate", "transform:rotateX", "transform:rotateY", "transform:scaleX", "transform:scaleY"];

// src/css/values.ts
function closingParen(text, open) {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (c === "\\") i++;
    else if (c === '"' || c === "'") {
      i++;
      while (i < text.length && text[i] !== c) i += text[i] === "\\" ? 2 : 1;
    } else if (c === "(") depth++;
    else if (c === ")" && --depth === 0) return i;
  }
  return -1;
}
function nextVar(text, from) {
  for (let i = from; i < text.length; i++) {
    const c = text[i];
    if (c === '"' || c === "'") {
      i++;
      while (i < text.length && text[i] !== c) i += text[i] === "\\" ? 2 : 1;
    } else if (c === "v" && text.startsWith("var(", i) && !/[\w-]/.test(text[i - 1] ?? " ")) return i;
  }
  return -1;
}
function substituteVars(text, lookup, depth = 0) {
  if (depth > 32) return { error: "var() references itself" };
  let out = "";
  let i = 0;
  while (i < text.length) {
    const at = nextVar(text, i);
    if (at < 0) {
      out += text.slice(i);
      break;
    }
    out += text.slice(i, at);
    const close = closingParen(text, at + 3);
    if (close < 0) return { error: `unbalanced var() in ${text}` };
    const inner = text.slice(at + 4, close);
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
function soleVar(text) {
  const match = /^var\(\s*(--[^\s,()]+)\s*\)$/.exec(text.trim());
  return match ? match[1] : null;
}
var INSETS = ["top", "right", "bottom", "left"];
var ABSOLUTE_PX = { px: 1, pt: 96 / 72, pc: 16, in: 96, cm: 96 / 2.54, mm: 96 / 25.4, q: 96 / 101.6 };
var WINDOW_WIDTH_UNITS = /* @__PURE__ */ new Set(["vw", "svw", "lvw", "dvw"]);
var WINDOW_HEIGHT_UNITS = /* @__PURE__ */ new Set(["vh", "svh", "lvh", "dvh"]);
function clean(x) {
  const rounded = Math.round(x * 1e6) / 1e6;
  return Math.abs(rounded - x) < 1e-9 ? rounded : x;
}
var isNumber = (q) => Object.keys(q).every((k) => k === "");
var merge = (a, b, sign) => {
  const hasPlain = (q) => "" in q;
  if (hasPlain(a) !== hasPlain(b)) return null;
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = (out[k] ?? 0) + sign * v;
  return out;
};
var scale = (q, factor) => Object.fromEntries(Object.entries(q).map(([k, v]) => [k, v * factor]));
var Evaluator = class _Evaluator {
  pos = 0;
  // Fields, not parameter properties: Node strips the types of a file it loads itself (the transformer from the sources) and does not do those.
  text;
  remPx;
  constructor(text, remPx) {
    this.text = text;
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
    const sign = this.text[this.pos];
    if ((sign === "+" || sign === "-") && !/[\d.]/.test(this.text[this.pos + 1] ?? "")) {
      this.pos++;
      const value = this.unary();
      return sign === "-" ? scale(value, -1) : value;
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
  sub(text) {
    const result = new _Evaluator(text, this.remPx).run();
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
      const args = splitTop(inner, ",").map((arg) => this.sub(arg));
      const unit = singleUnit(args);
      if (unit === null || INSETS.some((side) => side === unit) || unit === "vw" || unit === "vh") {
        throw new Error(`${name}() over different units, or over the device's insets or window, cannot be resolved at build time`);
      }
      const values = args.map((arg) => arg[unit] ?? 0);
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
function singleUnit(args) {
  let unit = null;
  for (const arg of args) {
    const keys = Object.keys(arg);
    if (keys.length !== 1) return null;
    if (unit !== null && unit !== keys[0]) return null;
    unit = keys[0];
  }
  return unit;
}
function evaluate(text, remPx) {
  return new Evaluator(text.trim(), remPx).run();
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

// src/css/properties.ts
var emptyResult = () => ({ style: {}, dynamic: {}, fontRelative: {} });
var isEmptyResult = (result) => Object.keys(result.style).length + Object.keys(result.dynamic).length + Object.keys(result.fontRelative).length === 0;
function own(table, key) {
  return Object.hasOwn(table, key) ? table[key] : void 0;
}
var Declaration = class {
  // Fields, not parameter properties: Node strips the types of a file it loads itself (the transformer from the sources, `lower-html.ts` through `inline.ts`) and does not do those.
  property;
  env;
  out;
  report;
  constructor(property, env, out, report) {
    this.property = property;
    this.env = env;
    this.out = out;
    this.report = report;
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
  length(key, text, options = {}) {
    const keyword = options.keywords === void 0 ? void 0 : own(options.keywords, text.trim().toLowerCase());
    if (keyword !== void 0) {
      this.set(key, keyword);
      return true;
    }
    if (/^[a-z][a-z-]*$/i.test(text.trim()) && !/^(infinity|pi|e)$/i.test(text.trim())) return this.bad(`${text} has no React Native equivalent`);
    const evaluated = evaluate(text, this.env.remPx);
    if ("error" in evaluated) return this.bad(evaluated.error);
    const length = toLength(evaluated.q, { percent: options.percent === true });
    if ("error" in length) return this.bad(`${text}: ${length.error}`);
    if ("dynamic" in length) this.setDynamic(key, length.dynamic);
    else this.set(key, length.value);
    return true;
  }
  number(key, text, options = {}) {
    const evaluated = evaluate(text, this.env.remPx);
    if ("error" in evaluated) return this.bad(evaluated.error);
    const number = toNumber(evaluated.q, options);
    if ("error" in number) return this.bad(`${text} is not a number`);
    this.set(key, number.value);
    return true;
  }
  color(keys, text) {
    const color = convertColor(text);
    if ("error" in color) return this.bad(color.error);
    for (const key of keys) this.set(key, color.color);
    return true;
  }
  keyword(key, text, map) {
    const value = own(map, text.trim().toLowerCase());
    if (value === void 0) return this.bad(`${text} has no React Native equivalent`);
    this.set(key, value);
    return true;
  }
  quantity(text) {
    const evaluated = evaluate(text, this.env.remPx);
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
var same = (...words) => Object.fromEntries(words.map((word) => [word, word]));
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
  return (d, text) => {
    const values = around(splitTop(text, " "));
    if (values === null) return d.fail(`${text} is not one to four values`);
    for (const [i, key] of keys.entries()) write(d, key, values[i]);
  };
}
function twoEdges(keys, write) {
  return (d, text) => {
    const values = pair(splitTop(text, " "));
    if (values === null) return d.fail(`${text} is not one or two values`);
    for (const [i, key] of keys.entries()) write(d, key, values[i]);
  };
}
function one(key, write) {
  return (d, text) => write(d, key, text);
}
var spacing = (d, key, text) => d.length(key, text, { percent: true });
var margin = (d, key, text) => d.length(key, text, { percent: true, keywords: { auto: "auto" } });
var sizing = (d, key, text) => d.length(key, text, { percent: true, keywords: { auto: "auto" } });
var maxSizing = (d, key, text) => d.length(key, text, { percent: true, keywords: { auto: "auto", none: null } });
var borderWidth = (d, key, text) => d.length(key, text, { keywords: { thin: 1, medium: 3, thick: 5 } });
var borderColor = (d, key, text) => void d.color([key], text);
var radius = (d, key, text) => {
  const q = d.quantity(text);
  if (q === null) return;
  const px = q.px ?? 0;
  if (Object.keys(q).length === 1 && "px" in q && px > 1e6) d.set(key, 9999);
  else d.length(key, text, { percent: true });
};
var SIDE_KEYS = (prefix, suffix = "") => [`${prefix}Top${suffix}`, `${prefix}Right${suffix}`, `${prefix}Bottom${suffix}`, `${prefix}Left${suffix}`];
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
var handlers = {};
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
handlers["border-radius"] = (d, text) => {
  if (text.includes("/")) return d.fail("elliptical radii (a / b) are not supported");
  const values = around(splitTop(text, " "));
  if (values === null) return d.fail(`${text} is not one to four values`);
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
  handlers[property] = (d, text) => {
    if (splitTop(text, " ").length > 1) return d.fail("elliptical radii (two values) are not supported");
    radius(d, key, text);
  };
}
function noBorder(d) {
  d.set("borderStyle", null);
  for (const key of SIDE_KEYS("border", "Width")) d.set(key, 0);
}
handlers["border-style"] = (d, text) => {
  const values = splitTop(text, " ");
  if (values.some((value) => value !== values[0])) return d.fail("a different border style per side is not supported");
  if (values[0] === "none" || values[0] === "hidden") return noBorder(d);
  d.keyword("borderStyle", values[0] ?? "", same("solid", "dashed", "dotted"));
};
for (const side of ["top", "right", "bottom", "left", "inline", "block", "inline-start", "inline-end", "block-start", "block-end"]) {
  handlers[`border-${side}-style`] = (d) => d.fail("a border style per side is not supported (React Native has one borderStyle)");
}
function borderShorthand(widthKeys, colorKeys) {
  return (d, text) => {
    for (const part of splitTop(text, " ")) {
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
handlers.border = borderShorthand(SIDE_KEYS("border", "Width"), SIDE_KEYS("border", "Color"));
for (const side of ["Top", "Right", "Bottom", "Left"]) handlers[`border-${side.toLowerCase()}`] = borderShorthand([`border${side}Width`], [`border${side}Color`]);
handlers["border-inline"] = borderShorthand(["borderLeftWidth", "borderRightWidth"], ["borderLeftColor", "borderRightColor"]);
handlers["border-block"] = borderShorthand(["borderTopWidth", "borderBottomWidth"], ["borderTopColor", "borderBottomColor"]);
handlers["background-color"] = (d, text) => void d.color(["backgroundColor"], text);
handlers.color = (d, text) => void d.color(["color"], text);
handlers.background = (d, text) => {
  if (splitTop(text, " ").length > 1 || /^(url|linear-gradient|radial-gradient|conic-gradient)\(/i.test(text)) return d.fail("only a background color is supported");
  d.color(["backgroundColor"], text);
};
handlers.display = (d, text) => {
  if (d.keyword("display", text, { flex: "flex", "inline-flex": "flex", block: "flex", "inline-block": "flex", inline: "flex", "flow-root": "flex", none: "none", contents: "contents" })) d.set("htmlDisplay", text.trim().toLowerCase());
};
handlers.position = (d, text) => void d.keyword("position", text, same("absolute", "relative", "static"));
handlers["z-index"] = (d, text) => text.trim() === "auto" ? d.set("zIndex", null) : void d.number("zIndex", text);
handlers.overflow = (d, text) => {
  const values = splitTop(text, " ");
  if (values.length > 1 && values[0] !== values[1]) return d.fail("a different overflow per axis is not supported");
  d.keyword("overflow", values[0] ?? "", { visible: "visible", hidden: "hidden", clip: "hidden", scroll: "scroll", auto: "scroll" });
};
handlers.opacity = (d, text) => void d.number("opacity", text, { percent: true });
handlers["flex-direction"] = (d, text) => void d.keyword("flexDirection", text, same("row", "row-reverse", "column", "column-reverse"));
handlers["flex-wrap"] = (d, text) => void d.keyword("flexWrap", text, same("wrap", "nowrap", "wrap-reverse"));
handlers["flex-grow"] = (d, text) => void d.number("flexGrow", text);
handlers["flex-shrink"] = (d, text) => void d.number("flexShrink", text);
handlers["flex-basis"] = (d, text) => void d.length("flexBasis", text, { percent: true, keywords: { auto: "auto" } });
handlers.flex = (d, text) => {
  const word = text.trim().toLowerCase();
  const presets = { none: [0, 0, "auto"], auto: [1, 1, "auto"], initial: [0, 1, "auto"] };
  const preset = own(presets, word);
  if (preset !== void 0) {
    d.set("flexGrow", preset[0]);
    d.set("flexShrink", preset[1]);
    d.set("flexBasis", preset[2]);
    return;
  }
  const parts = splitTop(text, " ");
  const isFactor = (part) => /^[+-]?(\d+\.?\d*|\.\d+)$/.test(part) || /^calc\(\s*[\d.\s*/+-]+\)$/.test(part);
  const factors = [];
  while (parts.length > 0 && factors.length < 2 && isFactor(parts[0])) factors.push(parts.shift());
  if (parts.length > 1) return d.fail(`${text} is not a flex shorthand`);
  d.number("flexGrow", factors[0] ?? "1");
  d.number("flexShrink", factors[1] ?? "1");
  if (parts[0] === void 0) return d.set("flexBasis", 0);
  d.length("flexBasis", parts[0], { percent: true, keywords: { auto: "auto" } });
  if (d.out.style.flexBasis === "0%") d.set("flexBasis", 0);
};
handlers["align-items"] = (d, text) => void d.keyword("alignItems", text, { "flex-start": "flex-start", start: "flex-start", "flex-end": "flex-end", end: "flex-end", center: "center", stretch: "stretch", normal: "stretch", baseline: "baseline" });
handlers["align-self"] = (d, text) => void d.keyword("alignSelf", text, { auto: "auto", "flex-start": "flex-start", start: "flex-start", "flex-end": "flex-end", end: "flex-end", center: "center", stretch: "stretch", baseline: "baseline" });
handlers["align-content"] = (d, text) => {
  d.keyword("alignContent", text, { "flex-start": "flex-start", start: "flex-start", "flex-end": "flex-end", end: "flex-end", center: "center", stretch: "stretch", normal: "stretch", "space-between": "space-between", "space-around": "space-around", "space-evenly": "space-evenly" });
};
handlers["justify-content"] = (d, text) => {
  d.keyword("justifyContent", text, { "flex-start": "flex-start", start: "flex-start", normal: "flex-start", "flex-end": "flex-end", end: "flex-end", center: "center", "space-between": "space-between", "space-around": "space-around", "space-evenly": "space-evenly" });
};
handlers.gap = (d, text) => {
  const values = pair(splitTop(text, " "));
  if (values === null) return d.fail(`${text} is not one or two values`);
  d.length("rowGap", values[0]);
  d.length("columnGap", values[1]);
};
handlers["row-gap"] = (d, text) => void d.length("rowGap", text);
handlers["column-gap"] = (d, text) => void d.length("columnGap", text);
handlers["aspect-ratio"] = (d, text) => {
  if (text.trim() === "auto") return d.set("aspectRatio", null);
  const [a, b, extra] = text.split("/");
  if (extra !== void 0 || a?.trim() === "auto") return d.fail(`${text} has no React Native equivalent`);
  const ratio = (part) => {
    const q = d.quantity(part);
    const n = q === null ? null : toNumber(q);
    return n === null || "error" in n ? null : n.value;
  };
  const numerator = ratio(a ?? "");
  const denominator = b === void 0 ? 1 : ratio(b);
  if (numerator === null || denominator === null || denominator === 0) return d.fail(`${text} is not a ratio`);
  d.set("aspectRatio", numerator / denominator);
};
handlers["font-size"] = (d, text) => void d.length("fontSize", text);
handlers["font-weight"] = (d, text) => {
  const word = text.trim().toLowerCase();
  if (word === "normal") return d.set("fontWeight", "400");
  if (word === "bold") return d.set("fontWeight", "700");
  const q = d.quantity(text);
  const n = q === null ? null : toNumber(q);
  if (n === null || "error" in n) return d.fail(`font-weight ${text} is not a number`);
  d.set("fontWeight", String(n.value));
};
handlers["font-style"] = (d, text) => void d.keyword("fontStyle", text, { normal: "normal", italic: "italic", oblique: "italic" });
handlers["font-family"] = (d, text) => {
  const first = (splitTop(text, ",")[0] ?? "").replace(/^["']|["']$/g, "").trim();
  if (first === "") return d.fail("empty font-family");
  const alias = { "ui-monospace": "monospace", "ui-serif": "serif", "ui-sans-serif": "System", "ui-rounded": "System", "system-ui": "System", "-apple-system": "System", blinkmacsystemfont: "System" };
  d.set("fontFamily", own(alias, first.toLowerCase()) ?? first);
};
handlers["line-height"] = (d, text) => {
  if (text.trim().toLowerCase() === "normal") return d.set("lineHeight", null);
  const q = d.quantity(text);
  if (q === null) return;
  const dims = Object.keys(q).filter((k) => q[k] !== 0);
  if (dims.length === 1 && dims[0] === "") d.setRelative("lineHeight", clean(q[""]));
  else if (dims.length === 1 && dims[0] === "em") d.setRelative("lineHeight", clean(q.em));
  else if (dims.length === 1 && dims[0] === "%") d.setRelative("lineHeight", clean(q["%"] / 100));
  else d.length("lineHeight", text);
};
handlers["letter-spacing"] = (d, text) => {
  if (text.trim().toLowerCase() === "normal") return d.set("letterSpacing", 0);
  const q = d.quantity(text);
  if (q === null) return;
  const dims = Object.keys(q).filter((k) => q[k] !== 0);
  if (dims.length === 1 && dims[0] === "em") d.setRelative("letterSpacing", clean(q.em));
  else d.length("letterSpacing", text);
};
handlers["text-align"] = (d, text) => void d.keyword("textAlign", text, { left: "left", right: "right", center: "center", justify: "justify", start: "auto" });
handlers["text-transform"] = (d, text) => void d.keyword("textTransform", text, same("none", "uppercase", "lowercase", "capitalize"));
var decorationLine = (d, text) => {
  const words = splitTop(text.toLowerCase(), " ");
  if (words.some((word) => !["underline", "line-through", "none"].includes(word))) return d.fail(`${text} is not supported (underline, line-through and none are)`);
  d.set("textDecorationLine", words.join(" "));
};
handlers["text-decoration-line"] = decorationLine;
handlers["text-decoration"] = (d, text) => {
  if (splitTop(text, " ").length > 1) return d.fail("only the decoration line is supported in text-decoration");
  decorationLine(d, text);
};
function components(d, text) {
  const out = [];
  for (const part of splitTop(text, " ")) {
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
var rawHandlers = {
  translate(d, text) {
    if (text.trim() === "none") {
      d.set("transform:translateX", null);
      d.set("transform:translateY", null);
      return;
    }
    const resolved = components(d, text);
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
  scale(d, text) {
    if (text.trim() === "none") {
      d.set("transform:scaleX", null);
      d.set("transform:scaleY", null);
      return;
    }
    const resolved = components(d, text);
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
  rotate(d, text) {
    if (text.trim() === "none") {
      for (const key of ["transform:rotate", "transform:rotateX", "transform:rotateY"]) d.set(key, null);
      return;
    }
    const resolved = components(d, text);
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
handlers["box-shadow"] = (d, text) => {
  if (text.trim().toLowerCase() === "none") return d.set("boxShadow", null);
  const layers = [];
  for (const layer of splitTop(text, ",")) {
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
handlers.transform = (d, text) => {
  if (text.trim().toLowerCase() !== "none") return d.fail(`transform: ${text} is not supported (the translate, rotate and scale properties are)`);
  for (const key of TRANSFORM_KEYS) d.set(key, null);
};
var GLOBAL_KEYWORDS = /* @__PURE__ */ new Set(["inherit", "initial", "unset", "revert", "revert-layer"]);
function convertDeclaration(property, value, env, out, report) {
  const raw = own(rawHandlers, property);
  const handler = raw ?? own(handlers, property);
  const declaration = new Declaration(property, env, out, report);
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
  const text = resolved.text.trim();
  if (GLOBAL_KEYWORDS.has(text.toLowerCase())) declaration.fail(`${text} has no meaning in a class table`);
  else if (text === "") declaration.fail("empty value");
  else handler(declaration, text);
}

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
  const text = queries[0].replace(/^only\s+/, "");
  if (/^not\s/.test(text)) return { error: `@media ${prelude} is not supported` };
  for (const part of text.split(/\s+and\s+/)) {
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
function pixels(text, remPx) {
  const q = evaluate(text, remPx);
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
var SILENT_AT_RULES = /* @__PURE__ */ new Set(["property", "keyframes", "font-face", "import", "charset", "namespace", "page", "counter-style", "font-palette-values", "font-feature-values", "view-transition"]);
var Converter = class {
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
      const group = decls.filter((decl) => decl.important === important);
      if (group.length === 0) continue;
      const seq = this.seq++;
      const rank = this.rank(ctx.layer, important);
      const results = this.resultsFor(className, group, ctx.when.scheme, own2);
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
function convertCss(css, options = {}) {
  return new Converter(options.remPx ?? 16).run(css);
}

// src/css/build.ts
var TAILWIND_VERSION = "4.3.3";
var SOURCE_EXTENSIONS = /* @__PURE__ */ new Set([".svelte", ".ts", ".js"]);
var SKIPPED_DIRECTORIES = /* @__PURE__ */ new Set(["node_modules", ".svelte-native"]);
var LONGEST_CANDIDATE = 300;
function sourceFiles(root) {
  const files = [];
  const walk = (directory) => {
    for (const item of (0, import_node_fs4.readdirSync)(directory, { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : 1)) {
      const path = (0, import_node_path5.join)(directory, item.name);
      if (item.isDirectory()) {
        if (!SKIPPED_DIRECTORIES.has(item.name)) walk(path);
      } else if (SOURCE_EXTENSIONS.has((0, import_node_path5.extname)(item.name))) files.push(path);
    }
  };
  if ((0, import_node_fs4.existsSync)((0, import_node_path5.join)(root, "src"))) walk((0, import_node_path5.join)(root, "src"));
  return files;
}
var isClassCharacter = (code) => code >= 48 && code <= 58 || code >= 65 && code <= 90 || code >= 97 && code <= 122 || code === 45 || code === 95 || code === 47 || code === 46 || code === 37 || code === 35 || code === 33 || code === 64 || code === 42 || code === 40 || code === 41;
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
function candidatesOf(root) {
  const candidates = /* @__PURE__ */ new Set();
  for (const file of sourceFiles(root)) candidatesIn((0, import_node_fs4.readFileSync)(file, "utf8"), candidates);
  return [...candidates].sort();
}
function loadTailwind(root) {
  const fromApp = (0, import_node_module2.createRequire)((0, import_node_path5.join)(root, "package.json"));
  const install = `pnpm add -D tailwindcss@${TAILWIND_VERSION}`;
  let directory;
  let manifest;
  try {
    const manifestFile = fromApp.resolve("tailwindcss/package.json");
    directory = (0, import_node_path5.dirname)(manifestFile);
    manifest = JSON.parse((0, import_node_fs4.readFileSync)(manifestFile, "utf8"));
  } catch (error) {
    throw new Error(`svelte-native: the css option needs Tailwind CSS in the app: ${install} (${error.message.split("\n")[0]})`, { cause: error });
  }
  if (!manifest.version?.startsWith("4.")) throw new Error(`svelte-native: the css option needs Tailwind CSS 4, the app has ${manifest.version ?? "an unknown version"}: ${install}`);
  return { tailwind: fromApp("tailwindcss"), directory };
}
function exportedStylesheet(exports2, key) {
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
  if (exports2 === null || typeof exports2 !== "object" || Array.isArray(exports2)) return key === "." ? pick(exports2) : void 0;
  const entries = exports2;
  return Object.keys(entries).some((name) => name.startsWith(".")) ? pick(entries[key]) : key === "." ? pick(entries) : void 0;
}
function packageStylesheet(id, base) {
  const name = id.startsWith("@") ? id.split("/").slice(0, 2).join("/") : id.split("/")[0];
  const subpath = id.slice(name.length);
  for (let directory = base; ; directory = (0, import_node_path5.dirname)(directory)) {
    const packageDirectory = (0, import_node_path5.join)(directory, "node_modules", name);
    const manifestFile = (0, import_node_path5.join)(packageDirectory, "package.json");
    if ((0, import_node_fs4.existsSync)(manifestFile)) {
      const manifest = JSON.parse((0, import_node_fs4.readFileSync)(manifestFile, "utf8"));
      let target;
      if (subpath === "") target = exportedStylesheet(manifest.exports, ".") ?? manifest.style ?? (manifest.main?.endsWith(".css") ? manifest.main : void 0);
      else {
        for (const file of [(0, import_node_path5.join)(packageDirectory, subpath), (0, import_node_path5.join)(packageDirectory, `${subpath}.css`)]) if ((0, import_node_fs4.existsSync)(file) && (0, import_node_fs4.statSync)(file).isFile()) return file;
        target = exportedStylesheet(manifest.exports, `.${subpath}`);
      }
      return target === void 0 ? void 0 : (0, import_node_path5.resolve)(packageDirectory, target);
    }
    if ((0, import_node_path5.dirname)(directory) === directory) return void 0;
  }
}
function stylesheetLoader(tailwindDirectory, read) {
  return async (id, base) => {
    let file;
    if (id === "tailwindcss") file = (0, import_node_path5.join)(tailwindDirectory, "index.css");
    else if (id.startsWith("tailwindcss/")) file = (0, import_node_path5.join)(tailwindDirectory, `${id.slice("tailwindcss/".length).replace(/\.css$/, "")}.css`);
    else if (id.startsWith(".") || (0, import_node_path5.isAbsolute)(id)) file = (0, import_node_path5.resolve)(base, id);
    else {
      const next = (0, import_node_path5.resolve)(base, id);
      file = (0, import_node_fs4.existsSync)(next) && (0, import_node_fs4.statSync)(next).isFile() ? next : packageStylesheet(id, base);
      if (file === void 0) {
        try {
          file = (0, import_node_module2.createRequire)((0, import_node_path5.join)(base, "noop.js")).resolve(id);
        } catch (error) {
          throw new Error(`svelte-native: cannot resolve @import "${id}" from ${base}: ${error.message.split("\n")[0]}`, { cause: error });
        }
        if (!file.endsWith(".css")) throw new Error(`svelte-native: cannot resolve @import "${id}" from ${base}: ${id} has no CSS file (a "style" export condition or field, or a .css file)`);
      }
    }
    let content;
    try {
      content = (0, import_node_fs4.readFileSync)(file, "utf8");
    } catch (error) {
      throw new Error(`svelte-native: cannot read @import "${id}" from ${base}: ${error.code ?? error.message}`, { cause: error });
    }
    read.add(file);
    return { path: file, base: (0, import_node_path5.dirname)(file), content };
  };
}
var noPlugin = Object.assign(() => ({ handler: () => {
} }), { __isOptionsFunction: true });
function tableSource(table) {
  const lines = (entries) => Object.entries(entries).map(([name, value]) => `${JSON.stringify(name)}: ${JSON.stringify(value)}`);
  const block = (name, entries) => entries.length === 0 ? "" : `  ${JSON.stringify(name)}: {
    ${entries.join(",\n    ")}
  },
`;
  return `// Generated by @alfayez/svelte-native (the css option of withSvelteNative): the classes of the app's CSS as React Native styles.
import type Table from "@alfayez/svelte-native/classes-table";

export default {
  "version": ${JSON.stringify(table.version)},
${block("classes", lines(table.classes)) || '  "classes": {},\n'}${block("unsupported", lines(table.unsupported ?? {}))}} as typeof Table;
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
    current = (0, import_node_fs4.readFileSync)(file, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (current === content) return false;
  (0, import_node_fs4.mkdirSync)((0, import_node_path5.dirname)(file), { recursive: true });
  (0, import_node_fs4.writeFileSync)(file, content);
  return true;
}
var built = /* @__PURE__ */ new Map();
function inputsOf(candidates, entry, stylesheets) {
  const hash = (0, import_node_crypto.createHash)("sha256");
  hash.update(candidates.join("\n"));
  for (const sheet of /* @__PURE__ */ new Set([entry, ...stylesheets])) {
    hash.update("\0");
    try {
      hash.update((0, import_node_fs4.readFileSync)(sheet));
    } catch {
      hash.update("missing");
    }
  }
  return hash.digest("hex");
}
async function buildClasses(options) {
  const root = (0, import_node_path5.resolve)(options.root);
  const entry = (0, import_node_path5.resolve)(root, options.css);
  const file = (0, import_node_path5.join)(root, ".svelte-native", classesTableFile(options.variant));
  if (!(0, import_node_fs4.existsSync)(entry)) throw new Error(`svelte-native: the css option names ${options.css}, which is not a file (relative to ${root})`);
  const candidates = candidatesOf(root);
  const previous = built.get(file);
  const inputs = inputsOf(candidates, entry, previous?.result.stylesheets ?? []);
  if (previous !== void 0 && previous.inputs === inputs && (0, import_node_fs4.existsSync)(file)) return { ...previous.result, changed: false };
  const { tailwind, directory } = loadTailwind(root);
  const read = /* @__PURE__ */ new Set([entry]);
  const skipped = /* @__PURE__ */ new Set();
  const compiler = await tailwind.compile((0, import_node_fs4.readFileSync)(entry, "utf8"), {
    base: (0, import_node_path5.dirname)(entry),
    from: entry,
    loadStylesheet: stylesheetLoader(directory, read),
    loadModule: async (id, base, hint) => {
      skipped.add(`@${hint} "${id}"`);
      return { path: id, base, module: hint === "plugin" ? noPlugin : {} };
    }
  });
  const { table, unsupported } = (options.convert ?? convertCss)(compiler.build(candidates));
  const reasons = unsupportedReasons(unsupported);
  const written = Object.keys(reasons).length === 0 ? table : { ...table, unsupported: { ...table.unsupported, ...reasons } };
  const result = { file, changed: writeIfChanged(file, tableSource(written)), unsupported, stylesheets: [...read], skipped: [...skipped] };
  built.set(file, { inputs: inputsOf(candidates, entry, result.stylesheets), result });
  return result;
}
function buildClassesSync(options) {
  const root = (0, import_node_path5.resolve)(options.root);
  const entry = (0, import_node_path5.resolve)(root, options.css);
  const file = (0, import_node_path5.join)(root, ".svelte-native", classesTableFile(options.variant));
  const previous = built.get(file);
  const candidates = candidatesOf(root);
  const inputs = (0, import_node_fs4.existsSync)(entry) ? inputsOf(candidates, entry, previous?.result.stylesheets ?? []) : "";
  if (previous !== void 0 && previous.inputs === inputs && (0, import_node_fs4.existsSync)(file)) return { ...previous.result, changed: false };
  const cli = process.versions.bun !== void 0 && __filename.endsWith(".ts") ? sourceFile("cli.ts") : (0, import_node_path5.join)(packageRoot, "dist/node/cli.js");
  const run = (0, import_node_child_process.spawnSync)(process.execPath, [cli, "css", options.css, "--variant", options.variant, "--json"], { cwd: root, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  if (run.error) throw new Error(`svelte-native: could not run the CSS build (${run.error.message})`, { cause: run.error });
  if (run.status !== 0) throw new Error(run.stderr.trim() || `svelte-native: the CSS build exited with ${run.status}`);
  const result = JSON.parse(run.stdout);
  built.set(file, { inputs: inputsOf(candidates, entry, result.stylesheets), result });
  return result;
}
var reported = /* @__PURE__ */ new Set();
function reportUnsupported(unsupported, development = process.env.NODE_ENV === "development") {
  if (!development) return;
  const before = reported.size;
  for (const { className } of unsupported) reported.add(className);
  if (reported.size === before) return;
  const count = reported.size;
  console.warn(`svelte-native: ${count} ${count === 1 ? "class the sources mention is" : "classes the sources mention are"} not supported on native; a class that is used warns when it renders`);
}
var reportedSkipped = /* @__PURE__ */ new Set();
function reportSkipped(skipped) {
  const fresh = skipped.filter((line) => !reportedSkipped.has(line));
  if (fresh.length === 0) return;
  for (const line of fresh) reportedSkipped.add(line);
  console.warn(`svelte-native: plugins and JS config do not apply on native: ${fresh.join(", ")} ${fresh.length === 1 ? "is" : "are"} ignored`);
}
function watchClasses(options, stylesheets = [], debounceMs = 100) {
  const root = (0, import_node_path5.resolve)(options.root);
  const source = (0, import_node_path5.join)(root, "src");
  const watchers2 = /* @__PURE__ */ new Map();
  let timer;
  let running = Promise.resolve();
  let closed = false;
  const watchDirectory = (directory, recursive) => {
    if (closed || watchers2.has(directory) || !(0, import_node_fs4.existsSync)(directory)) return;
    const watcher = (0, import_node_fs4.watch)(directory, { recursive }, schedule);
    watcher.unref();
    watchers2.set(directory, watcher);
  };
  const followStylesheets = (files) => {
    for (const directory of new Set(files.map((file) => (0, import_node_path5.dirname)(file))))
      if (!directory.split(import_node_path5.sep).includes("node_modules") && (0, import_node_path5.relative)(source, directory).startsWith("..")) watchDirectory(directory, false);
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
  followStylesheets([(0, import_node_path5.resolve)(root, options.css), ...stylesheets]);
  return {
    close() {
      closed = true;
      clearTimeout(timer);
      tree.close();
      for (const watcher of watchers2.values()) watcher.close();
      watchers2.clear();
    }
  };
}

// src/kit/modules.ts
var KIT_MODULES = {
  "$app/navigation": "kit/navigation.ts",
  "$app/state": "kit/state.ts",
  "$app/env": "kit/env.ts",
  "$app/environment": "kit/env.ts",
  "$app/paths": "kit/paths.ts"
};
var MOTION_MODULE = "kit/motion.ts";
var KIT_UNAVAILABLE = {
  "$app/forms": "forms submit to a SvelteKit server's actions; use remote functions' `form` (docs: Loading data)",
  "$app/manifest": "the manifest lists the web build's files",
  "$app/service-worker": "a device has no service worker",
  "$app/stores": "SvelteKit 3 removed the stores; use `page` from `$app/state`",
  "$app/env/public": "the app has no SvelteKit environment; read what it needs from the app config (`extra`) with expo-constants"
};
function kitResolution(moduleName, origin) {
  if (Object.hasOwn(KIT_MODULES, moduleName)) return sourceFile(KIT_MODULES[moduleName]);
  if (Object.hasOwn(KIT_UNAVAILABLE, moduleName)) throw new Error(`${moduleName} is not available on the device (svelte-native): ${KIT_UNAVAILABLE[moduleName]}. The guide's "SvelteKit modules" page lists what is.`);
  if (moduleName === "svelte/motion" && origin !== sourceFile(MOTION_MODULE)) return sourceFile(MOTION_MODULE);
  return void 0;
}

// src/remote/transform.ts
var import_node_path7 = require("node:path");
var import_parser = require("@babel/parser");

// src/remote/kit.ts
var import_node_module3 = require("node:module");
var import_node_path6 = require("node:path");
var require3 = (0, import_node_module3.createRequire)(__importMetaUrl);
var kitRootCache;
function findKitRoot() {
  if (kitRootCache === void 0) {
    try {
      kitRootCache = (0, import_node_path6.dirname)(require3.resolve("@sveltejs/kit/package.json"));
    } catch {
      kitRootCache = null;
    }
  }
  return kitRootCache;
}
function kitMissingMessage(what) {
  return `${what} needs \`@sveltejs/kit\`, which is not installed (an optional peer dependency of @alfayez/svelte-native: only remote functions and the web target use it). Install the version the package was written against: \`pnpm add @sveltejs/kit@3.1.1\`, and copy its patch (README, "Apply the patches").`;
}
function kitRoot(what = "The remote function runtime (`@alfayez/svelte-native/remote`)") {
  const found = findKitRoot();
  if (found === null) throw new Error(kitMissingMessage(what));
  return found;
}

// src/remote/transform.ts
var posix2 = (path) => path.replaceAll("\\", "/");
var shim = (name) => (0, import_node_path7.join)(sourceDirectory, "remote/shims", name);
function remoteResolution(specifier, origin) {
  if (specifier.startsWith("@sveltejs/kit/src/")) return (0, import_node_path7.join)(kitRoot(), specifier.slice("@sveltejs/kit/".length));
  if (specifier === "@sveltejs/kit/internal") return (0, import_node_path7.join)(kitRoot(), "src/exports/internal/index.js");
  const kit = findKitRoot();
  if (kit === null) return void 0;
  const inside = posix2(origin).startsWith(`${posix2(kit)}/`);
  if (!inside) return void 0;
  switch (specifier) {
    case "#internal":
      return (0, import_node_path7.join)(kit, "src/exports/internal/client.js");
    case "#app/internal/transport":
      return (0, import_node_path7.join)(kit, "src/runtime/app/internal/transport.js");
    case "#app/paths":
      return shim("paths.ts");
    case "#app/state/client":
      return shim("state.ts");
    case "$app/env":
      return shim("env.ts");
  }
  if (specifier.startsWith(".") && (0, import_node_path7.resolve)((0, import_node_path7.dirname)(origin), specifier) === (0, import_node_path7.join)(kit, "src/runtime/client/client.js")) return shim("client.ts");
  return void 0;
}

// src/svelte-build.ts
var import_node_fs5 = require("node:fs");
var import_node_module4 = require("node:module");
var import_node_path8 = require("node:path");
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
    manifestPath = from ?? (0, import_node_module4.createRequire)(__importMetaUrl).resolve("svelte/package.json");
  } catch {
    return { ok: false, version: null, directory: null, reason: "missing" };
  }
  const directory = (0, import_node_path8.dirname)(manifestPath);
  const manifest = JSON.parse((0, import_node_fs5.readFileSync)(manifestPath, "utf8"));
  const version = manifest.version ?? null;
  const exported = manifest.exports !== void 0 && "./renderer" in manifest.exports;
  if (!exported || !(0, import_node_fs5.existsSync)((0, import_node_path8.join)(directory, "src/renderer/index.js"))) return { ok: false, version, directory, reason: "stock-release" };
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

// src/metro.ts
var require4 = (0, import_node_module5.createRequire)(__importMetaUrl);
var nativeSvelte = (0, import_node_path9.dirname)(require4.resolve("svelte/package.json"));
var LITE_ORIGINS = /[\\/]node_modules[\\/](?:\.pnpm[\\/][^\\/]+[\\/]node_modules[\\/])?(?:hermes-intl|expo|expo-modules-core|expo-file-system|react-native-reanimated|react-native-worklets|react-native-is-edge-to-edge|expo-secure-store|expo-image-picker|expo-localization|expo-crypto|expo-constants|expo-font|expo-asset|expo-splash-screen|expo-status-bar|expo-system-ui|expo-keep-awake|expo-application|react-native-svg)[\\/]/;
var INITIALIZE_CORE = /react-native[\\/]Libraries[\\/]Core[\\/]InitializeCore\.js$/;
var RENDERER_STUBS = {
  "react-native/Libraries/ReactNative/RendererProxy.js": "./fabric/renderer-stub.ts",
  "react-native/Libraries/Renderer/shims/ReactFabric.js": "./fabric/react-fabric-stub.ts",
  "react-native/Libraries/Renderer/shims/createReactNativeComponentClass.js": "./fabric/component-class-stub.ts"
};
var watchers = /* @__PURE__ */ new Set();
function closeWatchers() {
  for (const watcher of watchers) watcher.close();
  watchers.clear();
}
var stubCoreSource = `// Generated by @alfayez/svelte-native/metro: what stands in for a package this app does not link.
"use strict";
module.exports = (name, variant) => {
  const fail = () => { throw new Error(name + " is not in this app (APP_VARIANT=" + variant + ")"); };
  // A bound function: callable and constructible, and without the non-configurable prototype property that ownKeys below would have to report.
  return new Proxy(function () {}.bind(null), {
    get: (_target, key) => (key === "__esModule" ? false : typeof key === "symbol" ? undefined : fail()),
    apply: fail,
    construct: fail,
    has: () => false,
    ownKeys: () => [],
    getOwnPropertyDescriptor: () => undefined,
  });
};
`;
function stubSource(name, variant) {
  return `// Generated by @alfayez/svelte-native/metro: ${name} is not linked in this app.
module.exports = require("./_core.js")(${JSON.stringify(name)}, ${JSON.stringify(variant)});
`;
}
var isInPackage = (moduleName, name) => moduleName === name || moduleName.startsWith(`${name}/`);
var resetForLibrary;
function libraryChanged(projectRoot, library = (0, import_node_fs6.realpathSync)(packageRoot)) {
  const record = (0, import_node_path9.join)(projectRoot, ".svelte-native", "metro-library");
  let previous;
  try {
    previous = (0, import_node_fs6.readFileSync)(record, "utf8").trim();
  } catch {
    previous = void 0;
  }
  if (previous === library) return false;
  (0, import_node_fs6.mkdirSync)((0, import_node_path9.dirname)(record), { recursive: true });
  (0, import_node_fs6.writeFileSync)(record, `${library}
`);
  return true;
}
function withSvelteNative(config, options = {}) {
  assertCustomRenderer("withSvelteNative (@alfayez/svelte-native/metro)");
  Object.assign(process.env, runesEnvironment(options.runes), asyncEnvironment(options.async));
  const resolveRequest = config.resolver.resolveRequest;
  const stubbed = options.stubbedPackages ?? [];
  const variant = options.variant ?? variantName();
  const stubDirectory = (0, import_node_path9.join)(config.projectRoot, ".svelte-native", "stubs", variant.replace(/[^A-Za-z0-9_-]/g, "_"));
  const write = (file, content) => {
    let current;
    try {
      current = (0, import_node_fs6.readFileSync)(file, "utf8");
    } catch {
      current = void 0;
    }
    if (current !== content) (0, import_node_fs6.writeFileSync)(file, content);
  };
  const stubs = /* @__PURE__ */ new Map();
  if (stubbed.length > 0) {
    (0, import_node_fs6.mkdirSync)(stubDirectory, { recursive: true });
    write((0, import_node_path9.join)(stubDirectory, "_core.js"), stubCoreSource);
  }
  for (const name of stubbed) {
    const file = (0, import_node_path9.join)(stubDirectory, `${name.replace(/[^A-Za-z0-9_.-]/g, "_")}.js`);
    (0, import_node_fs6.mkdirSync)(stubDirectory, { recursive: true });
    write(file, stubSource(name, variant));
    stubs.set(name, file);
  }
  const withoutExtension = (path) => path.replace(/\.[cm]?[jt]sx?$/, "");
  const nameOf = (path) => withoutExtension(path).slice(config.projectRoot.length + 1);
  const writeStub = (name) => {
    const file = (0, import_node_path9.join)(stubDirectory, `${name.replace(/[^A-Za-z0-9_.-]/g, "_")}.js`);
    (0, import_node_fs6.mkdirSync)(stubDirectory, { recursive: true });
    write((0, import_node_path9.join)(stubDirectory, "_core.js"), stubCoreSource);
    write(file, stubSource(name, variant));
    return file;
  };
  const files = /* @__PURE__ */ new Map();
  for (const path of options.stubbedFiles ?? []) files.set(withoutExtension(path), writeStub(nameOf(path)));
  const directories = /* @__PURE__ */ new Map();
  for (const path of options.stubbedDirectories ?? []) {
    const directory = path.replace(/[\\/]+$/, "");
    directories.set(directory + import_node_path9.sep, writeStub(`${nameOf(directory)}/`));
  }
  const lab = labIncludedFor(variant);
  const entryFile = (0, import_node_path9.join)(config.projectRoot, ".svelte-native", "entry.ts");
  const routesTable = (0, import_node_path9.join)(config.projectRoot, ".svelte-native", routesTableFile(variant));
  if (options.syncRoutes ?? (0, import_node_fs6.existsSync)((0, import_node_path9.join)(config.projectRoot, "src/routes"))) {
    const syncing = { variant, lab, entry: "keep" };
    syncRoutes(config.projectRoot, syncing);
    if (process.env.NODE_ENV === "development") watchers.add(watchRoutes(config.projectRoot, syncing));
  }
  const classesTable = options.css === void 0 ? sourceFile("css/empty-table.ts") : (0, import_node_path9.join)(config.projectRoot, ".svelte-native", classesTableFile(variant));
  if (options.css !== void 0) {
    const building = { root: config.projectRoot, css: options.css, variant };
    const built2 = buildClassesSync(building);
    reportSkipped(built2.skipped);
    reportUnsupported(built2.unsupported);
    if (process.env.NODE_ENV === "development") watchers.add(watchClasses(building, built2.stylesheets));
  }
  const stubFor = (moduleName, origin) => {
    const name = stubbed.find((candidate) => isInPackage(moduleName, candidate));
    if (name !== void 0) return stubs.get(name) ?? null;
    if (files.size > 0 && (moduleName.startsWith("./") || moduleName.startsWith("../"))) return files.get(withoutExtension((0, import_node_path9.resolve)((0, import_node_path9.dirname)(origin), moduleName))) ?? null;
    return null;
  };
  const stubForFile = (filePath) => {
    if (files.size > 0) {
      const own2 = files.get(withoutExtension(filePath));
      if (own2 !== void 0) return own2;
    }
    if (directories.size === 0) return null;
    for (const [directory, stub] of directories) if (filePath.startsWith(directory)) return stub;
    return null;
  };
  const resolver = {
    ...config.resolver,
    sourceExts: [.../* @__PURE__ */ new Set([...config.resolver.sourceExts, "svelte"])],
    resolveRequest: (context, moduleName, platform) => {
      if (moduleName === "@alfayez/svelte-native/routes" || moduleName === "./routes" && context.originModulePath === entryFile) return { type: "sourceFile", filePath: routesTable };
      if (moduleName === "@alfayez/svelte-native/classes-table") return { type: "sourceFile", filePath: classesTable };
      const stub = stubFor(moduleName, context.originModulePath);
      if (stub !== null) return { type: "sourceFile", filePath: stub };
      const remote = remoteResolution(moduleName, context.originModulePath);
      if (remote !== void 0) return { type: "sourceFile", filePath: remote };
      if (moduleName.startsWith("$env/") && moduleName.includes("private") || moduleName === "$app/server" || moduleName === "$app/env/private") {
        throw new Error(`Server-only import in native bundle: ${moduleName}`);
      }
      const kit = kitResolution(moduleName, context.originModulePath);
      if (kit !== void 0) return { type: "sourceFile", filePath: kit };
      if (moduleName === "svelte/reactivity/window") return { type: "sourceFile", filePath: sourceFile("reactivity-window.ts") };
      if (moduleName === "svelte" || moduleName.startsWith("svelte/")) {
        const nativeContext = { ...context, originModulePath: (0, import_node_path9.resolve)(nativeSvelte, "native-entry.js"), unstable_conditionNames: ["browser", "require"] };
        return context.resolveRequest(nativeContext, moduleName, platform);
      }
      if (moduleName === "react-native" && LITE_ORIGINS.test(context.originModulePath)) {
        return { type: "sourceFile", filePath: sourceFile("fabric/react-native-lite.ts") };
      }
      if (moduleName === "esm-env") {
        return { type: "sourceFile", filePath: sourceFile("environment.ts") };
      }
      const result = resolveRequest ? resolveRequest(context, moduleName, platform) : context.resolveRequest(context, moduleName, platform);
      if (result.type === "sourceFile") {
        const stubbedFile = stubForFile(result.filePath);
        if (stubbedFile !== null) return { type: "sourceFile", filePath: stubbedFile };
        const stub2 = Object.entries(RENDERER_STUBS).find(([suffix]) => result.filePath.endsWith(suffix));
        if (stub2) return { type: "sourceFile", filePath: sourceFile(stub2[1]) };
        if (INITIALIZE_CORE.test(result.filePath)) return { type: "sourceFile", filePath: sourceFile("init.ts") };
      }
      if (result.type === "sourceFile" && (/\.server\.[cm]?[jt]s$/.test(result.filePath) || result.filePath.includes("/src/lib/server/"))) {
        throw new Error(`Server-only file in native bundle: ${result.filePath}`);
      }
      return result;
    }
  };
  const serializer = config.serializer;
  const runBeforeMain = serializer.getModulesRunBeforeMainModule;
  serializer.getModulesRunBeforeMainModule = (entryFile2) => {
    const modules = runBeforeMain(entryFile2);
    return modules.filter((module2) => !/react-native[\\/]Libraries[\\/]Core[\\/]InitializeCore(\.js)?$/.test(module2));
  };
  resetForLibrary ??= libraryChanged(config.projectRoot);
  if (resetForLibrary && !config.resetCache) console.log("svelte-native: the installed library changed since Metro last ran here; starting Metro with empty caches");
  const configured = { ...config, resetCache: config.resetCache || resetForLibrary, cacheVersion: `${config.cacheVersion ?? ""}+svelte-native-2${stubbed.length + files.size + directories.size > 0 ? `+stubs-${variant}` : ""}`, resolver, serializer, transformer: { ...config.transformer, babelTransformerPath: require4.resolve("@alfayez/svelte-native/transformer") } };
  return configured;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  INITIALIZE_CORE,
  LITE_ORIGINS,
  RENDERER_STUBS,
  closeWatchers,
  isInPackage,
  libraryChanged,
  stubCoreSource,
  stubSource,
  withSvelteNative
});
