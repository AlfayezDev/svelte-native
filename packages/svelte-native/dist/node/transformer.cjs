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

// src/transformer.ts
var transformer_exports = {};
__export(transformer_exports, {
  assertWorkletsReadNoState: () => assertWorkletsReadNoState,
  getCacheKey: () => getCacheKey,
  sourceOf: () => sourceOf,
  transform: () => transform,
  upstreamTransformerPath: () => upstreamTransformerPath
});
module.exports = __toCommonJS(transformer_exports);
var import_node_module3 = require("node:module");
var import_node_path5 = require("node:path");
var import_compiler2 = require("svelte/compiler");
var import_esbuild = require("esbuild");
var import_node_crypto = require("node:crypto");
var import_node_fs3 = require("node:fs");
var import_types = require("@babel/types");

// src/lower.ts
var import_compiler = require("svelte/compiler");
var PACKAGE = "@example/svelte-native";
var GESTURES = `${PACKAGE}/gestures`;
var RENDERER = `${PACKAGE}/renderer`;
var SPREAD_HELPER = "__svelteNativeSpread";
var VALUE_HELPER = "__svelteNativeValue";
var LOWERED_TAGS = {
  View: "native-view",
  Text: "native-text",
  ScrollView: "native-scroll",
  Image: "native-image",
  ActivityIndicator: "native-spinner",
  Pressable: "native-pressable"
};
var WARN_DIRECTIVES = /* @__PURE__ */ new Set(["UseDirective", "TransitionDirective", "AnimateDirective"]);
var NOT_PRIMITIVES = `${PACKAGE}/svg`;
function fromPackage(source) {
  return typeof source === "string" && (source === PACKAGE || source.startsWith(`${PACKAGE}/`) && source !== NOT_PRIMITIVES);
}
function collectImports(program, locals, actions) {
  for (const statement of program?.body ?? []) {
    if (statement.type !== "ImportDeclaration" || statement.importKind === "type" || !fromPackage(statement.source?.value)) continue;
    for (const specifier of statement.specifiers) {
      if (specifier.type !== "ImportSpecifier" || specifier.importKind === "type") continue;
      const imported = specifier.imported.name ?? specifier.imported.value;
      if (Object.hasOwn(LOWERED_TAGS, imported)) locals.set(specifier.local.name, imported);
      if (imported === "gesture" && statement.source?.value === GESTURES) actions.add(specifier.local.name);
    }
  }
}
function mustStayComponent(node, primitive) {
  for (const attribute of node.attributes) {
    if (attribute.type === "LetDirective") return true;
    if (attribute.type === "BindDirective" && attribute.name !== "this") return true;
    if (attribute.type === "Attribute" && attribute.name === "children") return true;
    if (primitive === "Pressable" && attribute.type === "Attribute" && attribute.name === "style") {
      const value = attribute.value;
      const isStatic = value === true || (Array.isArray(value) ? value.every((part) => part.type === "Text") : value.type === "ExpressionTag" && value.expression.type === "ObjectExpression");
      if (!isStatic) return true;
    }
  }
  return (node.fragment?.nodes ?? []).some((child) => child.type === "SnippetBlock");
}
function couldBeFunction(expression) {
  switch (expression.type) {
    case "Literal":
    case "TemplateLiteral":
    case "ObjectExpression":
    case "ArrayExpression":
    case "BinaryExpression":
    case "UnaryExpression":
    case "UpdateExpression":
      return false;
    default:
      return true;
  }
}
function walk(value, visit) {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) walk(item, visit);
    return;
  }
  const node = value;
  if (typeof node.type === "string") visit(node);
  for (const key in node) if (key !== "metadata") walk(node[key], visit);
}
function lowerPrimitives(content, options = {}) {
  if (!content.includes(PACKAGE)) return content;
  let ast;
  try {
    ast = (0, import_compiler.parse)(content, { modern: true, filename: options.filename });
  } catch {
    return content;
  }
  const locals = /* @__PURE__ */ new Map();
  const actions = /* @__PURE__ */ new Set();
  collectImports(ast.instance?.content, locals, actions);
  collectImports(ast.module?.content, locals, actions);
  if (!locals.size) return content;
  const warn = options.warn ?? ((message) => console.warn(message));
  const edits = [];
  const helpers = /* @__PURE__ */ new Set();
  const wrap = (expression, helper) => {
    helpers.add(helper);
    edits.push({ start: expression.start, end: expression.start, text: `${helper}(` }, { start: expression.end, end: expression.end, text: ")" });
  };
  const seen = /* @__PURE__ */ new Set();
  walk(ast.fragment, (node) => {
    if (node.type !== "Component" || seen.has(node)) return;
    seen.add(node);
    const primitive = locals.get(node.name);
    if (!primitive || mustStayComponent(node, primitive)) return;
    const tag = LOWERED_TAGS[primitive];
    const spreads = node.attributes.some((attribute) => attribute.type === "SpreadAttribute");
    for (const attribute of node.attributes) {
      if (spreads && attribute.type === "SpreadAttribute") wrap(attribute.expression, SPREAD_HELPER);
      if (spreads && attribute.type === "Attribute" && !attribute.name.startsWith("on") && attribute.name !== "style" && attribute.value !== true && !Array.isArray(attribute.value) && attribute.value.type === "ExpressionTag" && couldBeFunction(attribute.value.expression)) {
        if (content[attribute.start] === "{") edits.push({ start: attribute.start, end: attribute.start, text: `${attribute.name}=` });
        wrap(attribute.value.expression, VALUE_HELPER);
      }
      if (attribute.type === "Attribute" && attribute.name === "style" && content.startsWith("style", attribute.start)) {
        edits.push({ start: attribute.start, end: attribute.start + "style".length, text: "nativeStyle" });
      }
      if (attribute.type === "Attribute" && attribute.value === true) {
        edits.push({ start: attribute.end, end: attribute.end, text: "={true}" });
      }
      if (WARN_DIRECTIVES.has(attribute.type) && !(attribute.type === "UseDirective" && actions.has(attribute.name))) {
        warn(`${options.filename ?? "component"}: ${attribute.type === "UseDirective" ? "use:" : attribute.type === "AnimateDirective" ? "animate:" : "transition:"}${attribute.name} on <${node.name}> is passed to <${tag}> unchanged; native elements do not run DOM directives`);
      }
    }
    edits.push({ start: node.start + 1, end: node.start + 1 + node.name.length, text: tag });
    const source = content.slice(node.start, node.end);
    if (source.endsWith("/>")) {
      edits.push({ start: node.end - 2, end: node.end, text: `></${tag}>` });
    } else {
      const close = content.lastIndexOf(`</${node.name}`, node.end - 1);
      if (close < node.start) return;
      edits.push({ start: close + 2, end: close + 2 + node.name.length, text: tag });
    }
  });
  if (!edits.length) return content;
  const script = ast.instance ?? ast.module;
  if (helpers.size && script) {
    const names = [...helpers].sort().map((helper) => `${helper === SPREAD_HELPER ? "hostSpread" : "hostValue"} as ${helper}`);
    edits.push({ start: script.content.start, end: script.content.start, text: ` import { ${names.join(", ")} } from "${RENDERER}";` });
  }
  edits.sort((a, b) => b.start - a.start);
  let output = content;
  for (const edit of edits) output = output.slice(0, edit.start) + edit.text + output.slice(edit.end);
  return output;
}

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

// src/svelte-build.ts
var import_node_fs2 = require("node:fs");
var import_node_module = require("node:module");
var import_node_path2 = require("node:path");
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
    manifestPath = from ?? (0, import_node_module.createRequire)(__importMetaUrl).resolve("svelte/package.json");
  } catch {
    return { ok: false, version: null, directory: null, reason: "missing" };
  }
  const directory = (0, import_node_path2.dirname)(manifestPath);
  const manifest = JSON.parse((0, import_node_fs2.readFileSync)(manifestPath, "utf8"));
  const version = manifest.version ?? null;
  const exported = manifest.exports !== void 0 && "./renderer" in manifest.exports;
  if (!exported || !(0, import_node_fs2.existsSync)((0, import_node_path2.join)(directory, "src/renderer/index.js"))) return { ok: false, version, directory, reason: "stock-release" };
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

// src/remote/transform.ts
var import_node_path4 = require("node:path");
var import_parser = require("@babel/parser");

// src/remote/kit.ts
var import_node_module2 = require("node:module");
var import_node_path3 = require("node:path");
var require2 = (0, import_node_module2.createRequire)(__importMetaUrl);
var kitRootCache;
function findKitRoot() {
  if (kitRootCache === void 0) {
    try {
      kitRootCache = (0, import_node_path3.dirname)(require2.resolve("@sveltejs/kit/package.json"));
    } catch {
      kitRootCache = null;
    }
  }
  return kitRootCache;
}
function kitMissingMessage(what) {
  return `${what} needs \`@sveltejs/kit\`, which is not installed (an optional peer dependency of @example/svelte-native: only remote functions and the web target use it). Install the version the package was written against: \`pnpm add @sveltejs/kit@3.0.0-next.27\`, and copy its patch (README, "Apply the patches").`;
}
function kitRoot(what = "The remote function runtime (`@example/svelte-native/remote`)") {
  const found = findKitRoot();
  if (found === null) throw new Error(kitMissingMessage(what));
  return found;
}

// src/remote/transform.ts
var REMOTE_RUNTIME = "@example/svelte-native/remote/runtime";
var REMOTE_GLOBALS = "@example/svelte-native/remote/globals";
var remoteModulePattern = /[/.]remote\.[^/]+$/;
var posix = (path) => path.replaceAll("\\", "/");
function isRemoteModule(filename) {
  const path = posix(filename);
  return remoteModulePattern.test(path) && /\.[cm]?[jt]s$/.test(path) && !path.includes("/node_modules/");
}
function hash(value) {
  let result = 5381;
  let index = value.length;
  while (index) result = result * 33 ^ value.charCodeAt(--index);
  return (result >>> 0).toString(36);
}
function remoteHash(filename, root) {
  return hash(posix((0, import_node_path4.relative)(root, filename)));
}
var RemoteModuleError = class extends Error {
  constructor(filename, message, node) {
    super(`${filename}${node?.loc ? `:${node.loc.start.line}:${node.loc.start.column + 1}` : ""}: ${message}`);
    this.name = "RemoteModuleError";
  }
};
var FUNCTIONS = /* @__PURE__ */ new Set(["query", "command", "form", "prerender"]);
var WRAPPERS = /* @__PURE__ */ new Set(["TSAsExpression", "TSSatisfiesExpression", "TSNonNullExpression", "TSTypeAssertion", "TSInstantiationExpression", "ParenthesizedExpression"]);
var unwrap = (node) => WRAPPERS.has(node.type) ? unwrap(node.expression) : node;
var propertyName = (member) => !member.computed && member.property.type === "Identifier" ? member.property.name : member.computed && member.property.type === "StringLiteral" ? member.property.value : void 0;
var exportedName = (node) => node.type === "Identifier" ? node.name : String(node.value);
function serverImports(program) {
  const functions = /* @__PURE__ */ new Map();
  const namespaces = /* @__PURE__ */ new Set();
  for (const statement of program.body) {
    if (statement.type !== "ImportDeclaration" || statement.importKind === "type" || statement.source.value !== "$app/server") continue;
    for (const specifier of statement.specifiers) {
      if (specifier.type === "ImportNamespaceSpecifier") namespaces.add(specifier.local.name);
      else if (specifier.type === "ImportSpecifier" && specifier.importKind !== "type") {
        const imported = exportedName(specifier.imported);
        if (FUNCTIONS.has(imported)) functions.set(specifier.local.name, imported);
      }
    }
  }
  return { functions, namespaces };
}
function kindOf(expression, imports) {
  const call = unwrap(expression);
  if (call.type !== "CallExpression") return void 0;
  const callee = unwrap(call.callee);
  const named = (node) => {
    const target = unwrap(node);
    if (target.type === "Identifier") return imports.functions.get(target.name);
    if (target.type === "MemberExpression" && unwrap(target.object).type === "Identifier" && imports.namespaces.has(unwrap(target.object).name)) {
      const name = propertyName(target);
      return name !== void 0 && FUNCTIONS.has(name) ? name : void 0;
    }
    return void 0;
  };
  if (callee.type === "MemberExpression") {
    const member = propertyName(callee);
    if ((member === "batch" || member === "live") && named(callee.object) === "query") return member === "batch" ? "query_batch" : "query_live";
  }
  return named(callee);
}
function remoteExports(source, filename) {
  const typescript = /\.[cm]?tsx?$/.test(filename);
  let ast;
  try {
    ast = (0, import_parser.parse)(source, { sourceType: "module", plugins: typescript ? ["typescript"] : [] });
  } catch (error) {
    throw new RemoteModuleError(filename, `cannot be parsed: ${error instanceof Error ? error.message : String(error)}`);
  }
  const { program } = ast;
  const imports = serverImports(program);
  const declared = /* @__PURE__ */ new Map();
  for (const statement of program.body) {
    if (statement.type === "VariableDeclaration") {
      for (const declarator of statement.declarations) if (declarator.id.type === "Identifier" && declarator.init) declared.set(declarator.id.name, declarator.init);
    }
  }
  const found = [];
  const add = (name, expression, at) => {
    const kind = expression && kindOf(expression, imports);
    if (!kind) throw new RemoteModuleError(filename, `\`${name}\` is exported from a remote module but is not the result of a call to \`query\`, \`query.batch\`, \`query.live\`, \`command\`, \`form\` or \`prerender\` imported from "$app/server". All exports from this file must be remote functions, and Metro finds them in the source, so create them in the export itself (\`export const ${name} = query(...)\`).`, at);
    found.push({ name, kind });
  };
  for (const statement of program.body) {
    if (statement.type === "ExportDefaultDeclaration") throw new RemoteModuleError(filename, "Cannot export `default` from a remote module: use named exports instead", statement);
    if (statement.type === "ExportAllDeclaration") {
      if (statement.exportKind === "type") continue;
      throw new RemoteModuleError(filename, "`export *` cannot be used in a remote module: the exports are found in the source of this file", statement);
    }
    if (statement.type !== "ExportNamedDeclaration" || statement.exportKind === "type") continue;
    if (statement.source) throw new RemoteModuleError(filename, "A remote module cannot re-export from another module: the exports are found in the source of this file", statement);
    const declaration = statement.declaration;
    if (declaration) {
      if (declaration.type === "TSTypeAliasDeclaration" || declaration.type === "TSInterfaceDeclaration") continue;
      if (declaration.type !== "VariableDeclaration") throw new RemoteModuleError(filename, `\`${declaration.id?.name ?? "default"}\` exported from a remote module is invalid: all exports from this file must be remote functions`, declaration);
      for (const declarator of declaration.declarations) {
        if (declarator.id.type !== "Identifier") throw new RemoteModuleError(filename, "A remote module cannot export a destructured declaration: each export is one remote function", declarator);
        add(declarator.id.name, declarator.init, declarator);
      }
      continue;
    }
    for (const specifier of statement.specifiers) {
      if (specifier.exportKind === "type") continue;
      add(exportedName(specifier.exported), declared.get(specifier.local.name), specifier);
    }
  }
  return found;
}
var RESERVED = /* @__PURE__ */ new Set(["do", "if", "in", "for", "let", "new", "try", "var", "case", "else", "enum", "eval", "null", "this", "true", "void", "with", "await", "break", "catch", "class", "const", "false", "super", "throw", "while", "yield", "delete", "export", "import", "public", "return", "static", "switch", "typeof", "default", "extends", "finally", "package", "private", "continue", "debugger", "function", "arguments", "interface", "protected", "implements", "instanceof"]);
var VALID_IDENTIFIER = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/;
function remoteStub(exports2, moduleHash) {
  const names = new Set(exports2.map((entry) => entry.name));
  let namespace = "__remote";
  for (let index = 0; names.has(namespace); index++) namespace = `__remote${index}`;
  let alias = 0;
  const declarations = [];
  const reexports = [];
  for (const { name, kind } of exports2) {
    const expression = `${namespace}.${kind}(${JSON.stringify(`${moduleHash}/${name}`)})`;
    if (VALID_IDENTIFIER.test(name) && !RESERVED.has(name)) {
      declarations.push(`export const ${name} = ${expression};`);
      continue;
    }
    let local = `_${alias++}`;
    while (names.has(local)) local = `_${alias++}`;
    declarations.push(`const ${local} = ${expression};`);
    reexports.push(`${local} as ${VALID_IDENTIFIER.test(name) ? name : JSON.stringify(name)}`);
  }
  return `import * as ${namespace} from ${JSON.stringify(REMOTE_RUNTIME)};

${declarations.join("\n")}${reexports.length > 0 ? `
export { ${reexports.join(", ")} };` : ""}
`;
}
function transformRemoteModule(source, filename, root) {
  return remoteStub(remoteExports(source, filename), remoteHash(filename, root));
}
var SHADOWS = [
  { pattern: /\/node_modules\/@sveltejs\/kit\/src\/runtime\/client\/remote-functions\//, names: ["fetch", "location", "navigator", "window", "FinalizationRegistry", "WeakRef", "__SVELTEKIT_DEV__"] },
  { pattern: /\/node_modules\/@sveltejs\/kit\/src\/runtime\/form-utils\.js$/, names: ["Blob"] },
  { pattern: /\/node_modules\/@sveltejs\/kit\/src\/runtime\/utils\.js$/, names: ["btoa", "atob"] }
];
function kitGlobalsImport(filename) {
  const path = posix(filename);
  const shadow = SHADOWS.find(({ pattern }) => pattern.test(path));
  return shadow && `
import { ${shadow.names.join(", ")} } from ${JSON.stringify(REMOTE_GLOBALS)};
`;
}

// src/transformer.ts
var import_trace_mapping = require("@jridgewell/trace-mapping");
var require3 = (0, import_node_module3.createRequire)(__importMetaUrl);
function upstreamTransformerPath(searchFrom = [process.cwd(), __dirname]) {
  let expoManifest;
  try {
    expoManifest = require3.resolve("expo/package.json", { paths: [...searchFrom] });
  } catch (cause) {
    throw new Error("The Metro transformer of @example/svelte-native needs `expo`, which it could not resolve (from the app's directory or from the package). Install it: `npx expo install expo`.", { cause });
  }
  return require3.resolve("@expo/metro-config/babel-transformer", { paths: [(0, import_node_path5.dirname)(expoManifest)] });
}
var upstream = require3(upstreamTransformerPath());
function sourceOf(input) {
  const { filename, src } = input;
  if (isRemoteModule(filename)) {
    const root = input.options.projectRoot;
    if (!root) throw new Error(`${filename}: Metro did not pass its project root, which the ids of remote functions are relative to`);
    kitRoot(`${filename} is a remote function module (\`*.remote.ts\`), which`);
    return transformRemoteModule(src, filename, root);
  }
  return src + (kitGlobalsImport(filename) ?? "");
}
var rendererChecked = false;
function requireCustomRenderer() {
  if (rendererChecked) return;
  assertCustomRenderer("The Metro transformer of @example/svelte-native");
  rendererChecked = true;
}
function assertWorkletsReadNoState(filename, ast, runes) {
  const state = /* @__PURE__ */ new Set();
  let reached = false;
  (0, import_types.traverseFast)(ast, (node) => {
    if (!(0, import_types.isObjectProperty)(node) || !(0, import_types.isIdentifier)(node.key, { name: "code" }) || !(0, import_types.isStringLiteral)(node.value)) return;
    const source = node.value.value;
    const captured = /^function [\w$]*\([^)]*\)\{const\{([^}]*)\}=this\.__closure;/.exec(source)?.[1].split(",");
    if (!captured?.includes("$")) return;
    reached = true;
    for (const read of source.matchAll(/\$\.\w+\(([A-Za-z_$][\w$]*)/g)) state.add(read[1]);
  });
  if (!reached) return;
  const names = [...state].map((name) => `\`${name}\``).join(", ");
  const what = names ? `${names}, which Svelte compiled into reactive state` : "reactive state (Svelte's runtime, `$`)";
  throw new Error(`${filename}: a worklet reads ${what}. A worklet runs on the UI runtime, which has no Svelte, so it cannot read state; on the device it would throw "Tried to synchronously call a Remote Function" when the screen mounts. ${runes ? "State in runes mode is `$state`, `$derived` and props: copy the value into a shared value (`createSharedValue`) on the JavaScript side and read that in the worklet." : "This component is not in runes mode, where a variable that the markup mutates (`count.value = ...` in a handler) is state even when it is a `const`. Add `<svelte:options runes />` to the component: there a `const` shared value stays a plain constant."}`);
}
function transform(input) {
  const { filename } = input;
  const src = sourceOf(input);
  let code = src;
  let runes = true;
  const maps = [];
  const compiledBySvelte = /\.svelte(\.[jt]s)?$/.test(filename);
  if (filename.endsWith(".svelte")) {
    requireCustomRenderer();
    const result = (0, import_compiler2.compile)(lowerPrimitives(src, { filename }), {
      filename,
      dev: false,
      css: "external",
      experimental: { customRenderer: "@example/svelte-native/renderer" }
    });
    if (result.css?.code.trim()) throw new Error(`${filename}: use native style props; browser CSS is not supported`);
    code = result.js.code;
    runes = result.metadata.runes;
    if (result.js.map) maps.push(new import_trace_mapping.TraceMap(result.js.map.toString()));
  } else {
    const svelteModule = /\.svelte\.[jt]s$/.test(filename);
    const stripTypes = /\.tsx?$/.test(filename) && (svelteModule || !filename.includes("/node_modules/")) && !src.includes("codegenNativeComponent") && !src.includes("codegenNativeCommands");
    if (stripTypes) {
      const stripped = (0, import_esbuild.transformSync)(src, { loader: filename.endsWith(".tsx") ? "tsx" : "ts", jsx: "preserve", target: "es2022", sourcemap: "external", sourcefile: filename });
      code = stripped.code;
      maps.push(new import_trace_mapping.TraceMap(stripped.map));
    }
    if (svelteModule) {
      const result = (0, import_compiler2.compileModule)(code, { filename, dev: false, generate: "client" });
      code = result.js.code;
      if (result.js.map) maps.unshift(new import_trace_mapping.TraceMap(result.js.map.toString()));
    }
  }
  const output = upstream.transform({ ...input, src: code });
  if (compiledBySvelte && output.ast) assertWorkletsReadNoState(filename, output.ast, runes);
  if (maps.length && output.ast) (0, import_types.traverseFast)(output.ast, (node) => {
    if (!node.loc) return;
    for (const position of [node.loc.start, node.loc.end]) {
      for (const map of maps) {
        const original = (0, import_trace_mapping.originalPositionFor)(map, position);
        if (original.line === null || original.column === null) break;
        position.line = original.line;
        position.column = original.column;
      }
    }
  });
  return output;
}
function getCacheKey(options) {
  const files = [__filename];
  if (__dirname === sourceDirectory) files.push(sourceFile("lower.ts"), sourceFile("remote/transform.ts"));
  const hash2 = (0, import_node_crypto.createHash)("sha256");
  for (const file of files) hash2.update((0, import_node_fs3.readFileSync)(file));
  return hash2.update(upstream.getCacheKey(options)).digest("hex");
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  assertWorkletsReadNoState,
  getCacheKey,
  sourceOf,
  transform,
  upstreamTransformerPath
});
