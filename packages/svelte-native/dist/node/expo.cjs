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

// src/expo.ts
var expo_exports = {};
__export(expo_exports, {
  androidFeatureFlagsFor: () => androidFeatureFlagsFor,
  applyAppDelegate: () => applyAppDelegate,
  applyFeatureFlags: () => applyFeatureFlags,
  applyHeadlessApplication: () => applyHeadlessApplication,
  applyHeadlessSettings: () => applyHeadlessSettings,
  applyMainActivity: () => applyMainActivity,
  applyPodfileAutolinkingExclude: () => applyPodfileAutolinkingExclude,
  baselineProfile: () => baselineProfile,
  default: () => expo_default,
  defaultAndroidFeatureFlags: () => defaultAndroidFeatureFlags,
  headlessDroppedTurboModules: () => headlessDroppedTurboModules,
  headlessExcludedPackages: () => headlessExcludedPackages,
  headlessPackageSource: () => headlessPackageSource,
  leaveOutOfAutoPlugins: () => leaveOutOfAutoPlugins,
  onDemandPackageSource: () => onDemandPackageSource
});
module.exports = __toCommonJS(expo_exports);
var import_promises2 = require("node:fs/promises");
var import_node_path5 = require("node:path");
var import_config_plugins3 = require("expo/config-plugins");

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

// src/compile-options.ts
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
  const { parse } = require2("svelte/compiler");
  const files = [];
  const labDirectories = [];
  for (const path of paths.sort((a, b) => a.localeCompare(b))) {
    const name = path.slice(path.lastIndexOf("/") + 1);
    if (name !== "+mobile.svelte" && name !== "+layout.mobile.svelte") continue;
    const ast = parse((0, import_node_fs2.readFileSync)((0, import_node_path3.resolve)(routesRoot, path), "utf8"), { modern: true, filename: path });
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
import type { StackNode } from '@alfayez/svelte-native/router';

export const variant = ${json(variant)};
export const lab = ${lab};
export const tree: StackNode = ${nodeOf(tree, "").trimStart()};
`;
}
var FORMER_NAME = "@example/svelte-native";
function staleEntry(source) {
  if (!/^import ['"]\.\/hooks['"];$/m.test(source)) return true;
  const manifest = JSON.parse((0, import_node_fs2.readFileSync)((0, import_node_path3.resolve)(packageRoot, "package.json"), "utf8"));
  const literal = (text) => text.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
  const patterns = Object.keys(manifest.exports);
  const exported = (key) => patterns.some((pattern) => pattern.includes("*") ? new RegExp(`^${pattern.split("*").map(literal).join(".*")}$`).test(key) : pattern === key);
  for (const [, , name, subpath] of source.matchAll(new RegExp(`(['"])(${literal(manifest.name)}|${literal(FORMER_NAME)})((?:/[^'"]*)?)\\1`, "g"))) {
    if (name === FORMER_NAME || !exported(subpath ? `.${subpath}` : ".")) return true;
  }
  return false;
}
function hooksFile(root) {
  for (const extension of [".ts", ".js"]) {
    const path = (0, import_node_path3.resolve)(root, `src/hooks.mobile${extension}`);
    if ((0, import_node_fs2.existsSync)(path)) return path;
  }
  return void 0;
}
function hooksModule(root) {
  const file = hooksFile(root);
  if (file === void 0) return "// Generated by svelte-native sync: the app has no src/hooks.mobile.ts.\nimport { registerHooks } from '@alfayez/svelte-native/app';\n\nregisterHooks({});\n";
  const specifier = posix((0, import_node_path3.relative)((0, import_node_path3.resolve)(root, ".svelte-native"), file)).replace(/\.[jt]s$/, "");
  return `// Generated by svelte-native sync: the app's hooks (${posix((0, import_node_path3.relative)(root, file))}), registered before its layout and routes load.
import { registerHooks } from '@alfayez/svelte-native/app';
import * as hooks from ${JSON.stringify(specifier)};

registerHooks(hooks);
`;
}
function writeGenerated(output, file, content) {
  const destination = (0, import_node_path3.resolve)(output, file);
  let current = "";
  try {
    current = (0, import_node_fs2.readFileSync)(destination, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (current !== content) (0, import_node_fs2.writeFileSync)(destination, content);
}
function syncRoutes(root, options = {}) {
  const variant = options.variant ?? variantName();
  const lab = options.lab ?? labIncludedFor(variant);
  const routesRoot = (0, import_node_path3.resolve)(root, "src/routes");
  const output = (0, import_node_path3.resolve)(root, ".svelte-native");
  (0, import_node_fs2.mkdirSync)(output, { recursive: true });
  const manifest = treeModule(buildTree(routeFilesSync(routesRoot, { lab })), routesRoot, output, variant, lab);
  const customRoot = process.env.SVELTE_NATIVE_ROOT;
  const prelude = "import { createFabricApp, remountSurfaces } from '@alfayez/svelte-native/app';\nimport './hooks';\n";
  const hot = "declare const module: { hot?: { accept(callback?: () => void): void } };\nif (__DEV__) module.hot?.accept(() => remountSurfaces());\n";
  const entry = customRoot ? `${prelude}import App from ${JSON.stringify(posix((0, import_node_path3.relative)(output, (0, import_node_path3.resolve)(root, customRoot))))};
createFabricApp(App, {});
${hot}` : `${prelude}import App from '../src/routes/+layout.mobile.svelte';
import { tree } from './routes';
createFabricApp(App, { tree });
${hot}`;
  const files = [[routesTableFile(variant), manifest], ["hooks.ts", hooksModule(root)]];
  const entryPath = (0, import_node_path3.resolve)(output, "entry.ts");
  if (options.entry !== "keep" || customRoot !== void 0 || !(0, import_node_fs2.existsSync)(entryPath) || staleEntry((0, import_node_fs2.readFileSync)(entryPath, "utf8"))) files.push(["entry.ts", entry]);
  for (const [file, content] of files) writeGenerated(output, file, content);
  (0, import_node_fs2.rmSync)((0, import_node_path3.resolve)(output, "routes.ts"), { force: true });
}
async function syncNative(root, options = {}) {
  syncRoutes(root, options);
}

// src/capabilities.ts
var import_node_fs3 = require("node:fs");
var import_promises = require("node:fs/promises");
var import_node_module2 = require("node:module");
var import_node_path4 = require("node:path");
var import_config_plugins = require("expo/config-plugins.js");
var CapabilityConfigError = class extends Error {
  name = "CapabilityConfigError";
};
function locationPluginProps(location) {
  const { whenInUse, background, motion } = typeof location === "string" ? { whenInUse: location, background: void 0, motion: void 0 } : location;
  if (typeof whenInUse !== "string" || whenInUse.trim() === "")
    throw new CapabilityConfigError('capabilities.location needs the reason the app uses the location, as the user will read it: `capabilities: { location: "Shows the stores near you." }`');
  for (const [key, text] of [["background", background], ["motion", motion]])
    if (text !== void 0 && (typeof text !== "string" || text.trim() === ""))
      throw new CapabilityConfigError(`capabilities.location.${key} needs the reason, as the user will read it`);
  return {
    locationWhenInUsePermission: whenInUse,
    locationAlwaysAndWhenInUsePermission: background ?? false,
    locationAlwaysPermission: background ?? false,
    isIosBackgroundLocationEnabled: background !== void 0,
    isAndroidBackgroundLocationEnabled: background !== void 0,
    ...motion === void 0 ? {} : { motionUsagePermission: motion }
  };
}
function linkedDependencies(projectRoot) {
  let manifest = {};
  try {
    manifest = JSON.parse((0, import_node_fs3.readFileSync)((0, import_node_path4.join)(projectRoot, "package.json"), "utf8"));
  } catch {
  }
  const autolinking = manifest.expo?.autolinking;
  const excluded = /* @__PURE__ */ new Set([...autolinking?.exclude ?? [], ...autolinking?.android?.exclude ?? [], ...autolinking?.ios?.exclude ?? []]);
  const linked = new Set([...Object.keys(manifest.dependencies ?? {}), ...Object.keys(manifest.devDependencies ?? {})].filter((name) => !excluded.has(name)));
  return { linked, excluded };
}
function listsPlugin(config, name) {
  return (config.plugins ?? []).some((entry) => (Array.isArray(entry) ? entry[0] : entry) === name);
}
function withCapabilities(config, capabilities, options = {}) {
  const projectRoot = options.projectRoot ?? config._internal?.projectRoot ?? process.cwd();
  const load = options.load ?? ((request) => (0, import_node_module2.createRequire)((0, import_node_path4.join)(projectRoot, "package.json"))(request));
  const dependencies = linkedDependencies(projectRoot);
  const excluded = /* @__PURE__ */ new Set([...options.excluded ?? [], ...dependencies.excluded]);
  const linked = new Set([...dependencies.linked].filter((name) => !excluded.has(name)));
  const context = { projectRoot, load, linked, excluded };
  return withPush(withLocation(config, capabilities?.location, context), capabilities?.push, context);
}
function withLocation(config, location, context) {
  const on = location !== void 0 && location !== null && location !== false;
  const excluded = context.excluded.has("expo-location");
  const installed = context.linked.has("expo-location");
  if (listsPlugin(config, "expo-location")) {
    if (on)
      throw new CapabilityConfigError("The app config sets capabilities.location and also lists expo-location's own plugin: keep one. capabilities.location gives expo-location its texts; its own plugin entry takes all of its options.");
    return config;
  }
  if (!on) {
    if (installed)
      throw new CapabilityConfigError(
        'expo-location is installed, but the location capability is off. Say why the app uses the location (the text iOS shows when it asks) in the @alfayez/svelte-native plugin: `plugins: [["@alfayez/svelte-native", { capabilities: { location: "Shows the stores near you." } }]]`, or uninstall expo-location.'
      );
    return config;
  }
  if (excluded)
    throw new CapabilityConfigError("capabilities.location is on, but expo-location is left out of autolinking (`autolinkingExclude`, or `expo.autolinking.exclude` in package.json): take it out of that list, or turn the capability off.");
  const props = locationPluginProps(location);
  try {
    context.load("expo-location/package.json");
  } catch {
    throw new CapabilityConfigError("capabilities.location needs expo-location, which is not installed: `npx expo install expo-location`, then prebuild again.");
  }
  let plugin;
  try {
    plugin = context.load("expo-location/app.plugin.js");
  } catch (error) {
    throw new CapabilityConfigError(`expo-location's config plugin (expo-location/app.plugin.js) failed to load: ${error instanceof Error ? error.message : String(error)}`);
  }
  const apply = plugin.default ?? plugin;
  if (typeof apply !== "function") throw new CapabilityConfigError("expo-location's config plugin (expo-location/app.plugin.js) is not a function: is the installed expo-location the one this Expo SDK uses?");
  return apply(config, props);
}
var pushPackage = "@alfayez/svelte-native-push";
var otherPushLibraries = ["expo-notifications", "@react-native-firebase/messaging"];
var defaultPushChannel = { id: "default", name: "Notifications" };
var pushMetaData = {
  icon: "com.google.firebase.messaging.default_notification_icon",
  color: "com.google.firebase.messaging.default_notification_color",
  firebaseChannel: "com.google.firebase.messaging.default_notification_channel_id",
  channelId: "expo.modules.sveltepush.channel_id",
  channelName: "expo.modules.sveltepush.channel_name",
  channelDescription: "expo.modules.sveltepush.channel_description"
};
var pushResources = { icon: "svelte_push_icon", color: "svelte_push_color" };
var pemKey = /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/;
var serviceAccountJson = /"type"\s*:\s*"service_account"|"private_key"\s*:/;
var privateKeyName = /^private[_-]?key$/i;
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
var secretError = ({ where, what }) => new CapabilityConfigError(
  `${where} is ${what}: a key that can send to every user must never be in the app or its build. Keep it in the server's environment (the FCM service account, the APNs .p8 with its key id and team id) and give the app identifiers only.`
);
var unreadable = (error) => error.code === "ENOENT" ? "does not exist" : `cannot be read: ${error instanceof Error ? error.message : String(error)}`;
function section(value, where, example) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new CapabilityConfigError(`${where} takes an object: ${example}`);
  return value;
}
function optionalText(value, where) {
  if (value === void 0) return void 0;
  if (typeof value !== "string" || value.trim() === "") throw new CapabilityConfigError(`${where} must be a text that is not empty.`);
  return value;
}
function googleServicesPackages(parsed) {
  const clients = parsed?.client;
  if (!Array.isArray(clients)) return [];
  return clients.flatMap((client) => {
    const name = client?.client_info?.android_client_info?.package_name;
    return typeof name === "string" ? [name] : [];
  });
}
function checkGoogleServicesFile(file, appPackage, projectRoot) {
  const name = `capabilities.push.android.googleServicesFile ("${file}")`;
  const path = (0, import_node_path4.resolve)(projectRoot, file);
  let text;
  try {
    text = (0, import_node_fs3.readFileSync)(path, "utf8");
  } catch (error) {
    throw new CapabilityConfigError(`${name} ${unreadable(error)} (looked for ${path}): download google-services.json from the Firebase console (Project settings, your Android app) and save it there, or point googleServicesFile at it.`);
  }
  const secret = findPushSecret(text, `the file of ${name}`);
  if (secret) throw secretError(secret);
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new CapabilityConfigError(`${name} is not JSON (${error instanceof Error ? error.message : String(error)}): download google-services.json from the Firebase console again.`);
  }
  const packages = googleServicesPackages(parsed);
  if (!packages.includes(appPackage))
    throw new CapabilityConfigError(
      `${name} has no client for the app's package "${appPackage}" (${packages.length === 0 ? "it has no Android client" : `it has ${packages.map((item) => `"${item}"`).join(", ")}`}): add an Android app with that package to the Firebase project and download google-services.json again, or fix android.package.`
    );
}
function checkIcon(icon, projectRoot) {
  const name = `capabilities.push.android.icon ("${icon}")`;
  if (!/\.png$/i.test(icon)) throw new CapabilityConfigError(`${name} must be a PNG file: the notification's small icon, white on a transparent background.`);
  const path = (0, import_node_path4.resolve)(projectRoot, icon);
  let isFile;
  try {
    isFile = (0, import_node_fs3.statSync)(path).isFile();
  } catch (error) {
    throw new CapabilityConfigError(`${name} ${unreadable(error)} (looked for ${path}): point it at the PNG of the notification's small icon.`);
  }
  if (!isFile) throw new CapabilityConfigError(`${name} is not a file (${path}): point it at the PNG of the notification's small icon.`);
}
function pushIosSettings(value) {
  const ios = section(value, "capabilities.push.ios", '`ios: { mode: "production" }`');
  if (ios.mode !== "development" && ios.mode !== "production")
    throw new CapabilityConfigError(
      'capabilities.push.ios.mode must be "development" or "production": it is the aps-environment entitlement, "development" for a build signed for development and "production" for TestFlight and the App Store.'
    );
  return { mode: ios.mode };
}
function pushAndroidSettings(value, appPackage, projectRoot) {
  const android = section(value, "capabilities.push.android", '`android: { googleServicesFile: "./google-services.json" }`');
  const file = android.googleServicesFile;
  if (typeof file !== "string" || file.trim() === "")
    throw new CapabilityConfigError(
      'capabilities.push.android needs googleServicesFile, the path of the Firebase project\'s google-services.json (Firebase console, Project settings, your Android app): `android: { googleServicesFile: "./google-services.json" }`. Leave `android` out for an app that has no push on Android.'
    );
  if (!appPackage) throw new CapabilityConfigError("capabilities.push.android needs android.package in the Expo config: the Google services file is checked against it, and Firebase delivers to that package.");
  checkGoogleServicesFile(file, appPackage, projectRoot);
  const settings = { googleServicesFile: file, channel: { ...defaultPushChannel } };
  const icon = optionalText(android.icon, "capabilities.push.android.icon");
  if (icon !== void 0) {
    checkIcon(icon, projectRoot);
    settings.icon = icon;
  }
  const color = optionalText(android.color, "capabilities.push.android.color");
  if (color !== void 0) {
    if (!/^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(color))
      throw new CapabilityConfigError(`capabilities.push.android.color ("${color}") must be a hex color such as "#0a7f5a": the notification's accent color.`);
    settings.color = color;
  }
  if (android.channel !== void 0) {
    const channel = section(android.channel, "capabilities.push.android.channel", '`channel: { name: "Updates" }`');
    if (typeof channel.name !== "string" || channel.name.trim() === "")
      throw new CapabilityConfigError('capabilities.push.android.channel needs a name, as the user will read it in the app\'s notification settings: `channel: { name: "Updates" }`.');
    const description = optionalText(channel.description, "capabilities.push.android.channel.description");
    settings.channel = {
      id: optionalText(channel.id, "capabilities.push.android.channel.id") ?? defaultPushChannel.id,
      name: channel.name,
      ...description === void 0 ? {} : { description }
    };
  }
  return settings;
}
function pushSettings(push, appPackage, projectRoot) {
  const platforms = section(push, "capabilities.push", '`push: { android: { googleServicesFile: "./google-services.json" }, ios: { mode: "production" } }`, or `push: false`');
  if (platforms.android === void 0 && platforms.ios === void 0)
    throw new CapabilityConfigError(
      "capabilities.push names no platform: give `android` (its google-services.json), `ios` (its aps-environment mode) or both, or turn the capability off with `push: false` and uninstall @alfayez/svelte-native-push."
    );
  const settings = {};
  if (platforms.android !== void 0) settings.android = pushAndroidSettings(platforms.android, appPackage, projectRoot);
  if (platforms.ios !== void 0) settings.ios = pushIosSettings(platforms.ios);
  return settings;
}
var holdBegin = "    // Svelte native: push, the first screen of a launch in the background (generated, do not edit)";
var holdOpen = "      surface: { [self] in";
var holdClose = "      })";
var holdEnd = "    // Svelte native: end of the first screen of a launch in the background";
var holdImport = "internal import SveltePush // Svelte native: push, the first screen of a launch in the background (generated, do not edit)";
var escapeText = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
var holdHead = new RegExp(`\\n${escapeText(holdBegin)}\\n[\\s\\S]*?${escapeText(holdOpen)}(?=\\n)`);
var holdTail = new RegExp(`\\n${escapeText(holdClose)}\\n${escapeText(holdEnd)}(?=\\n)`);
var holdImportLine = new RegExp(`^${escapeText(holdImport)}\\n`, "m");
function applyPushAppDelegate(contents) {
  const stripped = contents.replace(holdHead, "").replace(holdTail, "").replace(holdImportLine, "");
  const imports = [...stripped.matchAll(/^(?:(?:internal|public|package|private|fileprivate) |@_exported |@preconcurrency )*import [\w.]+[ \t]*$/gm)];
  const lastImport = imports.at(-1);
  const call = /^[ \t]*factory\.startReactNative\([^)]*\)[ \t]*$/m.exec(stripped);
  const launching = /_ application: UIApplication,\s*didFinishLaunchingWithOptions launchOptions: \[UIApplication\.LaunchOptionsKey: Any\]\?/.test(stripped);
  if (!lastImport || !call || !launching || !/withModuleName: "[^"]+",\s*in: window,\s*launchOptions: launchOptions\)/.test(call[0])) {
    throw new Error(
      "Svelte native could not find the imports and `factory.startReactNative(withModuleName: …, in: window, launchOptions: launchOptions)` in application(_:didFinishLaunchingWithOptions:) of AppDelegate.swift. Push needs the call to keep a launch in the background (a silent push) from mounting the first screen."
    );
  }
  const head = [
    holdBegin,
    "    SveltePushBackgroundLaunch.start(",
    "      application,",
    "      host: {",
    // `-initializeReactHostWithLaunchOptions:bundleConfiguration:devMenuConfiguration:` reaches Swift as `initializeReactHost(launchOptions:…)`
    // (the compiler of Xcode 26.5 says so; `withLaunchOptions:` does not compile).
    "        factory.rootViewFactory.initializeReactHost(",
    "          launchOptions: launchOptions,",
    "          bundleConfiguration: factory.bundleConfiguration,",
    "          devMenuConfiguration: factory.devMenuConfiguration ?? RCTDevMenuConfiguration.default())",
    "      },",
    holdOpen,
    ""
  ].join("\n");
  const tail = ["", holdClose, holdEnd].join("\n");
  const callEnd = call.index + call[0].length;
  const importEnd = lastImport.index + lastImport[0].length;
  return `${stripped.slice(0, importEnd)}
${holdImport}${stripped.slice(importEnd, call.index)}${head}${call[0]}${tail}${stripped.slice(callEnd)}`;
}
function withPushIos(config, mode) {
  const existing = config.ios?.entitlements?.["aps-environment"];
  if (existing !== void 0 && existing !== mode)
    throw new CapabilityConfigError(
      `The app config sets ios.entitlements["aps-environment"] ("${String(existing)}") and capabilities.push.ios.mode is "${mode}": keep one. capabilities.push.ios.mode writes the entitlement.`
    );
  const existingModes = config.ios?.infoPlist?.UIBackgroundModes;
  const modes = Array.isArray(existingModes) ? existingModes : [];
  config = {
    ...config,
    ios: {
      ...config.ios,
      entitlements: { ...config.ios?.entitlements, "aps-environment": mode },
      infoPlist: { ...config.ios?.infoPlist, UIBackgroundModes: modes.includes("remote-notification") ? modes : [...modes, "remote-notification"] }
    }
  };
  return (0, import_config_plugins.withAppDelegate)(config, (config2) => {
    if (config2.modResults.language !== "swift") throw new Error("Svelte native requires Expo's Swift AppDelegate");
    config2.modResults.contents = applyPushAppDelegate(config2.modResults.contents);
    return config2;
  });
}
function setMetaData(application, name, attribute, content) {
  const others = (application["meta-data"] ?? []).filter((item) => item.$["android:name"] !== name);
  application["meta-data"] = [...others, { $: { "android:name": name, [`android:${attribute}`]: content } }];
}
function applyPushManifest(application, android) {
  if (android.icon !== void 0) setMetaData(application, pushMetaData.icon, "resource", `@drawable/${pushResources.icon}`);
  if (android.color !== void 0) setMetaData(application, pushMetaData.color, "resource", `@color/${pushResources.color}`);
  setMetaData(application, pushMetaData.firebaseChannel, "value", android.channel.id);
  setMetaData(application, pushMetaData.channelId, "value", android.channel.id);
  setMetaData(application, pushMetaData.channelName, "value", android.channel.name);
  if (android.channel.description !== void 0) setMetaData(application, pushMetaData.channelDescription, "value", android.channel.description);
}
async function copyPushIcon(source, platformProjectRoot) {
  const directory = (0, import_node_path4.join)(platformProjectRoot, "app/src/main/res/drawable");
  await (0, import_promises.mkdir)(directory, { recursive: true });
  await (0, import_promises.copyFile)(source, (0, import_node_path4.join)(directory, `${pushResources.icon}.png`));
}
function withPushAndroid(config, android, projectRoot) {
  const existing = config.android?.googleServicesFile;
  if (existing !== void 0 && (0, import_node_path4.resolve)(projectRoot, existing) !== (0, import_node_path4.resolve)(projectRoot, android.googleServicesFile))
    throw new CapabilityConfigError(
      `The app config sets android.googleServicesFile ("${existing}") and capabilities.push.android.googleServicesFile is "${android.googleServicesFile}": keep one. capabilities.push.android.googleServicesFile sets android.googleServicesFile.`
    );
  config = { ...config, android: { ...config.android, googleServicesFile: android.googleServicesFile } };
  config = (0, import_config_plugins.withAndroidManifest)(config, (config2) => {
    applyPushManifest(import_config_plugins.AndroidConfig.Manifest.getMainApplicationOrThrow(config2.modResults), android);
    return config2;
  });
  const { color, icon } = android;
  if (color !== void 0)
    config = (0, import_config_plugins.withAndroidColors)(config, (config2) => {
      config2.modResults = import_config_plugins.AndroidConfig.Colors.assignColorValue(config2.modResults, { name: pushResources.color, value: color });
      return config2;
    });
  if (icon !== void 0)
    config = (0, import_config_plugins.withDangerousMod)(config, ["android", async (config2) => {
      await copyPushIcon((0, import_node_path4.resolve)(config2.modRequest.projectRoot, icon), config2.modRequest.platformProjectRoot);
      return config2;
    }]);
  return config;
}
function withPush(config, push, context) {
  const on = push !== void 0 && push !== null && push !== false;
  const installed = context.linked.has(pushPackage);
  if (!on) {
    if (installed)
      throw new CapabilityConfigError(
        `${pushPackage} is installed, but the push capability is off. The package is in the build (Firebase Messaging, the notification permission, the iOS registration), and it cannot work without the app's Firebase file and entitlement: turn push on in the @alfayez/svelte-native plugin, \`plugins: [["@alfayez/svelte-native", { capabilities: { push: { android: { googleServicesFile: "./google-services.json" }, ios: { mode: "production" } } } }]]\`, or uninstall ${pushPackage}.`
      );
    return config;
  }
  const secret = findPushSecret(push, "capabilities.push");
  if (secret) throw secretError(secret);
  if (context.excluded.has(pushPackage))
    throw new CapabilityConfigError(`capabilities.push is on, but ${pushPackage} is left out of autolinking (\`autolinkingExclude\`, or \`expo.autolinking.exclude\` in package.json): take it out of that list, or turn the capability off.`);
  if (!installed)
    throw new CapabilityConfigError(
      `capabilities.push needs ${pushPackage}, which is not installed: add it from the same repository and tag as @alfayez/svelte-native (the same specifier, ending in \`&path:packages/svelte-native-push\`), then prebuild again.`
    );
  const other = otherPushLibraries.find((name) => context.linked.has(name));
  if (other !== void 0)
    throw new CapabilityConfigError(
      `capabilities.push is on, and ${other} is installed: an app has one push library (Android delivers a message to one FirebaseMessagingService, iOS has one notification center delegate). Uninstall ${other}, or turn the push capability off and uninstall ${pushPackage}.`
    );
  const settings = pushSettings(push, config.android?.package, context.projectRoot);
  if (settings.ios) config = withPushIos(config, settings.ios.mode);
  if (settings.android) config = withPushAndroid(config, settings.android, context.projectRoot);
  return config;
}

// src/remote/plugin.ts
var import_config_plugins2 = require("expo/config-plugins.js");

// src/remote/host.ts
var RemoteConfigError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "RemoteConfigError";
  }
};
var EXTRA_KEY = "svelteNative";
var HOW = 'Set `extra.svelteNative.remote.origin` in app.config.ts (the "@alfayez/svelte-native" plugin\'s `remote` option writes it), or call `configureRemote({ origin })` before the first remote function.';
function normalizeOrigin(value) {
  if (typeof value !== "string" || value.trim() === "") throw new RemoteConfigError(`The remote origin must be a URL string such as "https://app.example.com", not ${JSON.stringify(value)}. ${HOW}`);
  let url;
  try {
    url = new URL(value.trim());
  } catch {
    throw new RemoteConfigError(`The remote origin ${JSON.stringify(value)} is not a URL. ${HOW}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new RemoteConfigError(`The remote origin ${JSON.stringify(value)} must use http: or https:.`);
  if (url.username || url.password) throw new RemoteConfigError(`The remote origin ${JSON.stringify(value)} must not carry credentials.`);
  if (url.pathname !== "/" && url.pathname !== "" || url.search || url.hash) throw new RemoteConfigError(`The remote origin ${JSON.stringify(value)} must be an origin without a path, query or fragment: put a path prefix in \`base\` (SvelteKit's \`paths.base\`).`);
  return url.origin;
}
function normalizeBase(value) {
  if (value === void 0 || value === null || value === "") return "";
  if (typeof value !== "string" || !value.startsWith("/") || value.endsWith("/")) throw new RemoteConfigError(`The remote base ${JSON.stringify(value)} must be "" or a path that starts with "/" and does not end with one (SvelteKit's \`paths.base\`).`);
  return value;
}
function normalizeAppDir(value) {
  if (value === void 0 || value === null || value === "") return "_app";
  if (typeof value !== "string" || value.startsWith("/") || value.endsWith("/")) throw new RemoteConfigError(`The remote appDir ${JSON.stringify(value)} must be a path segment without a leading or trailing "/" (SvelteKit's \`appDir\`, "_app" by default).`);
  return value;
}

// src/remote/plugin.ts
function remoteExtra(extra, remote) {
  const host = { origin: normalizeOrigin(remote.origin), base: normalizeBase(remote.base), appDir: normalizeAppDir(remote.appDir) };
  return { ...extra, [EXTRA_KEY]: { ...extra?.[EXTRA_KEY], remote: host } };
}
var isCleartext = (origin) => new URL(origin).protocol === "http:";
function atsExceptionDomain(origin) {
  const { hostname } = new URL(origin);
  const address = /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname) || hostname.startsWith("[");
  return address || !hostname.includes(".") || hostname.endsWith(".local") ? void 0 : hostname;
}
function allowAndroidCleartext(application) {
  application.$ = { ...application.$, "android:usesCleartextTraffic": "true" };
}
function allowIosCleartext(infoPlist, origin) {
  const domain = atsExceptionDomain(origin);
  if (domain === void 0) return;
  const security = infoPlist.NSAppTransportSecurity ?? {};
  security.NSExceptionDomains = { ...security.NSExceptionDomains, [domain]: { ...security.NSExceptionDomains?.[domain], NSExceptionAllowsInsecureHTTPLoads: true, NSIncludesSubdomains: false } };
  infoPlist.NSAppTransportSecurity = security;
}
var withRemoteHost = (config, remote) => {
  config.extra = remoteExtra(config.extra, remote);
  const { origin } = config.extra[EXTRA_KEY].remote;
  if (!isCleartext(origin)) return config;
  config = (0, import_config_plugins2.withAndroidManifest)(config, (config2) => {
    const application = config2.modResults.manifest.application?.[0];
    if (!application) throw new Error("Svelte native could not find <application> in AndroidManifest.xml");
    allowAndroidCleartext(application);
    return config2;
  });
  return (0, import_config_plugins2.withInfoPlist)(config, (config2) => {
    allowIosCleartext(config2.modResults, origin);
    return config2;
  });
};

// src/expo.ts
var headlessExcludedPackages = [
  "react-native-screens",
  "react-native-safe-area-context",
  "expo-updates",
  // the engine host ships its own updates module (native/svelte-core); this package only lets `eas update` run
  "expo-dev-client",
  "expo-dev-launcher",
  "expo-dev-menu",
  "expo-dev-menu-interface",
  "expo-updates-interface",
  "expo-manifests",
  "expo-json-utils",
  "@expo/log-box",
  "@expo/dom-webview"
];
var headlessDroppedTurboModules = ["FrescoModule", "ImageLoader", "ImageStoreManager"];
var bundleMarker = "// Svelte native: bundle the current Metro graph on every release build.";
var flagsBegin = "    // Svelte native: React Native feature flags (generated, do not edit)";
var flagsEnd = "    // Svelte native: end of React Native feature flags";
var headlessPackageName = "SvelteNativeHeadlessMainPackage";
var onDemandPackageName = "SvelteNativeOnDemandPackage";
var onDemandLegacyPackageName = "SvelteNativeOnDemandLegacyPackage";
var onDemandFactoryName = "svelteNativeOnDemand";
var packagesBegin = "          // Svelte native: headless package list (generated, do not edit)";
var packagesEnd = "          // Svelte native: end of headless package list";
var attachBegin = "  // Svelte native: the native libraries the start needs load while the Application is set up (generated, do not edit)";
var attachEnd = "  // Svelte native: end of native library preload";
var startBegin = "    // Svelte native: headless host start (generated, do not edit)";
var startEnd = "    // Svelte native: end of headless host start";
var activityBegin = "  // Svelte native: navigation state across recreation and process death (generated, do not edit)";
var activityEnd = "  // Svelte native: end of navigation state";
var savedBegin = "    // Svelte native: the navigation this Activity was saved with (generated, do not edit)";
var savedEnd = "    // Svelte native: end of saved navigation";
var warmBegin = "    // Svelte native: the process was started for the screen; the view the first screen creates is built off the main thread (generated, do not edit)";
var warmEnd = "    // Svelte native: end of view warm-up";
var launchBegin = "            // Svelte native: the saved navigation reaches JavaScript as initialProps.navigation (generated, do not edit)";
var launchEnd = "            // Svelte native: end of launch options";
var delegateBegin = "  // Svelte native: navigation state restoration (generated, do not edit)";
var delegateEnd = "  // Svelte native: end of navigation state restoration";
var delegateImport = "internal import SvelteCore // Svelte native: navigation state restoration (generated, do not edit)";
var delegateImportLine = /^internal import \w+ \/\/ Svelte native: navigation state restoration \(generated, do not edit\)\n/m;
var gradleBegin = "// Svelte native: headless autolinking excludes (generated, do not edit)";
var gradleEnd = "// Svelte native: end of headless autolinking excludes";
var libraryPackage = "@alfayez/svelte-native";
var escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function recyclingOverrides(option) {
  const recycling = option === true ? { view: true, text: true } : option || {};
  const names = [
    recycling.view && "enableViewRecyclingForView",
    recycling.text && "enableViewRecyclingForText",
    recycling.image && "enableViewRecyclingForImage",
    recycling.scrollView && "enableViewRecyclingForScrollView"
  ].filter((name) => typeof name === "string");
  return names.length ? ["enableViewRecycling", ...names] : [];
}
var defaultAndroidFeatureFlags = { disableViewPreallocationAndroid: true, enablePreparedTextLayout: true };
function androidFeatureFlagsFor(options) {
  return {
    ...defaultAndroidFeatureFlags,
    ...Object.fromEntries(recyclingOverrides(options?.androidViewRecycling).map((name) => [name, true])),
    ...options?.androidFeatureFlags
  };
}
function applyFeatureFlags(contents, overrides) {
  const flags = Array.isArray(overrides) ? Object.fromEntries(overrides.map((name) => [name, true])) : overrides;
  const stripped = contents.replace(new RegExp(`\\n${escapeRegExp(flagsBegin)}[\\s\\S]*?${escapeRegExp(flagsEnd)}`), "");
  if (Object.keys(flags).length === 0) return stripped;
  const anchor = /^[ \t]*loadReactNative\(this\)[ \t]*$/m.exec(stripped);
  if (!anchor) throw new Error("Svelte native could not find loadReactNative(this) in MainApplication.kt");
  const block = [
    flagsBegin,
    "    val svelteNativeAccessedFlags = com.facebook.react.internal.featureflags.ReactNativeFeatureFlags.dangerouslyForceOverride(",
    "      object : com.facebook.react.internal.featureflags.ReactNativeNewArchitectureFeatureFlagsDefaults() {",
    ...Object.entries(flags).map(([name, value]) => `        override fun ${name}(): Boolean = ${value}`),
    "      }",
    "    )",
    '    if (svelteNativeAccessedFlags != null) android.util.Log.w("SvelteNative", "React Native feature flags were read before override: " + svelteNativeAccessedFlags)',
    flagsEnd
  ].join("\n");
  const end = anchor.index + anchor[0].length;
  return `${stripped.slice(0, end)}
${block}${stripped.slice(end)}`;
}
var blockPattern = (begin, end) => new RegExp(`\\n${escapeRegExp(begin)}[\\s\\S]*?${escapeRegExp(end)}`);
function applyHeadlessApplication(contents, onDemand = {}) {
  const stripped = contents.replace(blockPattern(packagesBegin, packagesEnd), "").replace(blockPattern(startBegin, startEnd), "").replace(blockPattern(attachBegin, attachEnd), "");
  const ownAttach = /\boverride\s+fun\s+attachBaseContext\s*\(/.test(stripped);
  if (ownAttach && !stripped.includes("BootBoost.preloadLibraries(")) {
    throw new Error("Svelte native: MainApplication.kt already overrides attachBaseContext. Call expo.modules.svelteengine.BootBoost.preloadLibraries(base) in it, after super.attachBaseContext(base); the plugin adds its own override only where there is none.");
  }
  const packagesAnchor = /^[ \t]*\/\/ add\(MyReactNativePackage\(\)\)[ \t]*$/m.exec(stripped);
  const startAnchor = /^[ \t]*ApplicationLifecycleDispatcher\.onApplicationCreate\(this\)[ \t]*$/m.exec(stripped);
  if (!packagesAnchor || !startAnchor) throw new Error("Svelte native could not find the package list or onApplicationCreate in MainApplication.kt");
  const packages = [
    packagesBegin,
    "          for (index in indices) {",
    `            if (this[index] is com.facebook.react.shell.MainReactPackage) this[index] = ${headlessPackageName}()`,
    ...Object.entries(onDemand).map(([packageClass, names]) => `            if (this[index] is ${packageClass}) this[index] = ${onDemandFactoryName}(this[index], listOf(${names.map((name) => `"${name}"`).join(", ")}))`),
    "          }",
    "          // Views of Expo modules registered lazily are served on demand (see ExpoViews.kt in the engine module).",
    "          add(expo.modules.svelteengine.ExpoViewsPackage())",
    packagesEnd
  ].join("\n");
  const start = [
    startBegin,
    "    // Expo modules register lazily on first use (patched expo-modules-core; see patches/expo-modules-core@57.0.23.patch).",
    '    System.setProperty("expo.modules.lazy", "true")',
    "    // The patch's prewarm thread (app context and boot-time modules built off the pool thread) stays off until a phone A/B and a cold-start soak clear it.",
    '    System.setProperty("expo.modules.prewarm", "false")',
    "    // This thread stays on the big cores while the host starts: the pool thread that initializes Hermes and the TurboModules, and the",
    "    // JavaScript thread it creates, inherit that and keep them until the first mount (BootBoost in the engine module).",
    "    expo.modules.svelteengine.BootBoost.begin()",
    "    // Hermes and TurboModule setup run on a pool thread; beginning now overlaps them with activity creation.",
    "    reactHost.start()",
    "    expo.modules.svelteengine.BootBoost.handOver()",
    startEnd
  ].join("\n");
  const createAnchor = /^[ \t]*override fun onCreate\(\) \{[ \t]*$/m.exec(stripped);
  if (!createAnchor) throw new Error("Svelte native could not find onCreate in MainApplication.kt");
  const attach = [
    attachBegin,
    "  override fun attachBaseContext(base: android.content.Context) {",
    "    super.attachBaseContext(base)",
    "    expo.modules.svelteengine.BootBoost.preloadLibraries(base)",
    "  }",
    attachEnd,
    ""
  ].join("\n");
  const packagesAt = packagesAnchor.index + packagesAnchor[0].length;
  const startAt = startAnchor.index + startAnchor[0].length;
  if (packagesAt > createAnchor.index || createAnchor.index > startAt) throw new Error("Svelte native expected the package list, onCreate and onApplicationCreate in that order in MainApplication.kt");
  return `${stripped.slice(0, packagesAt)}
${packages}${stripped.slice(packagesAt, createAnchor.index)}${ownAttach ? "" : attach}${stripped.slice(createAnchor.index, startAt)}
${start}${stripped.slice(startAt)}`;
}
function applyMainActivity(contents) {
  const stripped = contents.replace(blockPattern(activityBegin, activityEnd), "").replace(blockPattern(savedBegin, savedEnd), "").replace(blockPattern(warmBegin, warmEnd), "").replace(blockPattern(launchBegin, launchEnd), "");
  const classAnchor = /^class MainActivity : ReactActivity\(\) \{[ \t]*$/m.exec(stripped);
  const createAnchor = /^[ \t]*super\.onCreate\(null\)[ \t]*$/m.exec(stripped);
  const delegateAnchor = /(fabricEnabled\s*\))\s*\{\s*\}/.exec(stripped);
  if (!classAnchor || !createAnchor || !delegateAnchor || !(classAnchor.index < createAnchor.index && createAnchor.index < delegateAnchor.index)) {
    throw new Error("Svelte native could not find the class, super.onCreate(null) and the ReactActivityDelegate in MainActivity.kt");
  }
  const members = [
    activityBegin,
    "  private var svelteNavigation: String? = null",
    "",
    "  override fun onSaveInstanceState(outState: Bundle) {",
    "    super.onSaveInstanceState(outState)",
    "    expo.modules.svelteengine.NavigationState.saveTo(outState)",
    "  }",
    "",
    "  override fun onDestroy() {",
    "    expo.modules.svelteengine.NavigationState.destroyed(isFinishing)",
    "    super.onDestroy()",
    "  }",
    activityEnd
  ].join("\n");
  const saved = [
    warmBegin,
    "    expo.modules.svelteengine.BootBoost.activityCreated()",
    "    expo.modules.svelteengine.views.ViewWarmup.begin(this)",
    warmEnd,
    savedBegin,
    "    svelteNavigation = expo.modules.svelteengine.NavigationState.restoredFrom(savedInstanceState)",
    savedEnd,
    ""
  ].join("\n");
  const launch = [
    `${delegateAnchor[1]} {`,
    launchBegin,
    "            override fun getLaunchOptions(): android.os.Bundle? =",
    '              svelteNavigation?.let { json -> android.os.Bundle().apply { putString("navigation", json) } }',
    launchEnd,
    "          }"
  ].join("\n");
  const classEnd = classAnchor.index + classAnchor[0].length;
  const delegateEnd2 = delegateAnchor.index + delegateAnchor[0].length;
  return `${stripped.slice(0, classEnd)}
${members}${stripped.slice(classEnd, createAnchor.index)}${saved}${stripped.slice(createAnchor.index, delegateAnchor.index)}${launch}${stripped.slice(delegateEnd2)}`;
}
function applyAppDelegate(contents) {
  const stripped = contents.replace(blockPattern(delegateBegin, delegateEnd), "").replace(delegateImportLine, "");
  const imports = [...stripped.matchAll(/^(?:(?:internal|public|package|private|fileprivate) |@_exported |@preconcurrency )*import [\w.]+[ \t]*$/gm)];
  const lastImport = imports.at(-1);
  const property = /^[ \t]*var reactNativeFactory: RCTReactNativeFactory\?[ \t]*$/m.exec(stripped);
  if (!lastImport || !property) throw new Error("Svelte native could not find the imports and `var reactNativeFactory: RCTReactNativeFactory?` in AppDelegate.swift");
  const block = [
    delegateBegin,
    "  @objc(application:shouldSaveSecureApplicationState:)",
    "  func svelteNavigationShouldSave(_ application: UIApplication, _ coder: NSCoder) -> Bool {",
    "    SvelteNavigationRestoration.shouldSave(coder)",
    "  }",
    "",
    "  @objc(application:willEncodeRestorableStateWithCoder:)",
    "  func svelteNavigationEncode(_ application: UIApplication, _ coder: NSCoder) {",
    "    SvelteNavigationRestoration.encode(coder)",
    "  }",
    "",
    "  @objc(application:shouldRestoreSecureApplicationState:)",
    "  func svelteNavigationShouldRestore(_ application: UIApplication, _ coder: NSCoder) -> Bool {",
    "    SvelteNavigationRestoration.shouldRestore(coder)",
    "  }",
    "",
    "  @objc(application:didDecodeRestorableStateWithCoder:)",
    "  func svelteNavigationDidDecode(_ application: UIApplication, _ coder: NSCoder) {",
    "    SvelteNavigationRestoration.didDecode(coder)",
    "  }",
    delegateEnd
  ].join("\n");
  const propertyEnd = property.index + property[0].length;
  const importEnd = lastImport.index + lastImport[0].length;
  return `${stripped.slice(0, importEnd)}
${delegateImport}${stripped.slice(importEnd, propertyEnd)}
${block}${stripped.slice(propertyEnd)}`;
}
function applyHeadlessSettings(contents, extra = []) {
  const stripped = contents.replace(blockPattern(gradleBegin, gradleEnd), "").replace(/autolinkLibrariesFromCommand\((?:svelteNativeConfigCommand \+ )?expoAutolinking\.rnConfigCommand \+ svelteNativeExcludeArgs(?:, svelteNativeAppRoot\.asFile, svelteNativeLockFiles)?\)/, "autolinkLibrariesFromCommand(expoAutolinking.rnConfigCommand)");
  const anchor = /^extensions\.configure\(com\.facebook\.react\.ReactSettingsExtension\)/m.exec(stripped);
  if (!anchor || !stripped.includes("autolinkLibrariesFromCommand(expoAutolinking.rnConfigCommand)")) throw new Error("Svelte native could not find the autolinking block in settings.gradle");
  const list = [.../* @__PURE__ */ new Set([...headlessExcludedPackages, ...extra])].map((name) => `"${name}"`).join(", ");
  const block = [
    gradleBegin,
    `def svelteNativeExclude = [${list}]`,
    'def svelteNativeExcludeArgs = svelteNativeExclude.collectMany { ["--exclude", it] }',
    "expoAutolinking.exclude = svelteNativeExclude",
    `def svelteNativeCli = new File(providers.exec { workingDir(rootDir); commandLine("node", "--print", "require.resolve('${libraryPackage}/package.json')") }.standardOutput.asText.get().trim()).getParentFile().toPath().resolve("dist/node/cli.js").toString()`,
    'def svelteNativeConfigCommand = ["node", svelteNativeCli, "android-autolinking"]',
    // React Native keeps the command's output until a lockfile of the app changes: React Native's own list, and the CLI, so that a new version of the
    // library (a workspace or file: dependency changes no lockfile) runs the command again.
    'def svelteNativeAppRoot = settings.layout.rootDirectory.dir("../")',
    'def svelteNativeLockFiles = svelteNativeAppRoot.files("yarn.lock", "package-lock.json", "package.json", "react-native.config.js", svelteNativeCli)',
    gradleEnd,
    ""
  ].join("\n");
  return `${stripped.slice(0, anchor.index)}${block}${stripped.slice(anchor.index)}`.replace("autolinkLibrariesFromCommand(expoAutolinking.rnConfigCommand)", "autolinkLibrariesFromCommand(svelteNativeConfigCommand + expoAutolinking.rnConfigCommand + svelteNativeExcludeArgs, svelteNativeAppRoot.asFile, svelteNativeLockFiles)");
}
var podfileBegin = "  # Svelte native: autolinking excludes (generated, do not edit)";
var podfileEnd = "  # Svelte native: end of autolinking excludes";
var podfileCommandBegin = "  # Svelte native: autolinking excludes for React Native's config command (generated, do not edit)";
var podfileCommandEnd = "  # Svelte native: end of config command excludes";
function applyPodfileAutolinkingExclude(contents, names) {
  const stripped = contents.replace(blockPattern(podfileBegin, podfileEnd), "").replace(blockPattern(podfileCommandBegin, podfileCommandEnd), "").replace(/use_expo_modules!\(exclude: svelte_native_exclude\)/, "use_expo_modules!");
  if (names.length === 0) return stripped;
  const useAnchor = /^[ \t]*use_expo_modules!(?!\()[ \t]*$/m.exec(stripped);
  const commandAnchor = /^[ \t]*config = use_native_modules!\(config_command\)[ \t]*$/m.exec(stripped);
  if (!useAnchor || !commandAnchor || useAnchor.index > commandAnchor.index) throw new Error("Svelte native could not find use_expo_modules! and use_native_modules!(config_command) in the Podfile");
  const list = [
    podfileBegin,
    `  svelte_native_exclude = [${[...new Set(names)].map((name) => `"${name}"`).join(", ")}]`,
    podfileEnd
  ].join("\n");
  const command = [
    podfileCommandBegin,
    "  config_command += svelte_native_exclude.flat_map { |name| ['--exclude', name] } if ENV['EXPO_USE_COMMUNITY_AUTOLINKING'] != '1'",
    podfileCommandEnd
  ].join("\n");
  const useEnd = useAnchor.index + useAnchor[0].length;
  return `${stripped.slice(0, useAnchor.index)}${list}
${stripped.slice(useAnchor.index, useEnd).replace("use_expo_modules!", "use_expo_modules!(exclude: svelte_native_exclude)")}${stripped.slice(useEnd, commandAnchor.index)}${command}
${stripped.slice(commandAnchor.index)}`;
}
function headlessPackageSource(applicationId) {
  const dropped = headlessDroppedTurboModules.map((name) => `"${name}"`).join(", ");
  return `package ${applicationId}

import com.facebook.react.BaseReactPackage
import com.facebook.react.ViewManagerOnDemandReactPackage
import com.facebook.react.bridge.ModuleSpec
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.common.annotations.UnstableReactNativeAPI
import com.facebook.react.module.model.ReactModuleInfoProvider
import com.facebook.react.shell.MainReactPackage
import com.facebook.react.uimanager.ViewManager

// Generated by @alfayez/svelte-native. MainReactPackage without the modules the engine does not use.
// View managers stay on demand through MainReactPackage, so nothing is created at startup.
@OptIn(UnstableReactNativeAPI::class)
class ${headlessPackageName} : BaseReactPackage(), ViewManagerOnDemandReactPackage {
  private val main = MainReactPackage()
  private val dropped = setOf(${dropped})

  override fun getModule(name: String, reactContext: ReactApplicationContext): NativeModule? =
    if (name in dropped) null else main.getModule(name, reactContext)

  override fun getReactModuleInfoProvider(): ReactModuleInfoProvider {
    val infos = main.getReactModuleInfoProvider().getReactModuleInfos().filterKeys { it !in dropped }
    return ReactModuleInfoProvider { infos }
  }

  @Suppress("DEPRECATION")
  override fun getViewManagers(reactContext: ReactApplicationContext): List<ModuleSpec> = main.getViewManagers(reactContext)

  override fun getViewManagerNames(reactContext: ReactApplicationContext): Collection<String> = main.getViewManagerNames(reactContext)

  override fun createViewManager(reactContext: ReactApplicationContext, viewManagerName: String): ViewManager<*, *>? =
    main.createViewManager(reactContext, viewManagerName)
}
`;
}
function onDemandPackageSource(applicationId) {
  return `package ${applicationId}

import com.facebook.react.BaseReactPackage
import com.facebook.react.ReactPackage
import com.facebook.react.ViewManagerOnDemandReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.common.annotations.UnstableReactNativeAPI
import com.facebook.react.module.model.ReactModuleInfoProvider
import com.facebook.react.uimanager.ViewManager

// Generated by @alfayez/svelte-native. A package whose view managers React Native creates on first use: the host would
// create all of them when it starts. The package's TurboModules are served as before; its managers are built together
// (the package creates them as a set) the first time one of its components is mounted. The names are not announced:
// React Native's JavaScript reads one property of \`UIManager\` per announced name when it starts, and each read creates the
// manager. \`createViewManager\` is asked for any component name a mount needs, announced or not.
@OptIn(UnstableReactNativeAPI::class)
class ${onDemandPackageName}(private val delegate: ReactPackage, private val names: Collection<String>) : BaseReactPackage(), ViewManagerOnDemandReactPackage {
  private var managers: Map<String, ViewManager<*, *>>? = null

  override fun getModule(name: String, reactContext: ReactApplicationContext): NativeModule? =
    (delegate as? BaseReactPackage)?.getModule(name, reactContext)

  override fun getReactModuleInfoProvider(): ReactModuleInfoProvider =
    (delegate as? BaseReactPackage)?.getReactModuleInfoProvider() ?: ReactModuleInfoProvider { emptyMap() }

  override fun getViewManagerNames(reactContext: ReactApplicationContext): Collection<String> = emptyList()

  @Synchronized
  override fun createViewManager(reactContext: ReactApplicationContext, viewManagerName: String): ViewManager<*, *>? {
    if (viewManagerName !in names) return null
    val created = managers ?: delegate.createViewManagers(reactContext).associateBy { it.name }.also { managers = it }
    return created[viewManagerName]
  }
}

// The same for a package that still builds its native modules with \`createNativeModules\` (react-native-video's \`VideoManager\`,
// which the library's functions call with the view's tag): React Native reads such a package's modules from that method, and a
// \`BaseReactPackage\` would hide them.
@OptIn(UnstableReactNativeAPI::class)
class ${onDemandLegacyPackageName}(private val delegate: ReactPackage, private val names: Collection<String>) : ReactPackage, ViewManagerOnDemandReactPackage {
  private var managers: Map<String, ViewManager<*, *>>? = null

  @Suppress("DEPRECATION")
  override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> = delegate.createNativeModules(reactContext)

  override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()

  override fun getViewManagerNames(reactContext: ReactApplicationContext): Collection<String> = emptyList()

  @Synchronized
  override fun createViewManager(reactContext: ReactApplicationContext, viewManagerName: String): ViewManager<*, *>? {
    if (viewManagerName !in names) return null
    val created = managers ?: delegate.createViewManagers(reactContext).associateBy { it.name }.also { managers = it }
    return created[viewManagerName]
  }
}

/** The wrapper that keeps the kind of package it wraps: modules through \`getModule\` for a \`BaseReactPackage\`, through \`createNativeModules\` for any other. */
fun ${onDemandFactoryName}(delegate: ReactPackage, names: Collection<String>): ReactPackage =
  if (delegate is BaseReactPackage) ${onDemandPackageName}(delegate, names) else ${onDemandLegacyPackageName}(delegate, names)
`;
}
function leaveOutOfAutoPlugins(config, names) {
  if (names.length === 0) return config;
  config._internal ??= {};
  const internal = config._internal;
  internal.pluginHistory ??= {};
  const history = internal.pluginHistory;
  for (const name of names) history[name] ??= { name, version: "left out of autolinking" };
  return config;
}
var withSvelteNative = (config, options) => {
  config = leaveOutOfAutoPlugins(config, options?.autolinkingExclude ?? []);
  config = withCapabilities(config, options?.capabilities, { excluded: options?.autolinkingExclude });
  if (options?.remote) config = withRemoteHost(config, options.remote);
  for (const platform of ["android", "ios"]) {
    config = (0, import_config_plugins3.withDangerousMod)(config, [platform, async (config2) => {
      await syncNative(config2.modRequest.projectRoot, { variant: options?.variant });
      return config2;
    }]);
  }
  config = (0, import_config_plugins3.withDangerousMod)(config, ["android", async (config2) => {
    const applicationId = config2.android?.package;
    if (!applicationId) throw new Error("Svelte native needs android.package in the Expo config");
    const directory = (0, import_node_path5.join)(config2.modRequest.platformProjectRoot, "app/src/main/java", ...applicationId.split("."));
    const file = (0, import_node_path5.join)(directory, `${headlessPackageName}.kt`);
    await (0, import_promises2.mkdir)(directory, { recursive: true });
    await (0, import_promises2.writeFile)(file, headlessPackageSource(applicationId));
    await (0, import_promises2.writeFile)((0, import_node_path5.join)(directory, `${onDemandPackageName}.kt`), onDemandPackageSource(applicationId));
    return config2;
  }]);
  config = (0, import_config_plugins3.withAndroidManifest)(config, (config2) => {
    const manifest = config2.modResults.manifest;
    const application = manifest.application?.[0];
    if (!application) throw new Error("Svelte native could not find <application> in AndroidManifest.xml");
    const emoji = "androidx.emoji2.text.EmojiCompatInitializer";
    const providers = application.provider ?? [];
    const startup = providers.find((provider) => provider.$["android:name"] === "androidx.startup.InitializationProvider");
    manifest.$["xmlns:tools"] ??= "http://schemas.android.com/tools";
    const entry = { $: { "android:name": emoji, "tools:node": "remove" } };
    if (startup) startup["meta-data"] = [...(startup["meta-data"] ?? []).filter((item) => item.$["android:name"] !== emoji), entry];
    else providers.push({ $: { "android:name": "androidx.startup.InitializationProvider", "android:authorities": `${config2.android?.package}.androidx-startup`, "android:exported": "false", "tools:node": "merge" }, "meta-data": [entry] });
    application.provider = providers;
    return config2;
  });
  config = (0, import_config_plugins3.withSettingsGradle)(config, (config2) => {
    config2.modResults.contents = applyHeadlessSettings(config2.modResults.contents, options?.autolinkingExclude);
    return config2;
  });
  config = (0, import_config_plugins3.withPodfile)(config, (config2) => {
    config2.modResults.contents = applyPodfileAutolinkingExclude(config2.modResults.contents, options?.autolinkingExclude ?? []);
    return config2;
  });
  if (options?.androidProfileable) {
    config = (0, import_config_plugins3.withAndroidManifest)(config, (config2) => {
      const application = config2.modResults.manifest.application?.[0];
      if (!application) throw new Error("Svelte native could not find <application> in AndroidManifest.xml");
      application.profileable = [{ $: { "android:shell": "true" } }];
      return config2;
    });
  }
  config = (0, import_config_plugins3.withDangerousMod)(config, ["android", async (config2) => {
    const dir = (0, import_node_path5.join)(config2.modRequest.platformProjectRoot, "app", "src", "main");
    await (0, import_promises2.mkdir)(dir, { recursive: true });
    await (0, import_promises2.writeFile)((0, import_node_path5.join)(dir, "baseline-prof.txt"), baselineProfile());
    return config2;
  }]);
  config = (0, import_config_plugins3.withMainActivity)(config, (config2) => {
    if (config2.modResults.language !== "kt") throw new Error("Svelte native requires Expo's Kotlin MainActivity");
    config2.modResults.contents = applyMainActivity(config2.modResults.contents);
    return config2;
  });
  config = (0, import_config_plugins3.withAppDelegate)(config, (config2) => {
    if (config2.modResults.language !== "swift") throw new Error("Svelte native requires Expo's Swift AppDelegate");
    config2.modResults.contents = applyAppDelegate(config2.modResults.contents);
    return config2;
  });
  config = (0, import_config_plugins3.withMainApplication)(config, (config2) => {
    if (config2.modResults.language !== "kt") throw new Error("Svelte native requires Expo's Kotlin MainApplication");
    config2.modResults.contents = applyHeadlessApplication(applyFeatureFlags(config2.modResults.contents, androidFeatureFlagsFor(options)), options?.androidOnDemandViewManagers);
    return config2;
  });
  return (0, import_config_plugins3.withAppBuildGradle)(config, (config2) => {
    if (config2.modResults.language !== "groovy") throw new Error("Svelte native requires Expo's Groovy Android template");
    if (!config2.modResults.contents.includes(bundleMarker)) {
      config2.modResults.contents += `
${bundleMarker}
tasks.withType(com.facebook.react.tasks.BundleHermesCTask).configureEach {
    outputs.upToDateWhen { false }
}
`;
    }
    return config2;
  });
};
var expo_default = withSvelteNative;
function baselineProfile() {
  return [
    "HSPLexpo/modules/svelteengine/**->**(**)**",
    "HSPLexpo/modules/svelteupdates/**->**(**)**",
    "Lexpo/modules/svelteengine/**;",
    "Lexpo/modules/svelteupdates/**;",
    ""
  ].join("\n");
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  androidFeatureFlagsFor,
  applyAppDelegate,
  applyFeatureFlags,
  applyHeadlessApplication,
  applyHeadlessSettings,
  applyMainActivity,
  applyPodfileAutolinkingExclude,
  baselineProfile,
  defaultAndroidFeatureFlags,
  headlessDroppedTurboModules,
  headlessExcludedPackages,
  headlessPackageSource,
  leaveOutOfAutoPlugins,
  onDemandPackageSource
});
