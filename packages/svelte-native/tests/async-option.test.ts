import { afterEach, describe, expect, mock, test } from "bun:test";
import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { compile, compileModule } from "svelte/compiler";
import type { ConfigT } from "@expo/metro/metro-config";
import { expoEnvironment, exportNative } from "../src/build.ts";
import { ASYNC_ENVIRONMENT_VARIABLE, RUNES_ENVIRONMENT_VARIABLE, asyncEnabled, asyncEnvironment, componentOptions, moduleOptions, withWebAsync } from "../src/compile-options.ts";
import { withSvelteNative } from "../src/metro.ts";
import { sourceDirectory } from "../src/package-root.ts";
import { svelteNative } from "../src/vite.ts";
import { asyncRun } from "./async-run.ts";

/**
 * `withSvelteNative(config, { async: true })` (and `svelteNative({ async: true })`): Svelte's async mode, which `router.prepare` needs, as an option of the library instead of an import of Svelte's
 * private flag module. It reaches the transformer through the environment, as `runes` does (`runes-default.test.ts`), is part of Metro's cache key, and compiles every Svelte file the
 * transformer sees with `experimental.async`. `node-modules.test.ts` runs the built transformer with it under plain Node.
 */
const root = resolve(import.meta.dirname, "../../..");
const app = "/work/app/src/routes/counter/+mobile.svelte";
const library = "/work/app/node_modules/some-svelte-lib/Counter.svelte";
const own = join(sourceDirectory, "Router.svelte");

const saved = process.env[ASYNC_ENVIRONMENT_VARIABLE];
afterEach(() => {
  if (saved === undefined) delete process.env[ASYNC_ENVIRONMENT_VARIABLE]; else process.env[ASYNC_ENVIRONMENT_VARIABLE] = saved;
});

describe("the setting", () => {
  test("is off unless the environment turns it on, and the environment carries what the app gave", () => {
    expect(asyncEnabled({})).toBe(false);
    expect(asyncEnabled({ [ASYNC_ENVIRONMENT_VARIABLE]: "" })).toBe(false);
    for (const on of ["1", "true", "TRUE", "on", "yes", " 1 "]) expect(asyncEnabled({ [ASYNC_ENVIRONMENT_VARIABLE]: on })).toBe(true);
    for (const off of ["0", "false", "off", "no", "2", "async"]) expect(asyncEnabled({ [ASYNC_ENVIRONMENT_VARIABLE]: off })).toBe(false);
    expect(asyncEnvironment(undefined)).toEqual({});
    expect(asyncEnvironment(true)).toEqual({ SVELTE_NATIVE_ASYNC: "1" });
    expect(asyncEnvironment(false)).toEqual({ SVELTE_NATIVE_ASYNC: "0" });
  });

  test("withSvelteNative(config, { async }) hands it to the workers it starts, and leaves the environment alone without it", () => {
    const config = (projectRoot: string) => ({ projectRoot, resolver: { sourceExts: ["ts"] }, serializer: { getModulesRunBeforeMainModule: () => [] }, transformer: {} }) as unknown as ConfigT;
    delete process.env[ASYNC_ENVIRONMENT_VARIABLE];
    const projectRoot = mkdtempSync(join(tmpdir(), "async-metro-"));
    try {
      withSvelteNative(config(projectRoot), { syncRoutes: false });
      expect(process.env[ASYNC_ENVIRONMENT_VARIABLE]).toBeUndefined();
      expect(asyncEnabled()).toBe(false);
      expect(componentOptions(app).experimental).toEqual({ customRenderer: "@example/svelte-native/renderer" });
      withSvelteNative(config(projectRoot), { syncRoutes: false, async: true });
      expect(process.env[ASYNC_ENVIRONMENT_VARIABLE]).toBe("1");
      expect(componentOptions(app).experimental).toEqual({ customRenderer: "@example/svelte-native/renderer", async: true });
      expect(moduleOptions("/work/app/src/lib/state.svelte.ts")).toEqual({ filename: "/work/app/src/lib/state.svelte.ts", dev: false, generate: "client", experimental: { async: true } });
      withSvelteNative(config(projectRoot), { syncRoutes: false, async: false });
      expect(process.env[ASYNC_ENVIRONMENT_VARIABLE]).toBe("0");
      expect(componentOptions(app).experimental).toEqual({ customRenderer: "@example/svelte-native/renderer" });
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("the Vite plugin's native target runs the export with it in the environment of the Metro it starts", async () => {
    expect(expoEnvironment(["export:embed"], asyncEnvironment(true))[ASYNC_ENVIRONMENT_VARIABLE]).toBe("1");
    // Without the option the environment is the process's own, so a setting from the shell or from the app's metro.config is not overwritten.
    process.env[ASYNC_ENVIRONMENT_VARIABLE] = "1";
    expect(expoEnvironment(["export:embed"], asyncEnvironment(undefined))[ASYNC_ENVIRONMENT_VARIABLE]).toBe("1");
    // And the two ways to start that Metro, `exportNative` and the plugin's `generateBundle`, hand the option over: `expo export:embed` is run through a stand-in for `spawn` that
    // records the environment it was given.
    const started: { args: string[]; env: NodeJS.ProcessEnv }[] = [];
    const childProcess = { ...(await import("node:child_process")) };
    mock.module("node:child_process", () => ({
      ...childProcess,
      spawn: (_command: string, args: string[], options: { env: NodeJS.ProcessEnv }) => {
        started.push({ args, env: options.env });
        const child = new EventEmitter();
        queueMicrotask(() => child.emit("exit", 0));
        return child;
      },
    }));
    const projectRoot = mkdtempSync(join(tmpdir(), "async-export-"));
    mkdirSync(join(projectRoot, "src/routes"), { recursive: true });
    writeFileSync(join(projectRoot, "src/routes/+mobile.svelte"), "<native-text>home</native-text>\n");
    try {
      delete process.env[ASYNC_ENVIRONMENT_VARIABLE];
      delete process.env[RUNES_ENVIRONMENT_VARIABLE];
      await exportNative(projectRoot, "android", { async: true, runes: false });
      expect(started.at(-1)?.args).toContain("export:embed");
      expect(started.at(-1)?.env[ASYNC_ENVIRONMENT_VARIABLE]).toBe("1");
      expect(started.at(-1)?.env[RUNES_ENVIRONMENT_VARIABLE]).toBe("0");
      await exportNative(projectRoot, "android", {});
      expect(started.at(-1)?.env[ASYNC_ENVIRONMENT_VARIABLE]).toBeUndefined();
      // The plugin: its hooks, run the way Vite runs them (`configResolved`, then `generateBundle`).
      const plugin = svelteNative({ target: "native", platform: "ios", async: true }) as { configResolved(config: { root: string }): void; generateBundle(): Promise<void> };
      plugin.configResolved({ root: projectRoot });
      await plugin.generateBundle();
      expect(started.at(-1)?.args).toContain("ios");
      expect(started.at(-1)?.env[ASYNC_ENVIRONMENT_VARIABLE]).toBe("1");
      expect(started).toHaveLength(3);
    } finally {
      mock.module("node:child_process", () => childProcess);
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("the transformer's cache key follows it, so a changed option never reads a cached component", () => {
    const key = (value: string | undefined) => {
      const env = { ...process.env };
      if (value === undefined) delete env[ASYNC_ENVIRONMENT_VARIABLE]; else env[ASYNC_ENVIRONMENT_VARIABLE] = value;
      const done = Bun.spawnSync(["node", "--input-type=module", "-e", "const { getCacheKey } = await import(process.argv[1]); console.log(getCacheKey({ projectRoot: process.cwd() }))", join(sourceDirectory, "transformer.ts")], { env, stdout: "pipe", stderr: "pipe" });
      return done.exitCode === 0 ? done.stdout.toString().trim() : done.stderr.toString();
    };
    const [unset, on, off, again] = [key(undefined), key("1"), key("0"), key("1")];
    expect(on).toMatch(/^[0-9a-f]{64}$/);
    expect(on).not.toBe(unset);
    expect(off).toBe(unset);
    expect(again).toBe(on);
  });
});

describe("what it compiles", () => {
  // A component with no `await`, as nearly all are.
  const plain = "<script>let { a } = $props();</script><native-view>{a}</native-view>";
  // One that needs the option: `await` at the top of a component and in a `$derived`.
  const awaiting = "<script>let { a } = $props(); const value = await Promise.resolve(a); const doubled = $derived(await Promise.resolve(value * 2));</script><native-text>{doubled}</native-text>";
  const flag = "import 'svelte/internal/flags/async';";

  test.skipIf(asyncRun)("every Svelte file the transformer sees: the app's, a library's below node_modules and the package's own, and a Svelte module", () => {
    for (const file of [app, library, own]) {
      expect(compile(plain, componentOptions(file, undefined, true)).js.code, file).toContain(flag);
      expect(compile(plain, componentOptions(file, undefined, false)).js.code, file).not.toContain(flag);
    }
    // The only thing the option adds to a component that has no `await` is the import of the flag (`fork.test.ts` compares the rest of the output).
    const module = "let count = $state(0); export const bump = () => { count++; };";
    expect(compileModule(module, moduleOptions("/work/app/src/lib/state.svelte.ts", true)).js.code).toBe(compileModule(module, moduleOptions("/work/app/src/lib/state.svelte.ts", false)).js.code);
  });

  test.skipIf(asyncRun)("and `await` in a component, a derived or the markup compiles only with it", () => {
    expect(() => compile(awaiting, componentOptions(app, undefined, false))).toThrow(/experimental_async|async mode/i);
    expect(compile(awaiting, componentOptions(app, undefined, true)).js.code).toContain(flag);
    const awaited = "let a = $state(1); const later = $derived(await Promise.resolve(a)); export const read = () => later;";
    expect(() => compileModule(awaited, moduleOptions("/work/app/src/lib/later.svelte.ts", false))).toThrow(/experimental_async|async mode/i);
    expect(compileModule(awaited, moduleOptions("/work/app/src/lib/later.svelte.ts", true)).js.code).toContain("later");
  });
});

describe("the web target of the Vite plugin", () => {
  test("withWebAsync adds it to SvelteKit's compiler options under the app's own, and does nothing without the option", () => {
    expect(withWebAsync(undefined, undefined)).toBeUndefined();
    const given = { compilerOptions: { runes: true, experimental: { customRenderer: "x" } } };
    expect(withWebAsync(given, undefined)).toBe(given);
    expect(withWebAsync(given, false)).toBe(given);
    expect(withWebAsync(given, true)).toEqual({ compilerOptions: { runes: true, experimental: { async: true, customRenderer: "x" } } });
    expect(withWebAsync(undefined, true)).toEqual({ compilerOptions: { experimental: { async: true } } });
    expect(withWebAsync({ compilerOptions: { experimental: { async: false } } }, true)).toEqual({ compilerOptions: { experimental: { async: false } } });
  });

  test("svelteNative({ target: 'web', async }) hands SvelteKit the option, and vite-plugin-svelte applies it", () => {
    const ask = (input: { async?: boolean; kit?: object }) => {
      const done = Bun.spawnSync(["node", join(import.meta.dirname, "web-async-probe.ts"), JSON.stringify(input)], { cwd: join(root, "apps/qa"), stdout: "pipe", stderr: "pipe" });
      if (done.exitCode !== 0) throw new Error(`the web probe failed:\n${done.stderr.toString().slice(-2000)}`);
      return (JSON.parse(done.stdout.toString().trim().split("\n").at(-1) as string) as { experimental: Record<string, unknown> | null }).experimental;
    };
    expect(ask({})?.async).toBeUndefined();
    expect(ask({ async: true })?.async).toBe(true);
    expect(ask({ async: true, kit: { compilerOptions: { experimental: { async: false } } } })?.async).toBe(false);
  }, 60_000);
});
