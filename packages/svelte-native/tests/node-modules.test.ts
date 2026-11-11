import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { findPackage } from "../src/doctor/resolve.ts";

// The package is installed by apps outside this repository, so its code runs from a `node_modules`, where Node refuses to load TypeScript
// (`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`, Node 25 and 26). In this repository it works whatever is wrong, because the workspace link is
// not under `node_modules`. So this packs the package the way `files` ships it, unpacks it into `node_modules/@example/svelte-native` of a scratch app
// and loads every entry a Node process loads with plain `node` (no Bun, no loader): the command line, the Metro config and transformer, the Expo
// config plugin (under both of its names) and Vite's config. Two more apps hold the same package: a native-only one, which has neither SvelteKit nor Vite
// (it bundles with Metro and type-checks with svelte-check), and one in pnpm's default layout, where `@expo/metro-config` is only beside `expo`.
const packageDirectory = resolve(import.meta.dirname, "..");
const repositoryRoot = resolve(packageDirectory, "../..");
const fixture = join(import.meta.dirname, "fixtures/installed-app");
const manifest = JSON.parse(readFileSync(join(packageDirectory, "package.json"), "utf8")) as {
  dependencies: Record<string, string>;
  peerDependencies: Record<string, string>;
  peerDependenciesMeta: Record<string, { optional?: boolean }>;
};

const node = Bun.which("node");
const scratch = realpathSync(mkdtempSync(join(tmpdir(), "svelte-native-installed-")));
const app = join(scratch, "app");
const installed = join(app, "node_modules/@example/svelte-native");
/** The native-only app: no `@sveltejs/kit`, no `vite`, and no app that is above it that has them. */
const bare = join(scratch, "bare");
/** An app in pnpm's default layout: `expo` is a link to a directory of its own, and `@expo/metro-config` is only in that directory's `node_modules`. */
const strict = join(scratch, "strict");
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

/** What an install links at the top of an app's `node_modules`: the package's dependencies and the peers the app has, as real directories of this install. */
function link(name: string, into = app, from = packageDirectory): boolean {
  const found = findPackage(name, from);
  if (!found) return false;
  mkdirSync(dirname(join(into, "node_modules", name)), { recursive: true });
  symlinkSync(found.directory, join(into, "node_modules", name));
  return true;
}

/** The names an app that has the package installs beside it: the dependencies, and the peers it has (`skip`: the ones it does not). */
const installedNames = (skip: readonly string[] = []): string[] => [...Object.keys(manifest.dependencies), ...Object.keys(manifest.peerDependencies)].filter((name) => !skip.includes(name));

/** Puts the unpacked package into `into`'s `node_modules` and the fixture's files in `into`. */
function install(into: string, from = fixture): void {
  mkdirSync(join(into, "node_modules/@example"), { recursive: true });
  cpSync(installed, join(into, "node_modules/@example/svelte-native"), { recursive: true });
  cpSync(from, into, { recursive: true });
}

beforeAll(() => {
  // The tarball of the tool a dependent's install uses: `files` decides what is in it.
  const packer = Bun.which("pnpm") ? ["pnpm", "pack"] : ["npm", "pack", "--ignore-scripts"];
  const packed = join(scratch, "packed");
  mkdirSync(packed);
  const pack = Bun.spawnSync([...packer, "--pack-destination", packed], { cwd: packageDirectory, stdout: "pipe", stderr: "pipe" });
  expect(pack.stderr.toString() + pack.exitCode).toMatch(/0$/);
  const [tarball] = readdirSync(packed).filter((file) => file.endsWith(".tgz"));
  mkdirSync(installed, { recursive: true });
  const unpack = Bun.spawnSync(["tar", "-xzf", join(packed, tarball), "-C", installed, "--strip-components=1"], { stdout: "pipe", stderr: "pipe" });
  expect(unpack.stderr.toString() + unpack.exitCode).toMatch(/0$/);
  cpSync(fixture, app, { recursive: true });
  // The dependencies are installed with the package; the peers (those this repository has) by the app. `@expo/config-plugins` is what Expo brings to a hoisted install, and the
  // tool the Expo plugin is loaded by. `@expo/metro-config` is not linked: the transformer finds it through `expo`, which is.
  for (const name of [...installedNames(), "@expo/config-plugins"]) link(name);

  // The native-only app. `expo-modules-core` and the two `@types` packages are what a hoisted install has at the top: the library's source imports the first (a dependency of `expo`),
  // and the app's tsconfig names the others.
  install(bare, join(import.meta.dirname, "fixtures/bare-app"));
  for (const name of [...installedNames(optionalPeers), "expo-modules-core", "@types/react", "@types/node"]) link(name, bare);

  // The default layout of pnpm: `node_modules/expo` is a link to a directory of its own, and the packages `expo` depends on are linked inside that directory and nowhere else.
  install(strict);
  const store = join(strict, "store/expo");
  mkdirSync(join(store, "node_modules/@expo"), { recursive: true });
  writeFileSync(join(store, "package.json"), JSON.stringify({ name: "expo", version: "57.0.30" }));
  symlinkSync(findPackage("@expo/metro-config", packageDirectory)?.directory ?? "", join(store, "node_modules/@expo/metro-config"));
  mkdirSync(join(strict, "node_modules"), { recursive: true });
  symlinkSync(store, join(strict, "node_modules/expo"));
  for (const name of installedNames(["expo"])) link(name, strict);
});

/** The peers an app that builds for native only does not install. */
const optionalPeers = ["@sveltejs/kit", "vite"];

/** Runs `node` in a scratch app (the first one by default). */
function run(args: string[], cwd = app, env: Record<string, string> = {}): { stdout: string; stderr: string; exitCode: number } {
  if (!node) throw new Error("node is not on the PATH: the entries Node loads are run with it");
  const result = Bun.spawnSync([node, ...args], { cwd, stdout: "pipe", stderr: "pipe", env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0", ...env } });
  return { stdout: result.stdout.toString(), stderr: result.stderr.toString(), exitCode: result.exitCode ?? -1 };
}
const NOT_TYPESCRIPT = "ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING";
/** Runs a probe of the fixture and returns the JSON it printed; the run must have loaded everything without the TypeScript error. */
function probe(file: string, cwd = app): Record<string, unknown> {
  const result = run([file], cwd);
  expect(result.stderr).not.toContain(NOT_TYPESCRIPT);
  expect(result.stderr + result.exitCode).toMatch(/0$/);
  return JSON.parse(result.stdout.trim().split("\n").pop() ?? "") as Record<string, unknown>;
}

describe("the package as it is packed", () => {
  test("ships the built JavaScript next to the sources, and the bin points at it", () => {
    for (const file of ["cli.js", "expo.cjs", "lower.js", "metro.cjs", "routes.js", "transformer.cjs", "vite.js"]) expect([file, existsSync(join(installed, "dist/node", file))]).toEqual([file, true]);
    expect(existsSync(join(installed, "app.plugin.js"))).toBe(true);
    expect(existsSync(join(installed, "src/fabric/react-native-lite.ts"))).toBe(true);
    expect(JSON.parse(readFileSync(join(installed, "package.json"), "utf8")).bin).toEqual({ "svelte-native": "./dist/node/cli.js" });
  });

  test("control: the TypeScript source does not load from node_modules (which is why the entries are built)", () => {
    const result = run([join(installed, "src/cli.ts"), "doctor", "--help"]);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain(NOT_TYPESCRIPT);
  });
});

describe("with plain node, from node_modules", () => {
  test("svelte-native doctor --help (the bin)", () => {
    const result = run([join(installed, "dist/node/cli.js"), "doctor", "--help"]);
    expect(result.stderr).not.toContain(NOT_TYPESCRIPT);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Usage: svelte-native doctor [--json]");
  });

  test("svelte-native doctor --json reads the package's own patches/ and the app", () => {
    const result = run([join(installed, "dist/node/cli.js"), "doctor", "--json"]);
    expect(result.stderr).not.toContain(NOT_TYPESCRIPT);
    // The scratch app lacks most peers, so the doctor fails; what matters is that it ran and found the package's patch files in node_modules.
    const report = JSON.parse(result.stdout) as { appRoot: string; checks: { group: string; status: string; message: string }[] };
    expect(report.appRoot).toBe(app);
    expect(report.checks.filter((check) => check.group === "patches").length).toBe(readdirSync(join(installed, "patches")).filter((file) => file.endsWith(".patch")).length);
    expect(report.checks.find((check) => check.group === "svelte")?.status).toBe("pass");
  });

  test("an unknown command is the CLI's own error, not a loader's", () => {
    const result = run([join(installed, "dist/node/cli.js"), "nope"]);
    expect(result.stderr).toContain("Unknown command: nope");
    expect(result.stderr).not.toContain(NOT_TYPESCRIPT);
  });

  test("@example/svelte-native/metro: require, withSvelteNative on a minimal config, the route table written, the runtime files found in the package's src/", () => {
    const result = probe("metro.cjs") as Record<string, string>;
    expect(result.transformerPath).toBe(join(installed, "dist/node/transformer.cjs"));
    expect(result.lite).toBe(join(installed, "src/fabric/react-native-lite.ts"));
    expect(result.environment).toBe(join(installed, "src/environment.ts"));
    expect(result.rendererStub).toBe(join(installed, "src/fabric/renderer-stub.ts"));
    expect(result.initializeCore).toBe(join(installed, "src/init.ts"));
    // `svelte/*` is resolved from the entry of the svelte the app installed.
    expect(result.svelte).toBe(`${join(findPackage("svelte", packageDirectory)?.directory ?? "", "native-entry.js")}::svelte/internal/client`);
    // The fixture names no variant: the table is the library's default, `app`.
    expect(result.routes).toBe(join(app, ".svelte-native/routes.app.ts"));
    expect(result.table).toContain("../src/routes/+mobile.svelte");
    expect(result.entry).toContain("createFabricApp");
  });

  test("@example/svelte-native/transformer: the path Metro's worker requires compiles a .svelte file and a remote module", () => {
    const result = probe("transformer.cjs") as { exports: string[]; svelteImports: string[]; svelteModule: string[]; remote: string; modes: Record<string, string>; cacheKey: string; resolvedFrom: string };
    expect(result.resolvedFrom).toBe(join(installed, "dist/node/transformer.cjs"));
    expect(result.exports).toEqual(["getCacheKey", "sourceOf", "transform", "upstreamTransformerPath"]);
    // A `.svelte.ts` module at the path an install puts the library's own (`router.svelte.ts`, `insets.svelte.ts`) at: compiled by Svelte as JavaScript.
    expect(result.svelteModule).toContain("svelte/internal/client");
    expect(result.svelteImports).toContain("@example/svelte-native/renderer");
    expect(result.svelteImports).toContain("svelte/internal/client");
    expect(result.svelteImports).toContain("svelte/transition");
    expect(result.remote).toContain("@example/svelte-native/remote/runtime");
    expect(result.cacheKey).toMatch(/^[0-9a-f]{64}$/);
    // Runes mode by default (D17): the app's components and the library's own, at the path an install puts them at; a Svelte library below node_modules keeps Svelte's own default.
    expect(result.modes).toEqual({
      app: "runes",
      library: "legacy",
      legacyLibrary: "legacy",
      legacyApp: "error: legacy_export_invalid",
      own: "runes",
    });
  });

  test("@example/svelte-native/expo and the bare package name: @expo/config-plugins loads the config plugin by either and runs it", () => {
    type Summary = { mods: string[]; remote: { origin: string }; pluginFile: string; isPluginFile: boolean; kind: string };
    const result = probe("expo.cjs") as { path: Summary; bare: Summary; same: boolean };
    for (const summary of [result.path, result.bare]) {
      expect(summary.mods).toEqual(["android", "ios"]);
      expect(summary.remote.origin).toBe("https://app.example.com");
      expect(summary.kind).toBe("function");
    }
    // The path is the built file through the exports map; the bare name is the package's `app.plugin.js` (what Expo looks for first), which hands out the same plugin.
    expect([result.path.pluginFile, result.path.isPluginFile]).toEqual([join(installed, "dist/node/expo.cjs"), false]);
    expect([result.bare.pluginFile, result.bare.isPluginFile]).toEqual([join(installed, "app.plugin.js"), true]);
    expect(result.same).toBe(true);
  });

  test("@example/svelte-native/vite: imported, and loaded by Vite's own config loader", () => {
    const result = probe("vite.mjs") as { config: string; plugins: string[]; direct: string[]; web: string[] };
    expect(result.config).toBe("native.vite.config.ts");
    expect(result.plugins).toEqual(["svelte-native"]);
    expect(result.direct).toEqual(["svelte-native"]);
    // The web target, in an app that has SvelteKit: the library's plugin and SvelteKit's.
    expect(result.web[0]).toBe("svelte-native:web");
    expect(result.web.some((name) => name?.startsWith("vite-plugin-sveltekit"))).toBe(true);
  });

  test("@example/svelte-native/lower and /routes are importable", () => {
    const result = probe("lower.mjs") as { routes: string[]; lowered: string };
    expect(result.routes).toEqual([]);
    expect(result.lowered).toContain("native-view");
  });
});

describe("in pnpm's default layout, where @expo/metro-config is only beside expo", () => {
  test("control: from the app, and from the package, a plain require cannot find it", () => {
    const fromApp = run(["-e", 'require("@expo/metro-config/babel-transformer")'], strict);
    expect(fromApp.exitCode).not.toBe(0);
    expect(fromApp.stderr).toContain("Cannot find module '@expo/metro-config/babel-transformer'");
    const fromPackage = run(["-e", 'require("module").createRequire(process.cwd() + "/node_modules/@example/svelte-native/package.json")("@expo/metro-config/babel-transformer")'], strict);
    expect(fromPackage.exitCode).not.toBe(0);
  });

  test("the transformer finds it through expo, whose directory is the only one that holds it", () => {
    const result = probe("transformer.cjs", strict) as { cacheKey: string; svelteImports: string[] };
    expect(result.cacheKey).toMatch(/^[0-9a-f]{64}$/);
    expect(result.svelteImports).toContain("svelte/internal/client");
    const path = run(["-e", 'console.log(require("@example/svelte-native/transformer").upstreamTransformerPath())'], strict).stdout.trim();
    expect(path).toBe(join(findPackage("@expo/metro-config", packageDirectory)?.directory ?? "", "build/babel-transformer.js"));
  });

  test("without expo it says so, by name", () => {
    const result = run(["-e", 'try { require("@example/svelte-native/transformer").upstreamTransformerPath(["/nonexistent"]); } catch (error) { console.log(error.message); }'], strict);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("needs `expo`");
  });
});

describe("an app that builds for native only: no @sveltejs/kit, no vite", () => {
  const bareInstalled = join(bare, "node_modules/@example/svelte-native");

  test("control: neither package can be resolved from the app or from the package", () => {
    for (const name of optionalPeers) {
      const result = run(["-e", `require.resolve(${JSON.stringify(`${name}/package.json`)})`], bare);
      expect([name, result.exitCode === 0]).toEqual([name, false]);
      const fromPackage = run(["-e", `require("module").createRequire(${JSON.stringify(`${bareInstalled}/package.json`)}).resolve(${JSON.stringify(`${name}/package.json`)})`], bare);
      expect([name, fromPackage.exitCode === 0]).toEqual([name, false]);
    }
  });

  test("both are optional peers in the manifest, and hermes-intl, which the app has to install itself, is a required one", () => {
    expect(manifest.peerDependenciesMeta["@sveltejs/kit"]).toEqual({ optional: true });
    expect(manifest.peerDependenciesMeta.vite).toEqual({ optional: true });
    expect(manifest.peerDependencies["hermes-intl"]).toBeDefined();
    expect(manifest.peerDependenciesMeta["hermes-intl"]).toBeUndefined();
  });

  test("the Metro integration and the transformer load, resolve and compile; what needs SvelteKit names it", () => {
    const result = probe("probe-metro.cjs", bare) as {
      routes: string; ordinary: string; kitFromRuntime: string; kitInternal: string; svelteImports: string[]; remoteModule: string; cacheKey: string;
    };
    expect(result.routes).toBe(join(bare, ".svelte-native/routes.app.ts"));
    expect(result.ordinary).toBe(`${bare}/src/a.ts::react-native-reanimated`);
    expect(result.svelteImports).toContain("svelte/internal/client");
    expect(result.cacheKey).toMatch(/^[0-9a-f]{64}$/);
    // The runtime's imports of SvelteKit's files, and a remote function module, are what need it.
    for (const message of [result.kitFromRuntime, result.kitInternal]) {
      expect(message).toContain("`@sveltejs/kit`, which is not installed");
      expect(message).toContain("pnpm add @sveltejs/kit@3.1.1");
    }
    expect(result.remoteModule).toContain("api.remote.ts is a remote function module");
    expect(result.remoteModule).toContain("needs `@sveltejs/kit`, which is not installed");
  });

  test("the Vite plugin's native target loads and works; its web target says SvelteKit is missing", () => {
    const result = probe("probe-vite.mjs", bare) as { native: string; web: string };
    expect(result.native).toBe("svelte-native");
    expect(result.web).toContain("The web target of svelteNative() (@example/svelte-native/vite) needs `@sveltejs/kit`, which is not installed");
  });

  test("the config plugin and the command line load", () => {
    const plugin = run(["-e", 'const { withPlugins } = require("@expo/config-plugins"); const config = withPlugins({ name: "a", slug: "a", android: { package: "io.e.a" }, ios: { bundleIdentifier: "io.e.a" }, _internal: { projectRoot: process.cwd() } }, ["@example/svelte-native"]); console.log(Object.keys(config.mods).sort().join())'], bare);
    // `@expo/config-plugins` is not linked into this app: the plugin's own `expo/config-plugins` is what it needs, and `expo` brings it.
    expect(plugin.stderr).not.toContain("@sveltejs/kit");
    const sync = run([join(bareInstalled, "dist/node/cli.js"), "sync"], bare);
    expect(sync.stderr + sync.exitCode).toMatch(/0$/);
    expect(existsSync(join(bare, ".svelte-native/routes.app.ts"))).toBe(true);
  });

  test("svelte-native doctor skips them: nothing about SvelteKit or Vite fails", () => {
    const result = run([join(bareInstalled, "dist/node/cli.js"), "doctor", "--json"], bare);
    const report = JSON.parse(result.stdout) as { checks: { group: string; status: string; message: string }[] };
    const skipped = report.checks.find((check) => check.message.startsWith("optional peer dependencies not installed"));
    expect(skipped?.message).toContain("@sveltejs/kit");
    expect(skipped?.message).toMatch(/\bvite\b/);
    expect(report.checks.filter((check) => check.status === "fail" && /@sveltejs\/kit|\bvite\b/.test(check.message))).toEqual([]);
    expect(report.checks.find((check) => check.message.includes("@sveltejs/kit@3.1.1: @sveltejs/kit is not installed (optional)"))?.status).toBe("skip");
  });

  test("Metro bundles a minimal app for Android: the page, the library's own .svelte.ts modules from node_modules, hermes-intl, and nothing of SvelteKit or Vite", () => {
    const expo = findPackage("expo", packageDirectory)?.directory ?? "";
    const output = join(scratch, "bundle");
    mkdirSync(join(output, "assets"), { recursive: true });
    const sync = run([join(bareInstalled, "dist/node/cli.js"), "sync"], bare);
    expect(sync.stderr + sync.exitCode).toMatch(/0$/);
    // `bun test` sets NODE_ENV=test, which Metro's transform cache is not keyed by: a production bundle, with a cache of its own. The packages are linked from this repository's
    // install, which is not under the app, so Metro is told to read it (a real install has them below the app).
    const env = { CI: "1", EXPO_NO_TELEMETRY: "1", NODE_ENV: "production", TMPDIR: mkdtempSync(join(scratch, "metro-")), SVELTE_NATIVE_TEST_PACKAGES: join(realpathSync(repositoryRoot), "node_modules") };
    const bundle = join(output, "index.android.bundle");
    const done = run([join(expo, "bin/cli"), "export:embed", "--platform", "android", "--dev", "false", "--minify", "false", "--reset-cache", "--entry-file", ".svelte-native/entry.ts", "--bundle-output", bundle, "--sourcemap-output", `${bundle}.map`, "--assets-dest", join(output, "assets")], bare, env);
    expect(done.stderr + done.stdout + done.exitCode).toMatch(/0$/);
    // The source map names the modules from the project root.
    const { sources } = JSON.parse(readFileSync(`${bundle}.map`, "utf8")) as { sources: string[] };
    const has = (pattern: RegExp) => sources.some((source) => pattern.test(source));
    expect(has(/^\/src\/routes\/\+mobile\.svelte$/)).toBe(true);
    expect(has(/^\/\.svelte-native\/routes\.app\.ts$/)).toBe(true);
    expect(has(/node_modules\/@example\/svelte-native\/src\/router\.svelte\.ts$/)).toBe(true);
    expect(has(/node_modules\/@example\/svelte-native\/src\/insets\.svelte\.ts$/)).toBe(true);
    expect(has(/hermes-intl\//)).toBe(true);
    expect(sources.filter((source) => /@sveltejs\/kit|\/vite\//.test(source))).toEqual([]);
  }, 240_000);

  test("svelte-check passes on an app that declares nothing of the library's: the package is in node_modules, its source is checked with the app's, and a mistake is still reported", () => {
    const check = findPackage("svelte-check", packageDirectory)?.directory ?? "";
    const result = run([join(check, "bin/svelte-check"), "--tsconfig", "tsconfig.json", "--output", "machine"], bare);
    const lines = result.stdout.split("\n");
    const errors = lines.filter((line) => / ERROR /.test(line));
    const files = errors.map((line) => /ERROR "([^"]+)"/.exec(line)?.[1]);
    // Only the control file has errors: the typed one (every documented prop and platform module) and the library's own source, which svelte-check reads from node_modules, have none.
    expect(files).toEqual(["types/negative.svelte", "types/negative.svelte"]);
    expect(errors.some((line) => line.includes("onPressChanged") && line.includes("does not exist"))).toBe(true);
    expect(errors.some((line) => line.includes("This comparison appears to be unintentional"))).toBe(true);
    expect(lines.some((line) => / COMPLETED \d+ FILES 2 ERRORS /.test(line))).toBe(true);
  }, 120_000);
});
