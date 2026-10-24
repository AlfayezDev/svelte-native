import { test, expect } from "bun:test";
import { build } from "esbuild";
import { readFile, mkdtemp, writeFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { compile } from "svelte/compiler";
import type { NativeNode } from "../src/renderer.ts";

test("compiled Svelte updates text, moves keyed nodes, removes branches and disposes effects", async () => {
  const bundle = await build({
    stdin: {
      contents: `import Fixture from './fixture.svelte';
        import renderer, {NativeNode} from '../src/renderer.ts';
        import {mount,tick,unmount} from 'svelte';
        export const root = new NativeNode('fragment');
        export const app = mount(Fixture, {target:root,renderer});
        export {tick,unmount};`,
      resolveDir: import.meta.dirname,
    },
    bundle: true,
    format: "esm",
    platform: "neutral",
    conditions: ["browser"],
    write: false,
    plugins: [{
      name: "native-fixture",
      setup(builder) {
        builder.onResolve({ filter: /^@rasheed\/svelte-native\/renderer$/ }, () => ({ path: resolve(import.meta.dirname, "../src/renderer.ts") }));
        builder.onResolve({ filter: /^esm-env$/ }, () => ({ path: resolve(import.meta.dirname, "../src/environment.ts") }));
        builder.onLoad({ filter: /\.svelte$/ }, async ({ path }) => ({
          contents: compile(await readFile(path, "utf8"), { filename: path, css: "external", dev: false, experimental: { customRenderer: "@rasheed/svelte-native/renderer" } }).js.code,
          loader: "js",
        }));
      },
    }],
  });
  const directory = await mkdtemp(resolve(tmpdir(), "svelte-native-test-"));
  const file = resolve(directory, "fixture.mjs");
  await writeFile(file, bundle.outputFiles[0].contents);
  const result = await import(pathToFileURL(file).href);
  await rm(directory, { recursive: true });
  const root: NativeNode = result.root;
  function nodes(node: NativeNode): NativeNode[] { return [node, ...node.getSnapshot().children.flatMap(nodes)]; }
  function tagged(id: string): NativeNode {
    const node = nodes(root).find((node) => node.getSnapshot().props["data-id"] === id);
    if (!node) throw new Error(`Missing fixture node ${id}`);
    return node;
  }
  const a = tagged("a");
  const b = tagged("b");
  const conditional = tagged("conditional");
  result.app.update();
  await result.tick();
  const ordered = nodes(root).filter((node) => ["a", "b"].includes(String(node.getSnapshot().props["data-id"])));
  expect(ordered).toEqual([b, a]);
  expect(conditional.parent).toBeNull();
  expect(tagged("value").getSnapshot().children[0].getSnapshot().text).toBe("second");
  expect(b.getSnapshot().children[0].getSnapshot().text).toBe("Updated");
  const button = nodes(root).find((node) => node.name === "pressable");
  expect(button).toBeDefined();
  for (const handler of button?.listeners.get("press") ?? []) handler({});
  await result.tick();
  expect(tagged("value").getSnapshot().children[0].getSnapshot().text).toBe("pressed");
  await result.unmount(result.app);
  expect(root.getSnapshot().children).toHaveLength(0);
  expect(result.app.cleanups()).toBe(1);
  result.app.update();
  await result.tick();
  expect(root.getSnapshot().children).toHaveLength(0);
});
