import { afterEach, describe, expect, test } from "bun:test";
import { join, resolve } from "node:path";
import { expoEnvironment } from "../../src/build.ts";
import { componentOptions, RUNES_ENVIRONMENT_VARIABLE, runesDefaultEnabled, runesEnvironment, runesOption } from "../../src/compile-options.ts";
import { withSvelteNative } from "../../src/metro.ts";
import { fakeConfig } from "../support/metro.ts";
import { withProject } from "../support/project.ts";

/**
 * What the runes-mode default (`compiler/runes-default.test.ts`) does outside the compiler: the Vite plugin's web target hands SvelteKit the option and vite-plugin-svelte applies it
 * (`fixtures/web-runes-probe.ts`, under Node, in the QA app), `withSvelteNative(config, { runes })` and the Vite plugin's native target hand the setting to the Metro they start, and the
 * transformer's cache key follows it.
 */
const root = resolve(import.meta.dirname, "../../../..");
const app = "/work/app/src/routes/counter/+mobile.svelte";

describe("the web target of the Vite plugin", () => {
  test("svelteNative({ target: 'web' }) hands SvelteKit the option, and vite-plugin-svelte applies it", () => {
    const ask = (runes: boolean | null) => {
      const done = Bun.spawnSync(["node", join(import.meta.dirname, "fixtures/web-runes-probe.ts"), JSON.stringify(runes)], { cwd: join(root, "apps/qa"), stdout: "pipe", stderr: "pipe" });
      if (done.exitCode !== 0) throw new Error(`the web probe failed:\n${done.stderr.toString().slice(-2000)}`);
      return JSON.parse(done.stdout.toString().trim().split("\n").at(-1) as string) as { compilerOptions: { experimental?: { async?: boolean } }; app: unknown; library: unknown };
    };
    const byDefault = ask(null);
    // The app's SvelteKit options (the async flag the QA app's web build turns on) reach the compiler options alongside.
    expect(byDefault.compilerOptions.experimental?.async).toBe(true);
    expect(byDefault.app).toEqual({ runes: true });
    expect(byDefault.library).toBeNull();
    const off = ask(false);
    expect(off.compilerOptions.experimental?.async).toBe(true);
    expect(off.app).toBeNull();
    expect(off.library).toBeNull();
  }, 60_000);
});

describe("the Metro integration and the native target of the Vite plugin", () => {
  const saved = process.env[RUNES_ENVIRONMENT_VARIABLE];
  afterEach(() => {
    if (saved === undefined) delete process.env[RUNES_ENVIRONMENT_VARIABLE]; else process.env[RUNES_ENVIRONMENT_VARIABLE] = saved;
  });

  test("withSvelteNative(config, { runes }) hands the setting to the workers it starts, and leaves the environment alone without it", async () => {
    delete process.env[RUNES_ENVIRONMENT_VARIABLE];
    await withProject({}, ({ directory: projectRoot }) => {
      withSvelteNative(fakeConfig(projectRoot), { syncRoutes: false });
      expect(process.env[RUNES_ENVIRONMENT_VARIABLE]).toBeUndefined();
      expect(runesDefaultEnabled()).toBe(true);
      withSvelteNative(fakeConfig(projectRoot), { syncRoutes: false, runes: false });
      expect(process.env[RUNES_ENVIRONMENT_VARIABLE]).toBe("0");
      expect(runesDefaultEnabled()).toBe(false);
      expect(runesOption(app)).toBeUndefined();
      expect(componentOptions(app).runes).toBeUndefined();
      withSvelteNative(fakeConfig(projectRoot), { syncRoutes: false, runes: true });
      expect(runesDefaultEnabled()).toBe(true);
      expect(componentOptions(app).runes).toBe(true);
    });
  });

  test("the Vite plugin's native target runs the export with the setting in the environment of the Metro it starts", () => {
    expect(expoEnvironment(["export:embed"], runesEnvironment(false))[RUNES_ENVIRONMENT_VARIABLE]).toBe("0");
    expect(expoEnvironment(["export:embed"], runesEnvironment(true))[RUNES_ENVIRONMENT_VARIABLE]).toBe("1");
    // Without the option the environment is the process's own, so a setting from the shell or from the app's metro.config is not overwritten.
    process.env[RUNES_ENVIRONMENT_VARIABLE] = "0";
    expect(expoEnvironment(["export:embed"], runesEnvironment(undefined))[RUNES_ENVIRONMENT_VARIABLE]).toBe("0");
  });

  test("a Metro the CLI starts resolves names IPv4-first, whatever the setting", () => {
    expect(expoEnvironment(["start", "--localhost"]).NODE_OPTIONS).toContain("--dns-result-order=ipv4first");
  });

  test("the transformer's cache key follows the setting, so a changed option never reads a cached component", () => {
    const key = (value: string) => {
      const done = Bun.spawnSync(["node", "--input-type=module", "-e", "const { getCacheKey } = await import(process.argv[1]); console.log(getCacheKey({ projectRoot: process.cwd() }))", join(import.meta.dirname, "../../src/transformer.ts")], { env: { ...process.env, [RUNES_ENVIRONMENT_VARIABLE]: value }, stdout: "pipe", stderr: "pipe" });
      return done.exitCode === 0 ? done.stdout.toString().trim() : done.stderr.toString();
    };
    const [on, off, again] = [key("1"), key("0"), key("1")];
    expect(on).toMatch(/^[0-9a-f]{64}$/);
    expect(off).toMatch(/^[0-9a-f]{64}$/);
    expect(on).not.toBe(off);
    expect(again).toBe(on);
  });
});
