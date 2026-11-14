import { expect, test } from "bun:test";
import { build, transform } from "esbuild";
import { readFile, mkdtemp, writeFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { compileModule } from "svelte/compiler";
import type { StackNode } from "../src/route-tree.ts";
import type { PreparedNavigation, NavigateOptions } from "../src/router.svelte.ts";

// Exercise the real reactive store without mounting a Fabric surface. The private store is
// exported only in this test bundle, so disposal can be tested while callers retain handles.
async function load() {
  const bundle = await build({
    stdin: { contents: "import 'svelte/internal/flags/async'; export { createStore } from '../src/router.svelte.ts';", resolveDir: import.meta.dirname },
    bundle: true, format: "esm", platform: "neutral", conditions: ["browser"], write: false,
    plugins: [{ name: "router-store", setup(builder) {
      builder.onResolve({ filter: /^react-native\// }, (args) => ({ path: args.path, namespace: "native" }));
      builder.onLoad({ filter: /.*/, namespace: "native" }, () => ({ contents: "export default { OS: 'android' };" }));
      builder.onResolve({ filter: /^esm-env$/ }, () => ({ path: resolve(import.meta.dirname, "../src/environment.ts") }));
      builder.onLoad({ filter: /\.svelte\.ts$/ }, async ({ path }) => {
        let source = await readFile(path, "utf8");
        if (path.endsWith("/router.svelte.ts")) source += "\nexport { createStore };";
        const { code } = await transform(source, { loader: "ts" });
        return { contents: compileModule(code, { filename: path, experimental: { async: true } }).js.code, loader: "js" };
      });
    } }],
  });
  const directory = await mkdtemp(resolve(tmpdir(), "svelte-native-prepare-"));
  try {
    const file = resolve(directory, "bundle.mjs");
    await writeFile(file, bundle.outputFiles[0]!.contents);
    return await import(pathToFileURL(file).href) as { createStore(tree: StackNode): {
      start(href: string): void;
      snapshot(): { entries: { href: string; presentation: string }[] };
      navigate(href: string, navigation: NavigateOptions): void;
      root: { entries: { key: number }[] };
      prepare(href: string, navigation?: NavigateOptions): PreparedNavigation;
      dispose(): void;
    } };
  } finally { await rm(directory, { recursive: true }); }
}

const tree = (): StackNode => ({ kind: "stack", id: "root", path: "/", routes: ["/", "/a", "/b"].map((path) => ({
  kind: "page", id: path, path, presentation: "push", load: async () => ({ component: (() => {}) as never, layouts: [] }),
})) });

test("disposing makes both current and superseded prepare handles inert", async () => {
  const { createStore } = await load();
  const store = createStore(tree());
  store.start("/");
  const older = store.prepare("/a");
  const newer = store.prepare("/b");
  store.dispose();
  const before = store.snapshot();
  older.commit();
  newer.commit();
  expect(await older.ready).toBe(false);
  expect(await newer.ready).toBe(false);
  expect(store.snapshot()).toEqual(before);
});

test("preparing after disposal is inert and does not even load modules", async () => {
  const { createStore } = await load();
  const routes = tree();
  let loads = 0;
  for (const page of routes.routes) if (page.kind === "page") page.load = async () => { loads++; return { component: (() => {}) as never, layouts: [] }; };
  const store = createStore(routes);
  store.start("/");
  store.dispose();
  const before = store.snapshot();
  const prepared = store.prepare("/a");
  expect(await prepared.ready).toBe(false);
  prepared.commit();
  prepared.discard();
  expect(loads).toBe(0);
  expect(store.snapshot()).toEqual(before);
});

test("a superseded handle still falls back to normal navigation while alive", async () => {
  const { createStore } = await load();
  const store = createStore(tree());
  store.start("/");
  const older = store.prepare("/a");
  store.prepare("/b");
  expect(await older.ready).toBe(false);
  older.commit();
  expect(store.snapshot().entries.map((entry) => entry.href)).toEqual(["/", "/a"]);
  store.dispose();
});

test("disposing discards a ready fork and repeated commits remain inert", async () => {
  const { createStore } = await load();
  const store = createStore(tree());
  store.start("/");
  const prepared = store.prepare("/a");
  expect(await prepared.ready).toBe(true);
  const before = store.snapshot();
  store.dispose();
  prepared.commit();
  prepared.commit();
  prepared.discard();
  expect(store.snapshot()).toEqual(before);
});


test("query-only navigation stays in place, while reset makes a fresh root", async () => {
  const { createStore } = await load();
  const store = createStore(tree());
  store.start("/a?mode=menu");
  const key = store.root.entries[0]!.key;
  store.navigate("/a?mode=header#details", {});
  expect(store.root.entries.map(entry => entry.key)).toEqual([key]);
  expect(store.snapshot().entries.map(entry => entry.href)).toEqual(["/a?mode=header#details"]);
  const prepared = store.prepare("/a?mode=toolbar");
  expect(await prepared.ready).toBe(false);
  prepared.commit();
  expect(store.root.entries.map(entry => entry.key)).toEqual([key]);
  store.navigate("/a?mode=menu", { reset: true });
  expect(store.root.entries).toHaveLength(1);
  expect(store.root.entries[0]!.key).not.toBe(key);
  store.dispose();
});

for (const presentation of ["push", "modal", "transparentModal", "sheet", "formSheet"] as const) {
  for (const how of ["navigate", "prepare"] as const) {
    test(`${how} honors explicit ${presentation} for the current page with another query`, async () => {
      const { createStore } = await load();
      const store = createStore(tree());
      store.start("/a?mode=menu");
      if (how === "navigate") store.navigate("/a?mode=presented", { presentation });
      else {
        const prepared = store.prepare("/a?mode=presented", { presentation });
        expect(await prepared.ready).toBe(true);
        expect(store.snapshot().entries).toHaveLength(1);
        prepared.commit();
        await new Promise(resolve => setTimeout(resolve, 0));
      }
      expect(store.snapshot().entries.map(entry => [entry.href, entry.presentation])).toEqual([
        ["/a?mode=menu", "push"], ["/a?mode=presented", presentation],
      ]);
      store.dispose();
    });
  }
}
