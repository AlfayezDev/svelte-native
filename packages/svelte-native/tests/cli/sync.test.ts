import { test, expect, afterEach } from "bun:test";
import { build } from "esbuild";
import { resolve } from "node:path";
import { routeFiles, syncNative } from "../../src/build.ts";
import { routesTableFile } from "../../src/variant.ts";
import { evaluate } from "../support/bundle.ts";
import { createProject } from "../support/project.ts";

const saved = process.env.SVELTE_NATIVE_ROOT;
afterEach(() => {
  if (saved === undefined) delete process.env.SVELTE_NATIVE_ROOT; else process.env.SVELTE_NATIVE_ROOT = saved;
});

/** Syncs a project with this home screen and reads `.svelte-native/entry.ts`, with SVELTE_NATIVE_ROOT as given (unset for `undefined`). */
async function entryFor(root?: string): Promise<string> {
  using project = createProject({ "src/routes/+mobile.svelte": "" });
  if (root === undefined) delete process.env.SVELTE_NATIVE_ROOT; else process.env.SVELTE_NATIVE_ROOT = root;
  await syncNative(project.directory);
  return project.read(".svelte-native/entry.ts");
}

test("the entry boots the app layout as the shell of the generated tree and accepts hot updates", async () => {
  const entry = await entryFor();
  // One import for the boot modules and the host: `/app` runs `init`, then `polyfills`, then loads the Fabric host (the order is pinned in exports.test.ts).
  expect(entry).toContain("import { createFabricApp, remountSurfaces } from '@alfayez/svelte-native/app';");
  for (const folded of ["@alfayez/svelte-native/init", "@alfayez/svelte-native/polyfills", "@alfayez/svelte-native/fabric"]) expect(entry).not.toContain(folded);
  // Then the app's hooks (`.svelte-native/hooks.ts`), before the layout and the routes: the file's top level runs before any of the app's own modules.
  expect(entry.split("\n").filter((line) => line.startsWith("import ")).slice(0, 3)).toEqual([
    "import { createFabricApp, remountSurfaces } from '@alfayez/svelte-native/app';",
    "import './hooks';",
    "import App from '../src/routes/+layout.mobile.svelte';",
  ]);
  expect(entry).toContain("import App from '../src/routes/+layout.mobile.svelte';");
  expect(entry).toContain("import { tree } from './routes';");
  expect(entry).toContain("createFabricApp(App, { tree });");
  expect(entry).toContain("module.hot?.accept(() => remountSurfaces())");
  expect(entry).not.toContain("registerRootComponent");
});

test("SVELTE_NATIVE_ROOT selects a custom root component", async () => {
  const entry = await entryFor("src/lib/Spike.svelte");
  expect(entry).toContain("import { createFabricApp, remountSurfaces } from '@alfayez/svelte-native/app';");
  expect(entry).toContain('import App from "../src/lib/Spike.svelte";');
  expect(entry).toContain("createFabricApp(App, {});");
  expect(entry).toContain("import './hooks';");
});

/** Syncs a project with these files besides a home screen (path under the project to source), and gives `.svelte-native/hooks.ts`. */
async function hooksFor(files: Record<string, string>): Promise<string> {
  using project = createProject({ "src/routes/+mobile.svelte": "", ...files });
  delete process.env.SVELTE_NATIVE_ROOT;
  await syncNative(project.directory);
  return project.read(".svelte-native/hooks.ts");
}

test("the hooks module registers the exports of src/hooks.mobile.ts, .ts before .js, and is empty without one", async () => {
  const registers = (specifier: string) => [
    "import { registerHooks } from '@alfayez/svelte-native/app';",
    `import * as hooks from "${specifier}";`,
    "",
    "registerHooks(hooks);",
  ];
  const lines = (source: string) => source.split("\n").filter((line) => !line.startsWith("//")).slice(0, 4);
  expect(lines(await hooksFor({ "src/hooks.mobile.ts": "export const init = () => {};" }))).toEqual(registers("../src/hooks.mobile"));
  expect(lines(await hooksFor({ "src/hooks.mobile.js": "export const init = () => {};" }))).toEqual(registers("../src/hooks.mobile"));
  expect(await hooksFor({ "src/hooks.mobile.ts": "", "src/hooks.mobile.js": "" })).toContain("(src/hooks.mobile.ts)");
  // SvelteKit's own hooks files are not the app's: only the mobile one is. Without it the module registers none (so a removed file's hooks go).
  const none = await hooksFor({ "src/hooks.client.ts": "export const init = () => {};", "src/hooks.ts": "export const transport = {};" });
  expect(none).not.toContain("import * as hooks");
  expect(lines(none).slice(0, 3)).toEqual(["import { registerHooks } from '@alfayez/svelte-native/app';", "", "registerHooks({});"]);
});

test("the bundled hooks module runs the file's top level after the boot modules and registers what it exports", async () => {
  // The hooks file and the stand-in for the app module log into one `order` module of the bundle, which the entry exports for the test to read.
  using project = createProject({
    "src/routes/+mobile.svelte": "",
    "src/hooks.mobile.ts": "import { order } from 'order';\norder.push('hooks file');\nexport const init = () => { order.push('init'); };\nexport const handleError = () => ({ message: 'x' });\n",
  });
  delete process.env.SVELTE_NATIVE_ROOT;
  await syncNative(project.directory);
  const bundle = await build({
    stdin: { contents: `import './.svelte-native/hooks.ts'; export { order } from 'order';`, resolveDir: project.directory },
    bundle: true, format: "esm", platform: "neutral", write: false,
    plugins: [{
      name: "app",
      setup(builder) {
        builder.onResolve({ filter: /^@alfayez\/svelte-native\/app$/ }, () => ({ path: "app", namespace: "app" }));
        builder.onResolve({ filter: /^order$/ }, () => ({ path: "order", namespace: "order" }));
        builder.onLoad({ filter: /.*/, namespace: "app" }, () => ({
          contents: "import { order } from 'order'; order.push('boot'); export function registerHooks(hooks) { order.push('register ' + Object.keys(hooks).sort().join(',')); hooks.init(); }",
          loader: "js",
        }));
        builder.onLoad({ filter: /.*/, namespace: "order" }, () => ({ contents: "export const order = [];", loader: "js" }));
      },
    }],
  });
  const { order } = await evaluate<{ order: string[] }>(bundle.outputFiles[0].text);
  expect(order).toEqual(["boot", "hooks file", "register handleError,init", "init"]);
});

/** Syncs a project whose `src/routes` holds these files (path to source) and hands the project directory and the route table to `check`. */
async function withRoutes<T>(files: Record<string, string>, check: (directory: string, table: string) => Promise<T>): Promise<T> {
  using project = createProject(Object.fromEntries(Object.entries(files).map(([path, source]) => [`src/routes/${path}`, source])));
  delete process.env.SVELTE_NATIVE_ROOT;
  await syncNative(project.directory, { variant: "qa" });
  return await check(project.directory, project.read(`.svelte-native/${routesTableFile("qa")}`));
}

/** Bundles the route table of a synced project with every page replaced by a module that logs its own evaluation into one `evaluated` module the bundle exports. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the table is a bundle loaded at run time
async function bundledTable(directory: string): Promise<{ tree: any; evaluated: string[] }> {
  const bundle = await build({
    stdin: { contents: `export * from ${JSON.stringify(resolve(directory, ".svelte-native", routesTableFile("qa")))}; export { evaluated } from 'evaluated';`, resolveDir: directory },
    bundle: true, format: "esm", platform: "neutral", write: false,
    plugins: [{
      name: "route-pages",
      setup(builder) {
        builder.onResolve({ filter: /\.svelte$/ }, (args) => ({ path: resolve(args.resolveDir, args.path), namespace: "page" }));
        builder.onResolve({ filter: /^evaluated$/ }, () => ({ path: "evaluated", namespace: "evaluated" }));
        builder.onLoad({ filter: /.*/, namespace: "evaluated" }, () => ({ contents: "export const evaluated = [];", loader: "js" }));
        builder.onLoad({ filter: /.*/, namespace: "page" }, (args) => {
          const name = args.path.slice(args.path.indexOf("src/routes/") + "src/routes/".length);
          return { contents: `import { evaluated } from 'evaluated'; evaluated.push(${JSON.stringify(name)}); export default ${JSON.stringify(`component ${name}`)};`, loader: "js" };
        });
      },
    }],
  });
  return evaluate(bundle.outputFiles[0].text);
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
    const { tree: built, evaluated } = await bundledTable(directory);
    const routes = built.routes as { id: string; presentation: string; load: () => Promise<{ component: string; layouts: string[] }> }[];
    expect(routes).toHaveLength(4);
    expect(evaluated).toEqual([]);
    const route = (id: string) => routes.find((row) => row.id === id);
    expect(await route("a")?.load()).toEqual({ component: "component a/+mobile.svelte", layouts: ["component a/+layout.mobile.svelte"] });
    expect([...evaluated].sort()).toEqual(["a/+layout.mobile.svelte", "a/+mobile.svelte"]);
    expect(await route("")?.load()).toEqual({ component: "component +mobile.svelte", layouts: [] });
    expect(evaluated).toHaveLength(3);
    expect(await route("a")?.load()).toEqual({ component: "component a/+mobile.svelte", layouts: ["component a/+layout.mobile.svelte"] });
    expect(evaluated).toHaveLength(3); // a module evaluates once
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
    const { tree, evaluated } = await bundledTable(directory);
    type Loaded = Promise<{ component: string; layouts: string[] }>;
    type Node = { kind: string; id: string; path: string; layout?: () => Loaded; routes?: Node[]; panes?: { key: string; stack: Node }[]; load?: () => Loaded; presentation?: string };
    expect(evaluated).toEqual([]);
    expect((tree as Node).routes?.map((route) => `${route.kind} ${route.path}`)).toEqual(["page /workspaces", "tabs /[slug]"]);
    const tabs = (tree as Node).routes?.[1];
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

test("a root navigator and a misplaced page fail the sync and name the file", async () => {
  await expect(withRoutes({ "+layout.mobile.svelte": '<script module>export const navigator = "stack";</script>' }, async () => undefined)).rejects.toThrow("+layout.mobile.svelte: the root layout is the app shell and cannot be a navigator");
  await expect(withRoutes({ ...navigators, "(workspace)/[slug]/(tabs)/+mobile.svelte": "" }, async () => undefined)).rejects.toThrow("(workspace)/[slug]/(tabs)/+mobile.svelte: a tabs layout is the screen of its directory");
});

// The build reads `presentation`, `navigator` and `lab` from a route's module script as literals, by one rule: what it cannot read is an error that names the file, never a guess.
// `presentation` and `navigator` fail the sync; `lab` fails the discovery of the routes in every variant, the product's included.
const literals: { name: string; file: string; sources: string[]; message: RegExp; lab?: true }[] = [
  {
    name: "presentation", file: "x/+mobile.svelte", message: /x\/\+mobile\.svelte: export `presentation` as one of the literals/,
    sources: [
      '<script module>export const presentation = cond ? "modal" : "push";</script>',
      '<script module>const value = "modal"; export { value as presentation };</script>',
      '<script module>export const presentation = "popover";</script>',
    ],
  },
  {
    name: "navigator", file: "x/+layout.mobile.svelte", message: /x\/\+layout\.mobile\.svelte: export `navigator` as one of the literals "stack", "tabs"/,
    sources: [
      '<script module>export const navigator = cond ? "tabs" : "stack";</script>',
      '<script module>const value = "tabs"; export { value as navigator };</script>',
      '<script module>export const navigator = "drawer";</script>',
    ],
  },
  {
    name: "lab", file: "x/+mobile.svelte", message: /x\/\+mobile\.svelte: export `lab` as one of the literals true/, lab: true,
    sources: ["<script module>export const lab = process.env.X;</script>", "<script module>export const lab = false;</script>"], // `lab = false` is no marker
  },
];
for (const { name, file, sources, message, lab } of literals) {
  test(`${name} must be a literal the build can read: anything else fails and names the file`, async () => {
    for (const source of sources) {
      if (lab) {
        using project = createProject({ "src/routes/+layout.mobile.svelte": "", [`src/routes/${file}`]: source });
        for (const included of [true, false]) await expect(routeFiles(project.path("src/routes"), { lab: included })).rejects.toThrow(message);
      } else {
        await expect(withRoutes({ "+layout.mobile.svelte": "", [file]: source }, async () => undefined)).rejects.toThrow(message);
      }
    }
  });
}
