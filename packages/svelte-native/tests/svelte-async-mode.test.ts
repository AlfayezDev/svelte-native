import { expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { compile } from "svelte/compiler";
import { ASYNC_ENVIRONMENT_VARIABLE, componentOptions, moduleOptions } from "../src/compile-options.ts";

/**
 * Native bundles are compiled without Svelte's async mode (`experimental.async`) unless the app asks for it (`withSvelteNative(config, { async: true })`, which sets `SVELTE_NATIVE_ASYNC`
 * for the transformer: `async-option.test.ts`), and the lab's busy-JavaScript checks depend on it (`foreign-libraries-checks.ts`, `loadsWhileBusy`): they set a
 * prop, `await tick()` and hold the JavaScript thread in the same task, which commits the prop first only because `tick()` is `await Promise.resolve(); flushSync()`. With the flag on, `tick()`
 * waits for `requestAnimationFrame` or a timer instead, a turn of the event loop in which the load's events could be delivered before the hold. The web build does turn the flag on
 * (`apps/qa/vite.config.ts`, `kit.compilerOptions`), so this pins that the native path does not by default: the Metro transformer's compile options, what the Vite plugin forwards, and Svelte's runtime.
 */
const root = resolve(import.meta.dirname, "../../..");
// The Svelte copy the native bundle uses: Metro resolves every `svelte` import to the one next to the package (`metro.ts`, `nativeSvelte`).
const svelte = dirname(createRequire(import.meta.url).resolve("svelte/package.json"));
const read = (...path: string[]): string => readFileSync(join(root, ...path), "utf8");

function sources(directory: string, found: string[] = []): string[] {
  for (const name of readdirSync(directory)) {
    const path = join(directory, name);
    if (name === "node_modules" || name === "build" || name.startsWith(".")) continue;
    if (statSync(path).isDirectory()) sources(path, found);
    else if (/\.(ts|js|cjs|mjs|svelte)$/.test(name)) found.push(path);
  }
  return found;
}

test("the Metro transformer compiles components and modules without Svelte's async mode, unless the app asks for it", () => {
  // The transformer takes its options from `componentOptions` and `moduleOptions` (`compile-options.ts`) and nowhere else.
  const transformer = read("packages/svelte-native/src/transformer.ts");
  expect(transformer).toContain("compile(lowerPrimitives(src, { filename, html: lowersHtml(filename) }), componentOptions(filename))");
  expect(transformer).toContain("compileModule(code, moduleOptions(filename))");
  // Without the app's setting (the environment variable `withSvelteNative(config, { async })` sets) there is no async option for either.
  const saved = process.env[ASYNC_ENVIRONMENT_VARIABLE];
  delete process.env[ASYNC_ENVIRONMENT_VARIABLE];
  try {
    const options = componentOptions("/app/src/Probe.svelte");
    expect(options.experimental).toEqual({ customRenderer: "@example/svelte-native/renderer" });
    expect(moduleOptions("/app/src/probe.svelte.ts")).toEqual({ filename: "/app/src/probe.svelte.ts", dev: false, generate: "client" });
    // With those options a component imports no flag module; with `async: true` added (the probe's control, and what the app's setting does) it does, so the assertion can fail.
    const probe = "<script>let { a } = $props();</script><native-view>{a}</native-view>";
    expect(compile(probe, options).js.code).not.toContain("svelte/internal/flags/async");
    expect(compile(probe, { ...options, experimental: { ...options.experimental, async: true } }).js.code).toContain("svelte/internal/flags/async");
    process.env[ASYNC_ENVIRONMENT_VARIABLE] = "1";
    expect(compile(probe, componentOptions("/app/src/Probe.svelte")).js.code).toContain("svelte/internal/flags/async");
  } finally {
    if (saved === undefined) delete process.env[ASYNC_ENVIRONMENT_VARIABLE]; else process.env[ASYNC_ENVIRONMENT_VARIABLE] = saved;
  }
});

test("the Vite plugin forwards the SvelteKit options, where the web build turns async mode on, to the web target only", () => {
  const vite = read("packages/svelte-native/src/vite.ts");
  expect(vite.match(/options\.kit/g)?.length).toBe(1);
  // `kit(withWebRunes(options.kit, …))` (SvelteKit's `sveltekit`, loaded when the web target asks for it, with the options the app gave it, the runes default and the app's `async` setting added) follows the early return for the native target.
  expect(vite.indexOf('if (options.target !== "native") return loadSvelteKit()')).toBeGreaterThan(-1);
  const forwarded = vite.indexOf("kit(withWebAsync(withWebRunes(options.kit, options.runes), options.async))");
  expect(forwarded).toBeGreaterThan(-1);
  expect(forwarded).toBeLessThan(vite.indexOf("let root"));
  // The app asks for async mode in the SvelteKit options and nowhere else.
  const config = read("apps/qa/vite.config.ts");
  expect(config.match(/experimental: \{ async: true \}/g)?.length).toBe(1);
  expect(config).toMatch(/kit: \{[\s\S]*?compilerOptions: \{ experimental: \{ async: true \} \}/);
  for (const file of ["metro.config.cjs", "babel.config.cjs", "app.config.ts"]) expect(read("apps/qa", file), file).not.toMatch(/experimental:\s*\{[^}]*\basync\b|flags\/async/);
});

test("no native source imports the async flag module or asks for the flag, but the compile options the app's setting reaches", () => {
  const directories = [join(root, "packages/svelte-native/src"), join(root, "apps/qa/src/lib/native"), join(root, "apps/qa/src/routes")];
  const files = directories.flatMap((directory) => sources(directory));
  expect(files.length).toBeGreaterThan(200);
  // `compile-options.ts` and the Vite plugin's `withWebAsync` are where the app's setting becomes the compiler's option; nothing else asks.
  const asking = files.filter((file) => /internal\/flags\/async|enable_async_mode_flag|experimental:\s*\{[^}]*\basync\b/.test(readFileSync(file, "utf8")));
  expect(asking.map((file) => file.slice(root.length + 1))).toEqual(["packages/svelte-native/src/compile-options.ts"]);
});

test("Svelte's runtime turns the flag on from nowhere but the module that compiled components import, and tick() is a microtask flush while it is off", () => {
  // Only `internal/flags/async.js` (imported by components compiled with `experimental.async`) calls `enable_async_mode_flag`.
  const enablers = sources(join(svelte, "src")).filter((file) => !file.includes(`${join(svelte, "src")}/compiler/`) && /enable_async_mode_flag\(\)/.test(readFileSync(file, "utf8")) && !/function enable_async_mode_flag/.test(readFileSync(file, "utf8")));
  expect(enablers.map((file) => file.slice(svelte.length + 1))).toEqual(["src/internal/flags/async.js"]);
  expect(readFileSync(join(svelte, "src/internal/flags/index.js"), "utf8")).toContain("export let async_mode_flag = false;");
  // `tick()`: with the flag off, one microtask and a synchronous flush of the pending effects, then it resolves.
  const runtime = readFileSync(join(svelte, "src/internal/client/runtime.js"), "utf8");
  const tick = /export async function tick\(\) \{([\s\S]*?)\n\}/.exec(runtime)?.[1] ?? "";
  expect(tick).toMatch(/if \(async_mode_flag\) \{\s*return new Promise\(\(f\) => \{[\s\S]*?requestAnimationFrame\(\(\) => f\(\)\);\s*setTimeout\(\(\) => f\(\)\);\s*\}\);\s*\}/);
  expect(tick.replace(/\/\/.*$/gm, "").replace(/if \(async_mode_flag\) \{[\s\S]*?\n\t\}/, "").replace(/\s+/g, " ").trim()).toBe("await Promise.resolve(); flushSync();");
});
