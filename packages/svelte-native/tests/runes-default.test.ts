import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { compile } from "svelte/compiler";
import { expoEnvironment } from "../src/build.ts";
import { componentOptions, isLibrarySource, RUNES_ENVIRONMENT_VARIABLE, runesDefaultEnabled, runesEnvironment, runesOption, webDynamicCompileOptions, withWebRunes } from "../src/compile-options.ts";
import { withSvelteNative } from "../src/metro.ts";
import { sourceDirectory } from "../src/package-root.ts";
import type { ConfigT } from "@expo/metro/metro-config";

/**
 * D17: the library compiles every app component in runes mode unless the file opts out with `<svelte:options runes={false} />`. A variable that the markup mutates is reactive state in
 * legacy mode, even a `const`, and a worklet that captures one crashes the screen on the device. These pin where the default applies (the app's files, and the library's own),
 * where it does not (a Svelte library below `node_modules`), and how an app turns it off.
 */
const root = resolve(import.meta.dirname, "../../..");
const app = "/work/app/src/routes/counter/+mobile.svelte";
const library = "/work/app/node_modules/some-svelte-lib/Counter.svelte";

// A component that is legacy by inference (it has no rune), with the markup mutating a variable.
const mutated = `<script>
  let count = 0;
  const label = "taps";
</script>
<native-pressable onpress={() => count++}><native-text>{label}: {count}</native-text></native-pressable>
`;
// The legacy syntax runes mode refuses.
const legacy = `<script>
  export let title = "";
  $: shout = title.toUpperCase();
</script>
<native-text>{shout}</native-text>
`;
const compiled = (source: string, filename: string, enabled?: boolean) => compile(source, componentOptions(filename, enabled));

describe("which files are compiled in runes mode", () => {
  test("the app's own files are, a file below node_modules is not (Svelte infers it), and so is nothing when the app turns the default off", () => {
    expect(runesOption(app)).toBe(true);
    expect(runesOption("/work/app/src/lib/Button.svelte")).toBe(true);
    expect(runesOption(library)).toBeUndefined();
    expect(runesOption("/work/app/node_modules/.pnpm/lib@1.0.0/node_modules/lib/src/A.svelte")).toBeUndefined();
    expect(runesOption("C:\\work\\app\\node_modules\\lib\\A.svelte")).toBeUndefined();
    expect(runesOption(app, false)).toBeUndefined();
  });

  test("only a directory named node_modules counts: a file whose path merely contains the word is the app's", () => {
    expect(runesOption("/work/app/src/node_modules_notes/A.svelte")).toBe(true);
    expect(runesOption("/work/app/src/my-node_modules/A.svelte")).toBe(true);
    expect(runesOption("/work/app/packages/ui/src/A.svelte")).toBe(true);
  });

  test("the library's own sources are, wherever the package is installed and whatever the app chose", () => {
    const own = join(sourceDirectory, "Router.svelte");
    expect(isLibrarySource(own)).toBe(true);
    expect(runesOption(own)).toBe(true);
    expect(runesOption(own, false)).toBe(true);
    expect(isLibrarySource("/work/app/src/Router.svelte")).toBe(false);
    // Installed: the path below the app's node_modules is a link into the package (pnpm's layout), and the file is the library's.
    const scratch = realpathSync(mkdtempSync(join(tmpdir(), "runes-default-")));
    try {
      mkdirSync(join(scratch, "node_modules/@rasheed"), { recursive: true });
      symlinkSync(resolve(sourceDirectory, ".."), join(scratch, "node_modules/@rasheed/svelte-native"));
      const installed = join(scratch, "node_modules/@rasheed/svelte-native/src/Router.svelte");
      expect(isLibrarySource(installed)).toBe(true);
      expect(runesOption(installed, false)).toBe(true);
      // A file below node_modules that does not exist, or is not a link into the package, is a third party's.
      expect(isLibrarySource(join(scratch, "node_modules/@rasheed/svelte-native/src/Nothing.svelte"))).toBe(false);
      mkdirSync(join(scratch, "node_modules/other"), { recursive: true });
      writeFileSync(join(scratch, "node_modules/other/A.svelte"), "");
      expect(isLibrarySource(join(scratch, "node_modules/other/A.svelte"))).toBe(false);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });

  test("every component the package ships compiles in runes mode, the ones with no rune in them included", () => {
    const files = (readdirSync(sourceDirectory, { recursive: true }) as string[]).filter((file) => file.endsWith(".svelte")).map((file) => join(sourceDirectory, file));
    expect(files.length).toBeGreaterThan(80);
    const notRunes = files.filter((file) => !compiled(readFileSync(file, "utf8"), file, false).metadata.runes);
    expect(notRunes).toEqual([]);
    // The control: without the default some of them would be inferred as legacy.
    const inferred = files.filter((file) => !compile(readFileSync(file, "utf8"), { filename: file, generate: "client", experimental: { customRenderer: "@rasheed/svelte-native/renderer" } }).metadata.runes);
    expect(inferred.map((file) => file.slice(sourceDirectory.length + 1)).toSorted()).toEqual(["TabPaneList.svelte", "TabPanes.svelte"]);
  });

  test("`runes` is read from the environment: unset or anything but off leaves the default on", () => {
    expect(runesDefaultEnabled({})).toBe(true);
    expect(runesDefaultEnabled({ [RUNES_ENVIRONMENT_VARIABLE]: "" })).toBe(true);
    expect(runesDefaultEnabled({ [RUNES_ENVIRONMENT_VARIABLE]: "1" })).toBe(true);
    for (const off of ["0", "false", "FALSE", "off", "no", " 0 "]) expect(runesDefaultEnabled({ [RUNES_ENVIRONMENT_VARIABLE]: off })).toBe(false);
    expect(runesEnvironment(undefined)).toEqual({});
    expect(runesEnvironment(true)).toEqual({ SVELTE_NATIVE_RUNES: "1" });
    expect(runesEnvironment(false)).toEqual({ SVELTE_NATIVE_RUNES: "0" });
  });
});

describe("what the compiler does with the option, in the vendored Svelte", () => {
  test("a component with no rune in it is compiled in runes mode: the mutated variable is a plain variable, not reactive state", () => {
    const byDefault = compiled(mutated, app);
    expect(byDefault.metadata.runes).toBe(true);
    expect(byDefault.js.code).not.toContain("internal/flags/legacy");
    expect(byDefault.js.code).not.toContain("mutable_source");
    // The control: Svelte on its own infers legacy mode and makes `count` state.
    const inferred = compile(mutated, { filename: app, experimental: { customRenderer: "@rasheed/svelte-native/renderer" } });
    expect(inferred.metadata.runes).toBe(false);
    expect(inferred.js.code).toContain("mutable_source");
  });

  test("the file's own `<svelte:options runes={false} />` wins over the compile option", () => {
    const optedOut = compiled(`<svelte:options runes={false} />\n${mutated}`, app);
    expect(optedOut.metadata.runes).toBe(false);
    expect(optedOut.js.code).toContain("mutable_source");
    // And the legacy syntax compiles in that file.
    expect(compiled(`<svelte:options runes={false} />\n${legacy}`, app).metadata.runes).toBe(false);
  });

  test("legacy syntax in an app file is an error in runes mode, and compiles in a library below node_modules, in a file that opts out, and with the default off", () => {
    expect(() => compiled(legacy, app)).toThrow(/export let|legacy_export_invalid|\$props/);
    expect(compiled(legacy, library).metadata.runes).toBe(false);
    expect(compiled(legacy, app, false).metadata.runes).toBe(false);
  });

  test("a Svelte module is always in runes mode: there is nothing to default", async () => {
    const { compileModule } = await import("svelte/compiler");
    const source = "let n = $state(1);\nexport const bump = () => ++n;";
    const filename = "/work/app/src/total.svelte.js";
    expect(compileModule(source, { filename }).js.code).toContain("$.state(1)");
    // The module compiler has no `runes` option (it is accepted and ignored): there is no legacy mode to opt into.
    expect(compileModule(source, { filename, runes: false } as never).js.code).toContain("$.state(1)");
  });
});

describe("the web target of the Vite plugin", () => {
  const given = (filename: string, runes?: boolean) => ({ filename, code: "", compileOptions: runes === undefined ? {} : { runes } });

  test("asks for runes mode in the app's files and the library's, not in node_modules, and not where the app set the option itself", async () => {
    const dynamic = webDynamicCompileOptions();
    expect(await dynamic(given(app))).toEqual({ runes: true });
    expect(await dynamic(given("/work/app/src/lib/store.svelte.ts"))).toEqual({ runes: true });
    expect(await dynamic(given(library))).toBeUndefined();
    expect(await dynamic(given(app, false))).toBeUndefined();
    expect(await dynamic(given(join(sourceDirectory, "Router.svelte"), false))).toEqual({ runes: true });
    expect(await webDynamicCompileOptions(undefined, false)(given(app))).toBeUndefined();
  });

  test("the app's own dynamicCompileOptions still has the last word", async () => {
    const dynamic = webDynamicCompileOptions((data) => (data.filename.endsWith("legacy.svelte") ? { runes: false } : { css: "injected" }));
    expect(await dynamic(given("/work/app/src/lib/legacy.svelte"))).toEqual({ runes: false });
    expect(await dynamic(given("/work/app/src/lib/other.svelte"))).toEqual({ runes: true, css: "injected" });
    expect(await dynamic(given(library))).toEqual({ css: "injected" });
  });

  test("the app's callback may declare the data of any vite-plugin-svelte (7.3 adds Vite's `environment`) and still passes through", async () => {
    // The type is the check: `pnpm typecheck` fails when withWebRunes does not take a callback of vite-plugin-svelte 7.3's shape, as well as 7.2's.
    type Data73 = { filename: string; code: string; compileOptions: object; environment: { name: string } };
    const seen: Data73[] = [];
    const options = withWebRunes({ dynamicCompileOptions: (data: Data73) => { seen.push(data); return { css: "injected" as const }; } });
    const wrapped = options.dynamicCompileOptions as (data: Data73) => Promise<unknown>;
    expect(await wrapped({ ...given(app), environment: { name: "client" } })).toEqual({ runes: true, css: "injected" });
    expect(seen[0]?.environment).toEqual({ name: "client" });
  });

  test("withWebRunes keeps the rest of the SvelteKit options", () => {
    const options = withWebRunes({ compilerOptions: { experimental: { async: true } } });
    expect(options.compilerOptions).toEqual({ experimental: { async: true } });
    expect(typeof options.dynamicCompileOptions).toBe("function");
    expect(typeof withWebRunes(undefined).dynamicCompileOptions).toBe("function");
  });

  test("svelteNative({ target: 'web' }) hands SvelteKit the option, and vite-plugin-svelte applies it", () => {
    const ask = (runes: boolean | null) => {
      const done = Bun.spawnSync(["node", join(import.meta.dirname, "web-runes-probe.ts"), JSON.stringify(runes)], { cwd: join(root, "apps/qa"), stdout: "pipe", stderr: "pipe" });
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
  const config = (projectRoot: string) => ({ projectRoot, resolver: { sourceExts: ["ts"] }, serializer: { getModulesRunBeforeMainModule: () => [] }, transformer: {} }) as unknown as ConfigT;

  test("withSvelteNative(config, { runes }) hands the setting to the workers it starts, and leaves the environment alone without it", () => {
    delete process.env[RUNES_ENVIRONMENT_VARIABLE];
    const projectRoot = mkdtempSync(join(tmpdir(), "runes-metro-"));
    try {
      withSvelteNative(config(projectRoot), { syncRoutes: false });
      expect(process.env[RUNES_ENVIRONMENT_VARIABLE]).toBeUndefined();
      expect(runesDefaultEnabled()).toBe(true);
      withSvelteNative(config(projectRoot), { syncRoutes: false, runes: false });
      expect(process.env[RUNES_ENVIRONMENT_VARIABLE]).toBe("0");
      expect(runesDefaultEnabled()).toBe(false);
      expect(runesOption(app)).toBeUndefined();
      expect(componentOptions(app).runes).toBeUndefined();
      withSvelteNative(config(projectRoot), { syncRoutes: false, runes: true });
      expect(runesDefaultEnabled()).toBe(true);
      expect(componentOptions(app).runes).toBe(true);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("the Vite plugin's native target runs the export with the setting in the environment of the Metro it starts", () => {
    expect(expoEnvironment(["export:embed"], runesEnvironment(false))[RUNES_ENVIRONMENT_VARIABLE]).toBe("0");
    expect(expoEnvironment(["export:embed"], runesEnvironment(true))[RUNES_ENVIRONMENT_VARIABLE]).toBe("1");
    // Without the option the environment is the process's own, so a setting from the shell or from the app's metro.config is not overwritten.
    process.env[RUNES_ENVIRONMENT_VARIABLE] = "0";
    expect(expoEnvironment(["export:embed"], runesEnvironment(undefined))[RUNES_ENVIRONMENT_VARIABLE]).toBe("0");
    expect(expoEnvironment(["start", "--localhost"]).NODE_OPTIONS).toContain("--dns-result-order=ipv4first");
  });

  test("the transformer's cache key follows the setting, so a changed option never reads a cached component", () => {
    const key = (value: string) => {
      const done = Bun.spawnSync(["node", "--input-type=module", "-e", "const { getCacheKey } = await import(process.argv[1]); console.log(getCacheKey({ projectRoot: process.cwd() }))", join(import.meta.dirname, "../src/transformer.ts")], { env: { ...process.env, [RUNES_ENVIRONMENT_VARIABLE]: value }, stdout: "pipe", stderr: "pipe" });
      return done.exitCode === 0 ? done.stdout.toString().trim() : done.stderr.toString();
    };
    const [on, off, again] = [key("1"), key("0"), key("1")];
    expect(on).toMatch(/^[0-9a-f]{64}$/);
    expect(off).toMatch(/^[0-9a-f]{64}$/);
    expect(on).not.toBe(off);
    expect(again).toBe(on);
  });
});
