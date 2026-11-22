import { expect, test } from "bun:test";
import type { Plugin } from "esbuild";
import { readFile } from "node:fs/promises";
import { transform } from "esbuild";
import { compileModule } from "svelte/compiler";
import type { StackNode } from "../../src/route-tree.ts";
import type { PreparedNavigation, NavigateOptions } from "../../src/router.svelte.ts";
import { src } from "../support/bundle.ts";
import { loadRouter } from "../support/router.ts";

// Exercise the real reactive store without mounting a Fabric surface. The private store is
// exported only in this test bundle, so disposal can be tested while callers retain handles.
const exportStore: Plugin = {
  name: "router-store",
  setup(builder) {
    builder.onLoad({ filter: /\.svelte\.ts$/ }, async ({ path }) => {
      let source = await readFile(path, "utf8");
      if (path.endsWith("/router.svelte.ts")) source += "\nexport { createStore };";
      const { code } = await transform(source, { loader: "ts" });
      return { contents: compileModule(code, { filename: path, experimental: { async: true } }).js.code, loader: "js" };
    });
  },
};

type Store = {
  start(href: string): void;
  snapshot(): { entries: { href: string; presentation: string }[] };
  navigate(href: string, navigation: NavigateOptions): void;
  root: { entries: { key: number }[] };
  prepare(href: string, navigation?: NavigateOptions): PreparedNavigation;
  dispose(): void;
};
const load = () => loadRouter<{ createStore(tree: StackNode): Store }>(`import 'svelte/internal/flags/async'; export { createStore } from ${JSON.stringify(src("router.svelte.ts"))};`, { plugins: [exportStore], cacheKey: "prepare-lifecycle" });

const tree = (): StackNode => ({ kind: "stack", id: "root", path: "/", routes: ["/", "/a", "/b"].map((path) => ({
  kind: "page", id: path, path, presentation: "push", load: async () => ({ component: (() => {}) as never, layouts: [] }),
})) });

test("disposing makes every prepare handle inert: the current one, a superseded one, and a ready fork that is committed twice", async () => {
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

  const ready = createStore(tree());
  ready.start("/");
  const prepared = ready.prepare("/a");
  expect(await prepared.ready).toBe(true);
  const kept = ready.snapshot();
  ready.dispose();
  prepared.commit();
  prepared.commit();
  prepared.discard();
  expect(ready.snapshot()).toEqual(kept);
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
