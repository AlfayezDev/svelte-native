import { expect, test } from "bun:test";
import { transformSync } from "esbuild";
import { parseSync } from "@babel/core";
import { parse as parseHermes } from "hermes-parser";
import { compile, compileModule } from "svelte/compiler";
import { existsSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { lowerPrimitives } from "../src/lower.ts";
import { INITIALIZE_CORE, LITE_ORIGINS, RENDERER_STUBS } from "../src/metro.ts";

/**
 * Modules that cost the JavaScript thread before the first commit if anything evaluates them while the bundle loads, and what each
 * costs on the Galaxy A16. They load on first use instead (a `require` inside a function). The test walks what the bundle evaluates
 * at load, as Metro serializes it (no inline requires): every static `import` and `export ... from`, side-effect imports included,
 * and every `require("...")` that is not inside a function, through the package, the platform app's layout and every package they
 * reach (with Metro's substitutions: the lite React Native shim for Expo and Reanimated, the renderer stubs, our `init` for
 * InitializeCore). `import()` and a `require` in a function are lazy.
 */
const forbidden: Record<string, string> = {
  // UIManager.js spreads the bridgeless UIManager into a new object, which reads the constants of every view manager:
  // 16 JNI calls, 21 ms of the JavaScript thread. Keyboard imports LayoutAnimation, which imports UIManager.
  "react-native/Libraries/ReactNative/UIManager.js": "UIManager",
  "react-native/Libraries/LayoutAnimation/LayoutAnimation.js": "LayoutAnimation",
  "react-native/Libraries/Components/Keyboard/Keyboard.js": "Keyboard",
};

const root = resolve(import.meta.dirname, "..");
const platform = resolve(root, "../../apps/example");
const entries = ["src/init.ts", "src/polyfills.ts", "src/fabric/index.ts"].map((file) => join(root, file)).concat(join(platform, "src/routes/+layout.mobile.svelte"));
const lite = join(root, "src/fabric/react-native-lite.ts");
const extensions = [".android.ts", ".android.tsx", ".android.js", ".native.ts", ".native.js", ".ts", ".tsx", ".js", ".jsx", ".svelte", ".json"];
const unwalked = /^(svelte|svelte\/.*|\$app\/.*|\$env\/.*|\$lib\/.*)$/;

type Node = { type: string; [key: string]: unknown };

function file(path: string): string | null {
  for (const candidate of [path, ...extensions.map((extension) => path + extension), ...extensions.map((extension) => join(path, `index${extension}`))]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

function platformImports(importer: string, spec: string): string | null {
  let directory = dirname(importer);
  while (directory !== dirname(directory)) {
    const manifest = join(directory, "package.json");
    if (existsSync(manifest)) {
      const imports = (JSON.parse(readFileSync(manifest, "utf8")) as { imports?: Record<string, string> }).imports;
      if (imports) {
        for (const [pattern, target] of Object.entries(imports)) {
          if (pattern === spec) return file(resolve(directory, target));
          if (pattern.endsWith("/*") && spec.startsWith(pattern.slice(0, -1))) return file(resolve(directory, target.replace("*", spec.slice(pattern.length - 1))));
        }
        return null;
      }
    }
    directory = dirname(directory);
  }
  return null;
}

function resolveSpec(spec: string, importer: string): string | null {
  if (unwalked.test(spec) || spec === "react" || spec.startsWith("react/")) return null;
  if (spec === "react-native" && LITE_ORIGINS.test(importer)) return lite;
  if (spec === "esm-env") return join(root, "src/environment.ts");
  let found: string | null = null;
  if (spec.startsWith(".") || spec.startsWith("/")) found = file(resolve(dirname(importer), spec));
  else if (spec.startsWith("#")) found = platformImports(importer, spec);
  else {
    const requireFrom = createRequire(importer);
    const [scope, name, ...rest] = spec.split("/");
    const packageName = spec.startsWith("@") ? `${scope}/${name}` : scope;
    const deep = spec.startsWith("@") ? rest.join("/") : [name, ...rest].filter(Boolean).join("/");
    try {
      const directory = dirname(requireFrom.resolve(`${packageName}/package.json`));
      found = deep ? file(join(directory, deep)) : null;
      if (!deep) found = requireFrom.resolve(spec);
    } catch {
      try {
        found = requireFrom.resolve(spec);
      } catch {
        found = null;
      }
    }
  }
  if (!found) return null;
  const stub = Object.entries(RENDERER_STUBS).find(([suffix]) => found.endsWith(suffix));
  if (stub) return join(root, "src", stub[1].replace("./", ""));
  if (INITIALIZE_CORE.test(found)) return join(root, "src/init.ts");
  return found;
}

function javascript(path: string): string {
  const source = readFileSync(path, "utf8");
  if (path.endsWith(".svelte")) {
    return compile(lowerPrimitives(source, { filename: path }), { filename: path, dev: false, css: "external", experimental: { customRenderer: "@rasheed/svelte-native/renderer" } }).js.code;
  }
  const code = /\.tsx?$/.test(path) ? transformSync(source, { loader: path.endsWith("x") ? "tsx" : "ts", jsx: "preserve", target: "es2022" }).code : source;
  return /\.svelte\.[jt]s$/.test(path) ? compileModule(code, { filename: path, dev: false, generate: "client" }).js.code : code;
}

function parseProgram(path: string, code: string): Node {
  if (path.includes("/node_modules/") && /\.jsx?$/.test(path)) {
    try {
      return parseHermes(code, { babel: true, sourceType: "unambiguous", flow: "all" }) as unknown as Node;
    } catch {
      // fall through to Babel's parser
    }
  }
  const ast = parseSync(code, { babelrc: false, configFile: false, sourceType: "unambiguous", parserOpts: { plugins: ["jsx", "flow", "flowComments"], errorRecovery: true } });
  if (!ast) throw new Error(`${path}: no AST`);
  return ast as unknown as Node;
}

/** What evaluating the module evaluates next: its static imports and the `require`s outside functions. */
function evaluated(path: string): string[] {
  if (!/\.(svelte|[cm]?[jt]sx?)$/.test(path)) return []; // JSON, fonts and images import nothing
  const specs: string[] = [];
  const visit = (node: unknown, inFunction: boolean) => {
    if (Array.isArray(node)) { for (const child of node) visit(child, inFunction); return; }
    if (!node || typeof node !== "object") return;
    const n = node as Node;
    if (typeof n.type !== "string") return;
    const source = (n.source as Node | undefined)?.value;
    if ((n.type === "ImportDeclaration" || n.type === "ExportNamedDeclaration" || n.type === "ExportAllDeclaration") && typeof source === "string") {
      if (n.importKind !== "type" && n.importKind !== "typeof" && n.exportKind !== "type") specs.push(source);
    }
    if (!inFunction && n.type === "CallExpression") {
      const callee = n.callee as Node;
      const first = (n.arguments as Node[])[0];
      if (callee.type === "Identifier" && callee.name === "require" && first?.type === "StringLiteral" && typeof first.value === "string") specs.push(first.value);
    }
    const nested = inFunction || /Function|ClassMethod|ObjectMethod|ClassPrivateMethod|ClassProperty/.test(n.type);
    for (const key of Object.keys(n)) if (key !== "loc" && key !== "start" && key !== "end" && key !== "extra" && key !== "leadingComments" && key !== "trailingComments") visit(n[key], nested);
  };
  visit(parseProgram(path, javascript(path)), false);
  return specs;
}

function walk(): Map<string, string | null> {
  const parent = new Map<string, string | null>();
  const queue: string[] = [];
  for (const entry of entries) { parent.set(entry, null); queue.push(entry); }
  while (queue.length) {
    const path = queue.shift() as string;
    for (const spec of evaluated(path)) {
      const next = resolveSpec(spec, path);
      if (next && !parent.has(next)) { parent.set(next, path); queue.push(next); }
    }
  }
  return parent;
}

const chain = (graph: Map<string, string | null>, end: string) => {
  const names: string[] = [];
  for (let path: string | null | undefined = end; path; path = graph.get(path)) names.unshift(path.replace(/^.*\/node_modules\//, "").replace(`${resolve(root, "../..")}/`, ""));
  return names.join("\n  -> ");
};

test("the modules the bundle evaluates at load include none that read every view manager", () => {
  const graph = walk();
  expect(graph.size).toBeGreaterThan(150);
  expect([...graph.keys()].some((path) => path.endsWith("src/fabric/host.ts"))).toBe(true);
  expect([...graph.keys()].some((path) => path.endsWith("src/lib/native/state.svelte.ts"))).toBe(true);
  const reached = [...graph.keys()].filter((path) => Object.keys(forbidden).some((suffix) => path.endsWith(`/node_modules/${suffix}`)));
  expect(reached.map((path) => `${forbidden[Object.keys(forbidden).find((suffix) => path.endsWith(suffix)) as string]} is evaluated at load:\n  ${chain(graph, path)}`)).toEqual([]);
});
