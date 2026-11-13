import { test, expect, afterEach } from "bun:test";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { syncNative } from "../src/build.ts";
import { routesTableFile } from "../src/variant.ts";

const saved = process.env.SVELTE_NATIVE_ROOT;
afterEach(() => {
  if (saved === undefined) delete process.env.SVELTE_NATIVE_ROOT; else process.env.SVELTE_NATIVE_ROOT = saved;
});

async function entryFor(root?: string): Promise<string> {
  const directory = await mkdtemp(resolve(tmpdir(), "svelte-native-entry-"));
  try {
    await mkdir(resolve(directory, "src/routes"), { recursive: true });
    await writeFile(resolve(directory, "src/routes/+mobile.svelte"), "");
    if (root === undefined) delete process.env.SVELTE_NATIVE_ROOT; else process.env.SVELTE_NATIVE_ROOT = root;
    await syncNative(directory);
    return await readFile(resolve(directory, ".svelte-native/entry.ts"), "utf8");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("the entry boots the app layout as the shell of the generated tree and accepts hot updates", async () => {
  const entry = await entryFor();
  expect(entry).toContain("import '@alfayez/svelte-native/init';");
  expect(entry).toContain("import App from '../src/routes/+layout.mobile.svelte';");
  expect(entry).toContain("import { tree } from './routes';");
  expect(entry).toContain("createFabricApp(App, { tree });");
  expect(entry).toContain("module.hot?.accept(() => remountSurfaces())");
  expect(entry).not.toContain("registerRootComponent");
});

test("SVELTE_NATIVE_ROOT selects a custom root component", async () => {
  const entry = await entryFor("src/lib/Spike.svelte");
  expect(entry).toContain('import App from "../src/lib/Spike.svelte";');
  expect(entry).toContain("createFabricApp(App, {});");
});

/** Syncs a project whose `src/routes` holds these files (path to source) and hands the project directory and the route table to `check`. */
async function withRoutes<T>(files: Record<string, string>, check: (directory: string, table: string) => Promise<T>): Promise<T> {
  const directory = await mkdtemp(resolve(tmpdir(), "svelte-native-routes-"));
  try {
    for (const [path, source] of Object.entries(files)) {
      await mkdir(resolve(directory, "src/routes", path, ".."), { recursive: true });
      await writeFile(resolve(directory, "src/routes", path), source);
    }
    delete process.env.SVELTE_NATIVE_ROOT;
    await syncNative(directory, { variant: "qa" });
    return await check(directory, await readFile(resolve(directory, ".svelte-native", routesTableFile("qa")), "utf8"));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

const tree = {
  "+mobile.svelte": "",
  "a/+layout.mobile.svelte": "",
  "a/+mobile.svelte": '<script module lang="ts">export const presentation = "modal";</script><p>a</p>',
  "(group)/b/[id]/+mobile.svelte": "<script lang=\"ts\">export const presentation = \"modal\";</script>",
  "a/[...rest]/+mobile.svelte": "<script context=\"module\">export const presentation = 'push';</script>",
};

test("the route table loads no page up front: every route is a loader", async () => {
  await withRoutes(tree, async (_directory, table) => {
    expect(table).not.toMatch(/^import (?!type)/m);
    expect(table).not.toContain("import * as");
    expect(table).toContain("import type { StackNode } from '@alfayez/svelte-native/router';");
    expect(table).toContain("export const tree: StackNode = {");
    expect([...table.matchAll(/kind: "page", id: "([^"]*)", path: "([^"]*)"/g)].map((match) => `${match[1]} ${match[2]}`).sort()).toEqual([
      " /", "(group)/b/[id] /b/[id]", "a /a", "a/[...rest] /a/[...rest]",
    ]);
    expect([...table.matchAll(/load: async/g)]).toHaveLength(4);
    expect(table).toContain('load: async () => ({ component: require("../src/routes/a/+mobile.svelte").default, layouts: [require("../src/routes/a/+layout.mobile.svelte").default] }),');
    expect(table).not.toContain("import("); // a require keeps the page in the entry's module graph, so a hot update of it reaches the entry's accept handler
    expect(table.indexOf('kind: "page", id: ""')).toBeGreaterThan(table.indexOf('kind: "page", id: "a"')); // static routes still precede the root and parameter routes' order is unchanged
  });
});

test("a loader requires its page and layouts when called and not before", async () => {
  await withRoutes(tree, async (directory) => {
    const bundle = await build({
      entryPoints: [resolve(directory, ".svelte-native", routesTableFile("qa"))],
      bundle: true, format: "esm", platform: "neutral", write: false,
      plugins: [{
        name: "route-pages",
        setup(builder) {
          builder.onResolve({ filter: /\.svelte$/ }, (args) => ({ path: resolve(args.resolveDir, args.path), namespace: "page" }));
          builder.onLoad({ filter: /.*/, namespace: "page" }, (args) => {
            const name = args.path.slice(args.path.indexOf("src/routes/") + "src/routes/".length);
            return { contents: `(globalThis.__evaluatedPages ??= []).push(${JSON.stringify(name)}); export default ${JSON.stringify(`component ${name}`)};`, loader: "js" };
          });
        },
      }],
    });
    const file = resolve(directory, "routes.mjs");
    await writeFile(file, bundle.outputFiles[0].contents);
    const evaluated = () => (globalThis as { __evaluatedPages?: string[] }).__evaluatedPages ?? [];
    delete (globalThis as { __evaluatedPages?: string[] }).__evaluatedPages;
    const { tree } = await import(pathToFileURL(file).href) as { tree: { routes: { id: string; presentation: string; load: () => Promise<{ component: string; layouts: string[] }> }[] } };
    const { routes } = tree;
    expect(routes).toHaveLength(4);
    expect(evaluated()).toEqual([]);
    const route = (id: string) => routes.find((row) => row.id === id);
    expect(await route("a")?.load()).toEqual({ component: "component a/+mobile.svelte", layouts: ["component a/+layout.mobile.svelte"] });
    expect(evaluated().sort()).toEqual(["a/+layout.mobile.svelte", "a/+mobile.svelte"]);
    expect(await route("")?.load()).toEqual({ component: "component +mobile.svelte", layouts: [] });
    expect(evaluated()).toHaveLength(3);
    expect(await route("a")?.load()).toEqual({ component: "component a/+mobile.svelte", layouts: ["component a/+layout.mobile.svelte"] });
    expect(evaluated()).toHaveLength(3); // a module evaluates once
    expect(await route("a/[...rest]")?.load()).toEqual({ component: "component a/[...rest]/+mobile.svelte", layouts: ["component a/+layout.mobile.svelte"] });
    expect(Object.fromEntries(routes.map((row) => [row.id, row.presentation]))).toEqual({ "": "push", "(group)/b/[id]": "push", a: "modal", "a/[...rest]": "push" });
  });
});

test("presentation is read from the page's module script without loading the page", async () => {
  await withRoutes({
    "modal/+mobile.svelte": '<script module lang="ts">\n  export const presentation = "modal";\n</script>',
    "legacy/+mobile.svelte": "<script context=\"module\">export const presentation = 'modal';</script>",
    "instance/+mobile.svelte": '<script lang="ts">export const presentation = "modal";</script>',
    "plain/+mobile.svelte": "<script module>export const other = 1;</script>",
  }, async (_directory, table) => {
    const presentations = Object.fromEntries([...table.matchAll(/kind: "page", id: "([^"]*)", path: "[^"]*", presentation: "([^"]*)"/g)].map((match) => [match[1], match[2]]));
    expect(presentations).toEqual({ modal: "modal", legacy: "modal", instance: "push", plain: "push" });
  });
});

test("a presentation the build cannot read as a literal fails the sync and names the page", async () => {
  for (const source of [
    '<script module>export const presentation = cond ? "modal" : "push";</script>',
    '<script module>const value = "modal"; export { value as presentation };</script>',
    '<script module>export const presentation = "popover";</script>',
  ]) {
    await expect(withRoutes({ "x/+mobile.svelte": source }, async () => undefined)).rejects.toThrow(/x\/\+mobile\.svelte: export `presentation` as one of the literals/);
  }
});

const navigators = {
  "+layout.mobile.svelte": "",
  "(workspace)/+layout.mobile.svelte": "",
  "(workspace)/[slug]/(tabs)/+layout.mobile.svelte": '<script lang="ts" module>export const navigator = "tabs";</script>',
  "(workspace)/[slug]/(tabs)/home/+mobile.svelte": "",
  "(workspace)/[slug]/(tabs)/inbox/+layout.mobile.svelte": "<script module>export const navigator = 'stack';</script>",
  "(workspace)/[slug]/(tabs)/inbox/+mobile.svelte": "",
  "(workspace)/[slug]/(tabs)/inbox/compose/+mobile.svelte": '<script module>export const presentation = "sheet";</script>',
  "workspaces/+mobile.svelte": "",
};

test("navigator layouts and panes are in the table with a loader per layout; nothing loads until it is called", async () => {
  await withRoutes(navigators, async (directory, table) => {
    expect(table).not.toMatch(/^import (?!type)/m);
    expect(table).toContain('kind: "tabs", id: "(workspace)/[slug]/(tabs)", path: "/[slug]",');
    expect(table).toContain('layoutFile: "(workspace)/[slug]/(tabs)/+layout.mobile.svelte", layouts: ["(workspace)/+layout.mobile.svelte"],');
    expect(table).toContain('layout: async () => ({ component: require("../src/routes/(workspace)/[slug]/(tabs)/+layout.mobile.svelte").default, layouts: [require("../src/routes/(workspace)/+layout.mobile.svelte").default] }),');
    expect(table).toContain('shellFile: "+layout.mobile.svelte",');
    const bundle = await build({
      entryPoints: [resolve(directory, ".svelte-native", routesTableFile("qa"))],
      bundle: true, format: "esm", platform: "neutral", write: false,
      plugins: [{
        name: "route-pages",
        setup(builder) {
          builder.onResolve({ filter: /\.svelte$/ }, (args) => ({ path: resolve(args.resolveDir, args.path), namespace: "page" }));
          builder.onLoad({ filter: /.*/, namespace: "page" }, (args) => {
            const name = args.path.slice(args.path.indexOf("src/routes/") + "src/routes/".length);
            return { contents: `(globalThis.__evaluatedLayouts ??= []).push(${JSON.stringify(name)}); export default ${JSON.stringify(`component ${name}`)};`, loader: "js" };
          });
        },
      }],
    });
    const file = resolve(directory, "routes.mjs");
    await writeFile(file, bundle.outputFiles[0].contents);
    delete (globalThis as { __evaluatedLayouts?: string[] }).__evaluatedLayouts;
    type Loaded = Promise<{ component: string; layouts: string[] }>;
    type Node = { kind: string; id: string; path: string; layout?: () => Loaded; routes?: Node[]; panes?: { key: string; stack: Node }[]; load?: () => Loaded; presentation?: string };
    const { tree } = await import(pathToFileURL(file).href) as { tree: Node };
    expect((globalThis as { __evaluatedLayouts?: string[] }).__evaluatedLayouts).toBeUndefined();
    expect(tree.routes?.map((route) => `${route.kind} ${route.path}`)).toEqual(["page /workspaces", "tabs /[slug]"]);
    const tabs = tree.routes?.[1];
    expect(tabs?.panes?.map((pane) => `${pane.key} ${pane.stack.path} ${pane.stack.routes?.map((route) => route.path).join(" ")}`)).toEqual([
      "home /[slug]/home /[slug]/home", "inbox /[slug]/inbox /[slug]/inbox/compose /[slug]/inbox",
    ]);
    expect(tabs?.panes?.[0].stack.layout).toBeUndefined(); // a pane without a layout has no loader
    expect(await tabs?.layout?.()).toEqual({ component: "component (workspace)/[slug]/(tabs)/+layout.mobile.svelte", layouts: ["component (workspace)/+layout.mobile.svelte"] });
    expect(await tabs?.panes?.[1].stack.layout?.()).toEqual({ component: "component (workspace)/[slug]/(tabs)/inbox/+layout.mobile.svelte", layouts: [] });
    expect(await tabs?.panes?.[1].stack.routes?.[0].load?.()).toEqual({
      component: "component (workspace)/[slug]/(tabs)/inbox/compose/+mobile.svelte", layouts: ["component (workspace)/+layout.mobile.svelte"],
    });
    expect(tabs?.panes?.[1].stack.routes?.[0].presentation).toBe("sheet");
  });
});

test("the table does not depend on the order the file system lists the routes in", async () => {
  const forward = await withRoutes(navigators, async (_directory, table) => table);
  const backward = await withRoutes(Object.fromEntries(Object.entries(navigators).reverse()), async (_directory, table) => table);
  expect(backward).toBe(forward);
});

test("a navigator the build cannot read as a literal, a root navigator and a misplaced page fail the sync and name the file", async () => {
  for (const source of [
    '<script module>export const navigator = cond ? "tabs" : "stack";</script>',
    '<script module>const value = "tabs"; export { value as navigator };</script>',
    '<script module>export const navigator = "drawer";</script>',
  ]) {
    await expect(withRoutes({ "x/+layout.mobile.svelte": source }, async () => undefined)).rejects.toThrow(/x\/\+layout\.mobile\.svelte: export `navigator` as one of the literals "stack", "tabs"/);
  }
  await expect(withRoutes({ "+layout.mobile.svelte": '<script module>export const navigator = "stack";</script>' }, async () => undefined)).rejects.toThrow("+layout.mobile.svelte: the root layout is the app shell and cannot be a navigator");
  await expect(withRoutes({ ...navigators, "(workspace)/[slug]/(tabs)/+mobile.svelte": "" }, async () => undefined)).rejects.toThrow("(workspace)/[slug]/(tabs)/+mobile.svelte: a tabs layout is the screen of its directory");
});
