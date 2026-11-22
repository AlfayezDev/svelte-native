import { test, expect, spyOn } from "bun:test";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { Plugin } from "esbuild";
import generate from "@babel/generator";
import { transform } from "../../src/transformer.ts";
import { load, settle, callsOf } from "../gestures/support/harness.ts";

/**
 * The real toolchain: `.svelte` fixtures go through `src/transformer.ts` (Svelte's compile, then Metro's Babel transformer with
 * the worklets plugin), the code that comes out runs in the host bundle, and so does the guards module, transformed too so that
 * its "is the worklets plugin on" probe sees what it sees in an app.
 */
const projectRoot = new URL("../../../../apps/qa", import.meta.url).pathname;
const outputs = new Map<string, string>();

function babelled(): Plugin {
  const run = async (path: string) => {
    const src = await readFile(path, "utf8");
    const output = transform({ filename: path, src, options: { dev: true, platform: "android", projectRoot, minify: false, inlineRequires: false, customTransformOptions: {} } } as never) as { ast: object };
    const code = (generate as unknown as { default?: typeof generate }).default?.(output.ast as never).code ?? (generate as unknown as (ast: object) => { code: string })(output.ast).code;
    outputs.set(path.replace(/.*\//, ""), code);
    // Babel's output is CommonJS; esbuild reads a `.ts` file of this package as ESM, so the module is wrapped and its exports re-exported by name.
    const names = [...new Set([...code.matchAll(/^exports\.(\w+) = /gm)].map((match) => match[1] as string))];
    const wrapped = `const exports = {}; const module = { exports };\n(function (exports, module) {\n${code.replaceAll("$RefreshReg$", "(() => {})")}\n})(exports, module);\n${names.map((name) => name === "default" ? "export default exports.default;" : `export const ${name} = exports.${name};`).join("\n")}`;
    return { contents: wrapped, loader: "js" as const, resolveDir: dirname(path) };
  };
  return {
    name: "babelled",
    setup(builder) {
      builder.onLoad({ filter: /gesture-worklets-[a-z]+\.svelte$/ }, ({ path }) => run(path));
      builder.onLoad({ filter: /src\/gestures\/guards\.ts$/ }, ({ path }) => run(path));
    },
  };
}
const start = (fixture: string, props: Record<string, unknown> = {}) => load({ fixture, fixtures: resolve(import.meta.dirname, "fixtures"), plugins: [babelled()] }).then((m) => ({ m, run: () => m.startSurface(91, m.Fixture, props) }));

test("an inline callback of a Gesture.X().onY(...) chain is workletized, and its closure holds exactly what it captured", async () => {
  const { m, run } = await start("gesture-worklets-ok.svelte");
  const surface = run() as unknown as { pan: { handlers: Record<string, { __workletHash?: number; __closure?: Record<string, unknown> }>; shouldUseReanimated: boolean } };
  await settle(m);
  const { onUpdate, onEnd } = surface.pan.handlers;
  expect(typeof onUpdate?.__workletHash).toBe("number");
  expect(Object.keys(onUpdate?.__closure ?? {})).toEqual(["x"]);
  expect(Object.keys(onEnd?.__closure ?? {})).toEqual(["x"]);
  expect(surface.pan.shouldUseReanimated).toBe(true);
  expect(callsOf("attachGestureHandler")[0]?.[3]).toBe(1);
  expect(outputs.get("gesture-worklets-ok.svelte")).toMatch(/__workletHash/);
});

test("a UI-thread callback that reads $state is refused in development, naming the callback, the variable and the way out", async () => {
  const { run } = await start("gesture-worklets-state.svelte");
  let message = "";
  try { run(); } catch (error) { message = (error as Error).message; }
  expect(outputs.get("gesture-worklets-state.svelte")).toMatch(/__closure = \{\s*\$,\s*count\s*\}/);
  expect(message).toContain("The onEnd callback of Gesture.Pan() runs on the UI thread but reads the state \"count\"");
  expect(message).toContain("SharedValue");
  expect(message).toContain(".runOnJS(true)");
  expect(callsOf("createGestureHandler")).toEqual([]);
});

test("a UI-thread callback that reads a prop is refused too", async () => {
  const { run } = await start("gesture-worklets-props.svelte", { limit: 10 });
  expect(run).toThrow("reads the component's props ($props)");
  expect(outputs.get("gesture-worklets-props.svelte")).toMatch(/__closure = \{\s*\$\$props/);
});

test("with .runOnJS(true) the same read is fine: the callback runs on the JS thread and reads live state", async () => {
  const { m, run } = await start("gesture-worklets-runonjs.svelte");
  run();
  await settle(m);
  expect(callsOf("attachGestureHandler")[0]?.[3]).toBe(4);
});

test("Gesture imported under another name is not workletized: the gesture runs on the JS thread and development says so", async () => {
  const warn = spyOn(console, "warn").mockImplementation(() => {});
  try {
    const { m, run } = await start("gesture-worklets-alias.svelte");
    const surface = run() as unknown as { pan: { handlers: { onUpdate: { __workletHash?: number } } } };
    await settle(m);
    expect(surface.pan.handlers.onUpdate.__workletHash).toBeUndefined();
    expect(callsOf("attachGestureHandler")[0]?.[3]).toBe(4);
    expect(warn.mock.calls.map((call) => String(call[0]))).toEqual([expect.stringContaining("None of the callbacks in Gesture.Pan() are worklets")]);
  } finally {
    warn.mockRestore();
  }
});
