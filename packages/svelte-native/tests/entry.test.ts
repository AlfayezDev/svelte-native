import { test, expect, afterEach } from "bun:test";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { syncNative } from "../src/build.ts";

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

test("the entry boots the app layout with the generated routes and accepts hot updates", async () => {
  const entry = await entryFor();
  expect(entry).toContain("import '@rasheed/svelte-native/init';");
  expect(entry).toContain("import App from '../src/routes/+layout.mobile.svelte';");
  expect(entry).toContain("import { routes } from './routes';");
  expect(entry).toContain("createFabricApp(App, { routes });");
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
    await syncNative(directory);
    return await check(directory, await readFile(resolve(directory, ".svelte-native/routes.ts"), "utf8"));
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
    expect(table).toContain("import type { NativeRoute } from '@rasheed/svelte-native/router';");
    expect(table).toContain("export const routes: NativeRoute[] = [");
    expect([...table.matchAll(/id: "([^"]*)", path: "([^"]*)"/g)].map((match) => `${match[1]} ${match[2]}`).sort()).toEqual([
      " /", "(group)/b/[id] /b/[id]", "a /a", "a/[...rest] /a/[...rest]",
    ]);
    expect([...table.matchAll(/load: async/g)]).toHaveLength(4);
    expect(table).toContain('load: async () => ({ component: require("../src/routes/a/+mobile.svelte").default, layouts: [require("../src/routes/a/+layout.mobile.svelte").default] }),');
    expect(table).not.toContain("import("); // a require keeps the page in the entry's module graph, so a hot update of it reaches the entry's accept handler
    expect(table.indexOf('id: ""')).toBeGreaterThan(table.indexOf('id: "a"')); // static routes still precede the root and parameter routes' order is unchanged
  });
});

test("a loader requires its page and layouts when called and not before", async () => {
  await withRoutes(tree, async (directory) => {
    const bundle = await build({
      entryPoints: [resolve(directory, ".svelte-native/routes.ts")],
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
    const { routes } = await import(pathToFileURL(file).href) as { routes: { id: string; presentation: string; load: () => Promise<{ component: string; layouts: string[] }> }[] };
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
    const presentations = Object.fromEntries([...table.matchAll(/id: "([^"]*)", path: "[^"]*", presentation: "([^"]*)"/g)].map((match) => [match[1], match[2]]));
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
