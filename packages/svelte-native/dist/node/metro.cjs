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
  closeRouteWatchers: () => closeRouteWatchers,
  isInPackage: () => isInPackage,
  stubCoreSource: () => stubCoreSource,
  stubSource: () => stubSource,
  withSvelteNative: () => withSvelteNative
});
module.exports = __toCommonJS(metro_exports);
var import_node_fs4 = require("node:fs");
var import_node_module4 = require("node:module");
var import_node_path7 = require("node:path");

// src/build.ts
var import_node_fs2 = require("node:fs");
var import_node_module = require("node:module");
var import_node_path3 = require("node:path");

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
      const relative3 = source.directory.slice(tabs.directory.length);
      let groups = 0;
      while (groups < relative3.length && isGroup(relative3[groups])) groups++;
      if (groups === relative3.length) {
        const isPage = pages.get(source.key) === source;
        if (isPage || navigators.has(source.key)) throw new Error(`${source.path}: a ${isPage ? "page" : "navigator layout"} directly under a tabs layout has no pane to show in; move it into a pane directory`);
        continue;
      }
      const key = relative3[groups];
      const directory = tabs.directory.concat(relative3.slice(0, groups + 1));
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
var require2 = (0, import_node_module.createRequire)(__importMetaUrl);
var posix = (path) => path.split(import_node_path3.sep).join("/");
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
    for (const item of (0, import_node_fs2.readdirSync)(directory, { withFileTypes: true })) {
      const path = (0, import_node_path3.resolve)(directory, item.name);
      if (item.isDirectory()) {
        if (lab || item.name !== LAB_DIRECTORY) walk(path);
      } else paths.push(posix((0, import_node_path3.relative)(routesRoot, path)));
    }
  }
  walk(routesRoot);
  const { parse: parse2 } = require2("svelte/compiler");
  const files = [];
  const labDirectories = [];
  for (const path of paths.sort((a, b) => a.localeCompare(b))) {
    const name = path.slice(path.lastIndexOf("/") + 1);
    if (name !== "+mobile.svelte" && name !== "+layout.mobile.svelte") continue;
    const ast = parse2((0, import_node_fs2.readFileSync)((0, import_node_path3.resolve)(routesRoot, path), "utf8"), { modern: true, filename: path });
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
  const code = (file) => `require(${json(posix((0, import_node_path3.relative)(output, (0, import_node_path3.resolve)(routesRoot, file))))}).default`;
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
import type { StackNode } from '@rasheed/svelte-native/router';

export const variant = ${json(variant)};
export const lab = ${lab};
export const tree: StackNode = ${nodeOf(tree, "").trimStart()};
`;
}
function syncRoutes(root, options = {}) {
  const variant = options.variant ?? variantName();
  const lab = options.lab ?? labIncludedFor(variant);
  const routesRoot = (0, import_node_path3.resolve)(root, "src/routes");
  const output = (0, import_node_path3.resolve)(root, ".svelte-native");
  (0, import_node_fs2.mkdirSync)(output, { recursive: true });
  const manifest = treeModule(buildTree(routeFilesSync(routesRoot, { lab })), routesRoot, output, variant, lab);
  const customRoot = process.env.SVELTE_NATIVE_ROOT;
  const prelude = "import '@rasheed/svelte-native/init';\nimport '@rasheed/svelte-native/polyfills';\nimport { createFabricApp, remountSurfaces } from '@rasheed/svelte-native/fabric';\n";
  const hot = "declare const module: { hot?: { accept(callback?: () => void): void } };\nif (__DEV__) module.hot?.accept(() => remountSurfaces());\n";
  const entry = customRoot ? `${prelude}import App from ${JSON.stringify(posix((0, import_node_path3.relative)(output, (0, import_node_path3.resolve)(root, customRoot))))};
createFabricApp(App, {});
${hot}` : `${prelude}import App from '../src/routes/+layout.mobile.svelte';
import { tree } from './routes';
createFabricApp(App, { tree });
${hot}`;
  const files = [[routesTableFile(variant), manifest]];
  if (options.entry !== "keep" || customRoot !== void 0 || !(0, import_node_fs2.existsSync)((0, import_node_path3.resolve)(output, "entry.ts"))) files.push(["entry.ts", entry]);
  for (const [file, content] of files) {
    const destination = (0, import_node_path3.resolve)(output, file);
    let current = "";
    try {
      current = (0, import_node_fs2.readFileSync)(destination, "utf8");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    if (current !== content) (0, import_node_fs2.writeFileSync)(destination, content);
  }
  (0, import_node_fs2.rmSync)((0, import_node_path3.resolve)(output, "routes.ts"), { force: true });
}
function unrefTimer(timer) {
  timer.unref?.();
}
function watchRoutes(root, options = {}, debounceMs = 50) {
  let timer;
  const watcher = (0, import_node_fs2.watch)((0, import_node_path3.resolve)(root, "src/routes"), { recursive: true }, () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      try {
        syncRoutes(root, options);
      } catch (error) {
        console.error(error);
      }
    }, debounceMs);
    unrefTimer(timer);
  });
  watcher.unref();
  return { close() {
    clearTimeout(timer);
    watcher.close();
  } };
}

// src/remote/transform.ts
var import_node_path5 = require("node:path");
var import_parser = require("@babel/parser");

// src/remote/kit.ts
var import_node_module2 = require("node:module");
var import_node_path4 = require("node:path");
var require3 = (0, import_node_module2.createRequire)(__importMetaUrl);
var kitRootCache;
function findKitRoot() {
  if (kitRootCache === void 0) {
    try {
      kitRootCache = (0, import_node_path4.dirname)(require3.resolve("@sveltejs/kit/package.json"));
    } catch {
      kitRootCache = null;
    }
  }
  return kitRootCache;
}
function kitMissingMessage(what) {
  return `${what} needs \`@sveltejs/kit\`, which is not installed (an optional peer dependency of @rasheed/svelte-native: only remote functions and the web target use it). Install the version the package was written against: \`pnpm add @sveltejs/kit@3.0.0-next.27\`, and copy its patch (README, "Apply the patches").`;
}
function kitRoot(what = "The remote function runtime (`@rasheed/svelte-native/remote`)") {
  const found = findKitRoot();
  if (found === null) throw new Error(kitMissingMessage(what));
  return found;
}

// src/remote/transform.ts
var posix2 = (path) => path.replaceAll("\\", "/");
var shim = (name) => (0, import_node_path5.join)(sourceDirectory, "remote/shims", name);
function remoteResolution(specifier, origin) {
  if (specifier.startsWith("@sveltejs/kit/src/")) return (0, import_node_path5.join)(kitRoot(), specifier.slice("@sveltejs/kit/".length));
  if (specifier === "@sveltejs/kit/internal") return (0, import_node_path5.join)(kitRoot(), "src/exports/internal/index.js");
  const kit = findKitRoot();
  if (kit === null) return void 0;
  const inside = posix2(origin).startsWith(`${posix2(kit)}/`);
  if (!inside) return void 0;
  switch (specifier) {
    case "#internal":
      return (0, import_node_path5.join)(kit, "src/exports/internal/client.js");
    case "#app/internal/transport":
      return (0, import_node_path5.join)(kit, "src/runtime/app/internal/transport.js");
    case "#app/paths":
      return shim("paths.ts");
    case "#app/state/client":
      return shim("state.ts");
    case "$app/env":
      return shim("env.ts");
  }
  if (specifier.startsWith(".") && (0, import_node_path5.resolve)((0, import_node_path5.dirname)(origin), specifier) === (0, import_node_path5.join)(kit, "src/runtime/client/client.js")) return shim("client.ts");
  return void 0;
}

// src/svelte-build.ts
var import_node_fs3 = require("node:fs");
var import_node_module3 = require("node:module");
var import_node_path6 = require("node:path");
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
    manifestPath = from ?? (0, import_node_module3.createRequire)(__importMetaUrl).resolve("svelte/package.json");
  } catch {
    return { ok: false, version: null, directory: null, reason: "missing" };
  }
  const directory = (0, import_node_path6.dirname)(manifestPath);
  const manifest = JSON.parse((0, import_node_fs3.readFileSync)(manifestPath, "utf8"));
  const version = manifest.version ?? null;
  const exported = manifest.exports !== void 0 && "./renderer" in manifest.exports;
  if (!exported || !(0, import_node_fs3.existsSync)((0, import_node_path6.join)(directory, "src/renderer/index.js"))) return { ok: false, version, directory, reason: "stock-release" };
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
var require4 = (0, import_node_module4.createRequire)(__importMetaUrl);
var nativeSvelte = (0, import_node_path7.dirname)(require4.resolve("svelte/package.json"));
var LITE_ORIGINS = /[\\/]node_modules[\\/](?:\.pnpm[\\/][^\\/]+[\\/]node_modules[\\/])?(?:hermes-intl|expo|expo-modules-core|expo-file-system|react-native-reanimated|react-native-worklets|react-native-is-edge-to-edge|expo-secure-store|expo-image-picker|expo-localization|expo-crypto|expo-constants|expo-font|expo-asset|expo-splash-screen|expo-status-bar|expo-system-ui|expo-keep-awake|expo-application|react-native-svg)[\\/]/;
var INITIALIZE_CORE = /react-native[\\/]Libraries[\\/]Core[\\/]InitializeCore\.js$/;
var RENDERER_STUBS = {
  "react-native/Libraries/ReactNative/RendererProxy.js": "./fabric/renderer-stub.ts",
  "react-native/Libraries/Renderer/shims/ReactFabric.js": "./fabric/react-fabric-stub.ts",
  "react-native/Libraries/Renderer/shims/createReactNativeComponentClass.js": "./fabric/component-class-stub.ts"
};
var routeWatchers = /* @__PURE__ */ new Set();
function closeRouteWatchers() {
  for (const watcher of routeWatchers) watcher.close();
  routeWatchers.clear();
}
var stubCoreSource = `// Generated by @rasheed/svelte-native/metro: what stands in for a package this app does not link.
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
  return `// Generated by @rasheed/svelte-native/metro: ${name} is not linked in this app.
module.exports = require("./_core.js")(${JSON.stringify(name)}, ${JSON.stringify(variant)});
`;
}
var isInPackage = (moduleName, name) => moduleName === name || moduleName.startsWith(`${name}/`);
function withSvelteNative(config, options = {}) {
  assertCustomRenderer("withSvelteNative (@rasheed/svelte-native/metro)");
  Object.assign(process.env, runesEnvironment(options.runes));
  const resolveRequest = config.resolver.resolveRequest;
  const stubbed = options.stubbedPackages ?? [];
  const variant = options.variant ?? variantName();
  const stubDirectory = (0, import_node_path7.join)(config.projectRoot, ".svelte-native", "stubs", variant.replace(/[^A-Za-z0-9_-]/g, "_"));
  const write = (file, content) => {
    let current;
    try {
      current = (0, import_node_fs4.readFileSync)(file, "utf8");
    } catch {
      current = void 0;
    }
    if (current !== content) (0, import_node_fs4.writeFileSync)(file, content);
  };
  const stubs = /* @__PURE__ */ new Map();
  if (stubbed.length > 0) {
    (0, import_node_fs4.mkdirSync)(stubDirectory, { recursive: true });
    write((0, import_node_path7.join)(stubDirectory, "_core.js"), stubCoreSource);
  }
  for (const name of stubbed) {
    const file = (0, import_node_path7.join)(stubDirectory, `${name.replace(/[^A-Za-z0-9_.-]/g, "_")}.js`);
    (0, import_node_fs4.mkdirSync)(stubDirectory, { recursive: true });
    write(file, stubSource(name, variant));
    stubs.set(name, file);
  }
  const withoutExtension = (path) => path.replace(/\.[cm]?[jt]sx?$/, "");
  const nameOf = (path) => withoutExtension(path).slice(config.projectRoot.length + 1);
  const writeStub = (name) => {
    const file = (0, import_node_path7.join)(stubDirectory, `${name.replace(/[^A-Za-z0-9_.-]/g, "_")}.js`);
    (0, import_node_fs4.mkdirSync)(stubDirectory, { recursive: true });
    write((0, import_node_path7.join)(stubDirectory, "_core.js"), stubCoreSource);
    write(file, stubSource(name, variant));
    return file;
  };
  const files = /* @__PURE__ */ new Map();
  for (const path of options.stubbedFiles ?? []) files.set(withoutExtension(path), writeStub(nameOf(path)));
  const directories = /* @__PURE__ */ new Map();
  for (const path of options.stubbedDirectories ?? []) {
    const directory = path.replace(/[\\/]+$/, "");
    directories.set(directory + import_node_path7.sep, writeStub(`${nameOf(directory)}/`));
  }
  const lab = labIncludedFor(variant);
  const entryFile = (0, import_node_path7.join)(config.projectRoot, ".svelte-native", "entry.ts");
  const routesTable = (0, import_node_path7.join)(config.projectRoot, ".svelte-native", routesTableFile(variant));
  if (options.syncRoutes ?? (0, import_node_fs4.existsSync)((0, import_node_path7.join)(config.projectRoot, "src/routes"))) {
    const syncing = { variant, lab, entry: "keep" };
    syncRoutes(config.projectRoot, syncing);
    if (process.env.NODE_ENV === "development") routeWatchers.add(watchRoutes(config.projectRoot, syncing));
  }
  const stubFor = (moduleName, origin) => {
    const name = stubbed.find((candidate) => isInPackage(moduleName, candidate));
    if (name !== void 0) return stubs.get(name) ?? null;
    if (files.size > 0 && (moduleName.startsWith("./") || moduleName.startsWith("../"))) return files.get(withoutExtension((0, import_node_path7.resolve)((0, import_node_path7.dirname)(origin), moduleName))) ?? null;
    return null;
  };
  const stubForFile = (filePath) => {
    if (files.size > 0) {
      const own = files.get(withoutExtension(filePath));
      if (own !== void 0) return own;
    }
    if (directories.size === 0) return null;
    for (const [directory, stub] of directories) if (filePath.startsWith(directory)) return stub;
    return null;
  };
  const resolver = {
    ...config.resolver,
    sourceExts: [.../* @__PURE__ */ new Set([...config.resolver.sourceExts, "svelte"])],
    resolveRequest: (context, moduleName, platform) => {
      if (moduleName === "@rasheed/svelte-native/routes" || moduleName === "./routes" && context.originModulePath === entryFile) return { type: "sourceFile", filePath: routesTable };
      const stub = stubFor(moduleName, context.originModulePath);
      if (stub !== null) return { type: "sourceFile", filePath: stub };
      const remote = remoteResolution(moduleName, context.originModulePath);
      if (remote !== void 0) return { type: "sourceFile", filePath: remote };
      if (moduleName.startsWith("$env/") && moduleName.includes("private") || moduleName === "$app/server") {
        throw new Error(`Server-only import in native bundle: ${moduleName}`);
      }
      if (moduleName === "svelte" || moduleName.startsWith("svelte/")) {
        const nativeContext = { ...context, originModulePath: (0, import_node_path7.resolve)(nativeSvelte, "native-entry.js"), unstable_conditionNames: ["browser", "require"] };
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
  return { ...config, cacheVersion: `${config.cacheVersion ?? ""}+svelte-native-2${stubbed.length + files.size + directories.size > 0 ? `+stubs-${variant}` : ""}`, resolver, serializer, transformer: { ...config.transformer, babelTransformerPath: require4.resolve("@rasheed/svelte-native/transformer") } };
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  INITIALIZE_CORE,
  LITE_ORIGINS,
  RENDERER_STUBS,
  closeRouteWatchers,
  isInPackage,
  stubCoreSource,
  stubSource,
  withSvelteNative
});
