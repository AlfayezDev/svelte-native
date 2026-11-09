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
        builder.onResolve({ filter: /^@example\/svelte-native\/renderer$/ }, () => ({ path: resolve(import.meta.dirname, "../src/renderer.ts") }));
        builder.onResolve({ filter: /^esm-env$/ }, () => ({ path: resolve(import.meta.dirname, "../src/environment.ts") }));
        builder.onLoad({ filter: /\.svelte$/ }, async ({ path }) => ({
          contents: compile(await readFile(path, "utf8"), { filename: path, css: "external", dev: false, experimental: { customRenderer: "@example/svelte-native/renderer" } }).js.code,
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
  const styled = nodes(root).find((node) => node.name === "native-view");
  if (!styled) throw new Error("Missing styled fixture view");
  const beforeStyle = styled.getSnapshot();
  result.app.redrawStyle();
  await result.tick();
  expect(styled.getSnapshot()).toBe(beforeStyle);
  result.app.moveStyle();
  await result.tick();
  expect(styled.getSnapshot().props.nativeProps).toEqual({ testID: "styled", style: { opacity: 1, transform: [{ translateX: 40 }] } });
  expect(beforeStyle.props.nativeProps).toEqual({ testID: "styled", style: { opacity: 1, transform: [{ translateX: 0 }] } });
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
  result.app.removeRows();
  await result.tick();
  expect(a.parent).toBeNull();
  expect(b.parent).toBeNull();
  await result.unmount(result.app);
  expect(root.getSnapshot().children).toHaveLength(0);
  expect(result.app.cleanups()).toBe(1);
  result.app.redrawStyle();
  await result.tick();
  expect(root.getSnapshot().children).toHaveLength(0);
});

test("attribute writes between snapshots change one object, and a snapshot keeps what it saw", async () => {
  const { NativeNode } = await import("../src/renderer.ts");
  const reports: string[] = [];
  const { setInvalidationSink } = await import("../src/renderer.ts");
  setInvalidationSink((_node, reason) => { reports.push(reason); });
  try {
    const node = new NativeNode("element", "native-view");
    node.setProp("a", 1);
    node.setProp("b", 2);
    const first = node.peekProps();
    node.setProp("c", 3);
    expect(node.peekProps()).toBe(first); // no snapshot went out: the same object took both writes
    expect(first).toEqual({ a: 1, b: 2, c: 3 });

    const snapshot = node.getSnapshot();
    node.setProp("a", 9);
    expect(snapshot.props).toEqual({ a: 1, b: 2, c: 3 }); // the snapshot kept its object
    expect(node.getProp("a")).toBe(9);
    expect(node.getSnapshot()).not.toBe(snapshot);
    node.removeProp("b");
    expect(node.hasProp("b")).toBe(false);
    expect(node.getSnapshot().props).toEqual({ a: 9, c: 3 });

    reports.length = 0;
    node.setProp("a", 9); // unchanged
    node.removeProp("missing");
    expect(reports).toEqual([]);
    node.setProp("a", 10);
    node.removeProp("a");
    expect(reports).toEqual(["props", "props"]);

    const whole = { x: 1 };
    node.setProps(whole);
    node.setProp("y", 2);
    expect(whole).toEqual({ x: 1 }); // an object handed in is never written to
    expect(node.getSnapshot().props).toEqual({ x: 1, y: 2 });
  } finally {
    setInvalidationSink(null);
  }
});
