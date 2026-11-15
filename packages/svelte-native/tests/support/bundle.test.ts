import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { baseStubs, bundle, evaluate, load, src } from "./bundle.ts";
import { settle } from "./host.ts";
import { fakeHost } from "./fake-host.ts";

const host = fakeHost();
type Counter = { bump: () => number };
const counter = "export let count = 0; export const bump = () => ++count;";

test("a bundle is built once for its options and evaluated afresh for each load, so each load has module state of its own", async () => {
  const options = { entry: counter };
  expect(bundle(options)).toBe(bundle({ ...options }));
  expect(bundle(options)).not.toBe(bundle({ entry: `${counter} export const another = 1;` }));
  const first = await load<Counter>(options);
  const second = await load<Counter>(options);
  expect(first.bump()).toBe(1);
  expect(first.bump()).toBe(2);
  expect(second.bump()).toBe(1);
  expect((await evaluate<Counter>((await bundle(options)).code)).bump()).toBe(1);
});

test("another platform, other stubs or another entry are another bundle", async () => {
  const entry = "import Platform from 'react-native/Libraries/Utilities/Platform'; import { marker } from 'react-native'; export { Platform, marker };";
  const stubs = { ...baseStubs("ios"), "react-native": "export const marker = 'stubbed';" };
  const ios = await load<{ Platform: { OS: string }; marker: string }>({ entry, platform: "ios", stubs });
  const android = await load<{ Platform: { OS: string }; marker: string }>({ entry, platform: "android", stubs });
  expect([ios.Platform.OS, android.Platform.OS]).toEqual(["ios", "android"]);
  expect(ios.marker).toBe("stubbed");
  expect(bundle({ entry, platform: "ios", stubs })).not.toBe(bundle({ entry, platform: "android", stubs }));
  expect(bundle({ entry, stubs })).toBe(bundle({ entry, stubs }));
  expect(bundle({ entry, stubs })).not.toBe(bundle({ entry, stubs: { ...stubs, "react-native": "export const marker = 'another';" } }));
});

test("a plugin cannot be part of a key: its bundle is built every time unless it names itself", async () => {
  const plugin = { name: "answer", setup: (builder: import("esbuild").PluginBuild) => { builder.onResolve({ filter: /^answer$/ }, () => ({ path: "answer", namespace: "answer" })); builder.onLoad({ filter: /.*/, namespace: "answer" }, () => ({ contents: "export default 42;", loader: "js" })); } };
  const entry = "import answer from 'answer'; export { answer };";
  expect(bundle({ entry, plugins: [plugin] })).not.toBe(bundle({ entry, plugins: [plugin] }));
  expect(bundle({ entry, plugins: [plugin], cacheKey: "answer" })).toBe(bundle({ entry, plugins: [plugin], cacheKey: "answer" }));
  expect((await load<{ answer: number }>({ entry, plugins: [plugin] })).answer).toBe(42);
});

test("a failed build is not kept", async () => {
  const options = { entry: "import 'a-package-nobody-installed';", esbuild: { logLevel: "silent" as const } };
  await expect(bundle(options)).rejects.toThrow();
  await expect(bundle(options)).rejects.toThrow();
});

test("a Svelte fixture is compiled with the library's options and mounts on the fake binding", async () => {
  const m = await load<{ startSurface: typeof import("../../src/fabric/host.ts").startSurface; tick: () => Promise<void>; Hello: never }>({
    entry: `import Hello from ${JSON.stringify(resolve(import.meta.dirname, "fixtures/hello.svelte"))};
      import { startSurface } from ${JSON.stringify(src("fabric/host.ts"))};
      import { tick } from 'svelte';
      export { startSurface, tick, Hello };`,
  });
  const app = m.startSurface(1, m.Hello, {}) as { rename: (next: string) => void };
  expect(host.nodes(1).filter((node) => node.name === "RCTRawText").map((node) => node.props.text)).toEqual(["Hello world"]);
  app.rename("Ada");
  await settle(m);
  expect(host.nodes(1).filter((node) => node.name === "RCTRawText").map((node) => node.props.text)).toEqual(["Hello Ada"]);
});
