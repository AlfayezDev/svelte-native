// biome-ignore-all lint/suspicious/noExplicitAny: a structural walk of the Babel AST
/**
 * What the build does with SvelteKit remote functions: turns a `*.remote.ts` module into the client stubs the browser gets, and says where the
 * SvelteKit client files this package reuses are found. Pure Node (no React Native, no Metro), so the Metro integration, the transformer and the
 * tests share one reading of both.
 *
 * SvelteKit's Vite plugin (`@sveltejs/kit/src/exports/vite/plugins/remote.js`, 3.1.1) gives each remote module an id, the hash of
 * its path from the project root, and replaces the module in the client build by `export const name = __remote.<kind>('<hash>/<name>')`.
 * It learns the names and kinds by running the server module. Metro cannot run the server module (it imports a database), so the names
 * and kinds are read from the source: an export must be the result of a call to `query`, `query.batch`, `query.live`, `command`, `form` or
 * `prerender` imported from `$app/server`, which is how every remote function is written.
 */
import { dirname, join, relative, resolve } from "node:path";
import { parse } from "@babel/parser";
import { sourceDirectory } from "../package-root.ts";
import { findKitRoot, kitRoot } from "./kit.ts";

export { kitRoot } from "./kit.ts";

/** The module the stubs call into: the native client runtime (`remote/runtime.ts`). */
export const REMOTE_RUNTIME = "@alfayez/svelte-native/remote/runtime";
/** The module that gives the SvelteKit client files the globals they use and a native does not have (`remote/globals.ts`). */
export const REMOTE_GLOBALS = "@alfayez/svelte-native/remote/globals";

/** The kinds of remote function. Each is the name of a function of SvelteKit's client runtime (`client/remote-functions/index.js`). */
export type RemoteKind = "query" | "query_batch" | "query_live" | "command" | "form" | "prerender";
export type RemoteExport = { name: string; kind: RemoteKind };

/** Copy of `remote_module_pattern` (`src/exports/vite/utils.js`): `x.remote.ts`, `remote.js`. */
export const remoteModulePattern = /[/.]remote\.[^/]+$/;

const posix = (path: string) => path.replaceAll("\\", "/");

/**
 * Whether Metro replaces this file by client stubs. SvelteKit also accepts remote modules inside packages that peer-depend on it;
 * a package in `node_modules` is not replaced here (its server code could not be bundled either), and only JavaScript and TypeScript files are.
 */
export function isRemoteModule(filename: string): boolean {
  const path = posix(filename);
  return remoteModulePattern.test(path) && /\.[cm]?[jt]s$/.test(path) && !path.includes("/node_modules/");
}

/** Copy of `hash` for strings (`src/utils/hash.js`, djb2): SvelteKit's id of a remote module is this hash of its project-relative path. */
export function hash(value: string): string {
  let result = 5381;
  let index = value.length;
  while (index) result = (result * 33) ^ value.charCodeAt(--index);
  return (result >>> 0).toString(36);
}

/** The id SvelteKit's server registers a remote module under: `hash(posixify(path.relative(root, file)))` (the Vite plugin's `file` and `hash`). */
export function remoteHash(filename: string, root: string): string {
  return hash(posix(relative(root, filename)));
}

export class RemoteModuleError extends Error {
  constructor(filename: string, message: string, node?: { loc?: { start: { line: number; column: number } } | null }) {
    super(`${filename}${node?.loc ? `:${node.loc.start.line}:${node.loc.start.column + 1}` : ""}: ${message}`);
    this.name = "RemoteModuleError";
  }
}

// The Babel AST is walked structurally, so nodes are deliberately loosely typed.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Node = { type: string; loc?: any; [key: string]: any };

const FUNCTIONS = new Set(["query", "command", "form", "prerender"]);
const WRAPPERS = new Set(["TSAsExpression", "TSSatisfiesExpression", "TSNonNullExpression", "TSTypeAssertion", "TSInstantiationExpression", "ParenthesizedExpression"]);

const unwrap = (node: Node): Node => (WRAPPERS.has(node.type) ? unwrap(node.expression) : node);
const propertyName = (member: Node): string | undefined => (!member.computed && member.property.type === "Identifier" ? member.property.name : member.computed && member.property.type === "StringLiteral" ? member.property.value : undefined);
const exportedName = (node: Node): string => (node.type === "Identifier" ? node.name : String(node.value));

/**
 * The imports of `$app/server` a module has: its local names for `query`, `command`, `form` and `prerender`, and the namespaces
 * (`import * as server from "$app/server"`).
 */
function serverImports(program: Node): { functions: Map<string, string>; namespaces: Set<string> } {
  const functions = new Map<string, string>();
  const namespaces = new Set<string>();
  for (const statement of program.body as Node[]) {
    if (statement.type !== "ImportDeclaration" || statement.importKind === "type" || statement.source.value !== "$app/server") continue;
    for (const specifier of statement.specifiers as Node[]) {
      if (specifier.type === "ImportNamespaceSpecifier") namespaces.add(specifier.local.name);
      else if (specifier.type === "ImportSpecifier" && specifier.importKind !== "type") {
        const imported = exportedName(specifier.imported);
        if (FUNCTIONS.has(imported)) functions.set(specifier.local.name, imported);
      }
    }
  }
  return { functions, namespaces };
}

/** The kind of remote function an expression creates (`query(...)`, `query.batch(...)`, `server.form(...)`), or `undefined` when it is none of them. */
function kindOf(expression: Node, imports: ReturnType<typeof serverImports>): RemoteKind | undefined {
  const call = unwrap(expression);
  if (call.type !== "CallExpression") return undefined;
  const callee = unwrap(call.callee);
  /** `query` as the function of `$app/server` it names, by an import of it or a member of the namespace. */
  const named = (node: Node): string | undefined => {
    const target = unwrap(node);
    if (target.type === "Identifier") return imports.functions.get(target.name);
    if (target.type === "MemberExpression" && unwrap(target.object).type === "Identifier" && imports.namespaces.has(unwrap(target.object).name)) {
      const name = propertyName(target);
      return name !== undefined && FUNCTIONS.has(name) ? name : undefined;
    }
    return undefined;
  };
  if (callee.type === "MemberExpression") {
    const member = propertyName(callee);
    if ((member === "batch" || member === "live") && named(callee.object) === "query") return member === "batch" ? "query_batch" : "query_live";
  }
  return named(callee) as RemoteKind | undefined;
}

/**
 * The exports of a remote module with their kinds, in source order. Throws `RemoteModuleError` for an export that is not created by a call
 * to one of the remote functions of `$app/server` (SvelteKit rejects the same module at startup: "all exports from this file must be remote
 * functions"), for `default`, and for a re-export, which cannot be followed without running the module.
 */
export function remoteExports(source: string, filename: string): RemoteExport[] {
  const typescript = /\.[cm]?tsx?$/.test(filename);
  let ast: { program: Node };
  try {
    ast = parse(source, { sourceType: "module", plugins: typescript ? ["typescript"] : [] }) as unknown as { program: Node };
  } catch (error) {
    throw new RemoteModuleError(filename, `cannot be parsed: ${error instanceof Error ? error.message : String(error)}`);
  }
  const { program } = ast;
  const imports = serverImports(program);
  const declared = new Map<string, Node>();
  for (const statement of program.body as Node[]) {
    if (statement.type === "VariableDeclaration") for (const declarator of statement.declarations as Node[]) if (declarator.id.type === "Identifier" && declarator.init) declared.set(declarator.id.name, declarator.init);
  }
  const found: RemoteExport[] = [];
  const add = (name: string, expression: Node | undefined, at: Node) => {
    const kind = expression && kindOf(expression, imports);
    if (!kind) throw new RemoteModuleError(filename, `\`${name}\` is exported from a remote module but is not the result of a call to \`query\`, \`query.batch\`, \`query.live\`, \`command\`, \`form\` or \`prerender\` imported from "$app/server". All exports from this file must be remote functions, and Metro finds them in the source, so create them in the export itself (\`export const ${name} = query(...)\`).`, at);
    found.push({ name, kind });
  };
  for (const statement of program.body as Node[]) {
    if (statement.type === "ExportDefaultDeclaration") throw new RemoteModuleError(filename, "Cannot export `default` from a remote module: use named exports instead", statement);
    if (statement.type === "ExportAllDeclaration") {
      if (statement.exportKind === "type") continue;
      throw new RemoteModuleError(filename, "`export *` cannot be used in a remote module: the exports are found in the source of this file", statement);
    }
    if (statement.type !== "ExportNamedDeclaration" || statement.exportKind === "type") continue;
    if (statement.source) throw new RemoteModuleError(filename, "A remote module cannot re-export from another module: the exports are found in the source of this file", statement);
    const declaration = statement.declaration as Node | null | undefined;
    if (declaration) {
      if (declaration.type === "TSTypeAliasDeclaration" || declaration.type === "TSInterfaceDeclaration") continue;
      if (declaration.type !== "VariableDeclaration") throw new RemoteModuleError(filename, `\`${declaration.id?.name ?? "default"}\` exported from a remote module is invalid: all exports from this file must be remote functions`, declaration);
      for (const declarator of declaration.declarations as Node[]) {
        if (declarator.id.type !== "Identifier") throw new RemoteModuleError(filename, "A remote module cannot export a destructured declaration: each export is one remote function", declarator);
        add(declarator.id.name, declarator.init, declarator);
      }
      continue;
    }
    for (const specifier of statement.specifiers as Node[]) {
      if (specifier.exportKind === "type") continue;
      add(exportedName(specifier.exported), declared.get(specifier.local.name), specifier);
    }
  }
  return found;
}

// Copy of `reserved` and `valid_identifier` (`src/core/env.js`): a name that cannot be a `const` is declared under an alias and exported as the name.
const RESERVED = new Set(["do", "if", "in", "for", "let", "new", "try", "var", "case", "else", "enum", "eval", "null", "this", "true", "void", "with", "await", "break", "catch", "class", "const", "false", "super", "throw", "while", "yield", "delete", "export", "import", "public", "return", "static", "switch", "typeof", "default", "extends", "finally", "package", "private", "continue", "debugger", "function", "arguments", "interface", "protected", "implements", "instanceof"]);
const VALID_IDENTIFIER = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/;

/**
 * The client module of a remote module: what SvelteKit's plugin generates (`create_exported_declarations`, same naming of the namespace and of
 * the aliases), with the native runtime in place of SvelteKit's `client/remote-functions/index.js`.
 */
export function remoteStub(exports: readonly RemoteExport[], moduleHash: string): string {
  const names = new Set(exports.map((entry) => entry.name));
  let namespace = "__remote";
  for (let index = 0; names.has(namespace); index++) namespace = `__remote${index}`;
  let alias = 0;
  const declarations: string[] = [];
  const reexports: string[] = [];
  for (const { name, kind } of exports) {
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
  return `import * as ${namespace} from ${JSON.stringify(REMOTE_RUNTIME)};\n\n${declarations.join("\n")}${reexports.length > 0 ? `\nexport { ${reexports.join(", ")} };` : ""}\n`;
}

/** `src` of a remote module as the client stub Metro bundles in its place. `root` is the SvelteKit (Vite) project root: the Metro project root. */
export function transformRemoteModule(source: string, filename: string, root: string): string {
  return remoteStub(remoteExports(source, filename), remoteHash(filename, root));
}

/**
 * Globals SvelteKit's client files use and React Native does not have, or has with other behavior. A file listed here imports them from
 * `REMOTE_GLOBALS` (an import at the end of the file, so no line moves), which makes them module-scoped names: nothing is installed on the
 * global object. `fetch` gets the configured host, the `Origin` header SvelteKit's CSRF check asks for and a streaming body; `location`,
 * `navigator` and `window` are the native router's URL, "always online" and the app's foreground/background; `Blob` takes `Uint8Array` parts;
 * `FinalizationRegistry` is the engine's made releasable by hand, or a stand-in where the engine has none (Hermes 0.17); `WeakRef`, `btoa` and `atob`
 * are the engine's when it has them; `__SVELTEKIT_DEV__` is the build-time constant Vite defines for a browser app.
 */
const SHADOWS: ReadonlyArray<{ pattern: RegExp; names: readonly string[] }> = [
  { pattern: /\/node_modules\/@sveltejs\/kit\/src\/runtime\/client\/remote-functions\//, names: ["fetch", "location", "navigator", "window", "FinalizationRegistry", "WeakRef", "__SVELTEKIT_DEV__"] },
  { pattern: /\/node_modules\/@sveltejs\/kit\/src\/runtime\/form-utils\.js$/, names: ["Blob", "File"] },
  { pattern: /\/node_modules\/@sveltejs\/kit\/src\/runtime\/utils\.js$/, names: ["btoa", "atob"] },
];

/** The statement that gives `filename` (a SvelteKit client file) its shadowed globals, or `undefined` for a file that has none. */
export function kitGlobalsImport(filename: string): string | undefined {
  const path = posix(filename);
  const shadow = SHADOWS.find(({ pattern }) => pattern.test(path));
  return shadow && `\nimport { ${shadow.names.join(", ")} } from ${JSON.stringify(REMOTE_GLOBALS)};\n`;
}

const shim = (name: string) => join(sourceDirectory, "remote/shims", name);

/**
 * Where the SvelteKit client files this package reuses find what a browser app gives them, as an absolute path, or `undefined` when
 * `specifier` is not one of them. `origin` is the file that imports it.
 *
 * - `@sveltejs/kit/src/…`: the package's own files, which its `exports` map keeps closed; `@sveltejs/kit/internal` (`HttpError`, `Redirect`) and
 *   the `#internal` and `#app/internal/transport` import-map entries it uses, resolved without depending on the bundler's export conditions.
 * - From inside SvelteKit: `#app/paths` (`base`, `app_dir`), `#app/state/client` (`page`, `navigating`), `$app/env` (`version`) and the router
 *   client (`client/client.js`: the query caches, `goto`, `refreshAll`) are replaced by `shims/`.
 */
export function remoteResolution(specifier: string, origin: string): string | undefined {
  // The runtime's own imports: a native-only app that never imports `@alfayez/svelte-native/remote` has no SvelteKit and never gets here.
  if (specifier.startsWith("@sveltejs/kit/src/")) return join(kitRoot(), specifier.slice("@sveltejs/kit/".length));
  if (specifier === "@sveltejs/kit/internal") return join(kitRoot(), "src/exports/internal/index.js");
  // Every other module of every app passes through here; without SvelteKit none of them is one of its files.
  const kit = findKitRoot();
  if (kit === null) return undefined;
  const inside = posix(origin).startsWith(`${posix(kit)}/`);
  if (!inside) return undefined;
  switch (specifier) {
    case "#internal": return join(kit, "src/exports/internal/client.js");
    case "#app/internal/transport": return join(kit, "src/runtime/app/internal/transport.js");
    case "#app/paths": return shim("paths.ts");
    case "#app/state/client": return shim("state.ts");
    case "$app/env": return shim("env.ts");
  }
  if (specifier.startsWith(".") && resolve(dirname(origin), specifier) === join(kit, "src/runtime/client/client.js")) return shim("client.ts");
  return undefined;
}
