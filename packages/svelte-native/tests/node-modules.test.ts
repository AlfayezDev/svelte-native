import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { findPackage } from "../src/doctor/resolve.ts";

// The package is installed by apps outside this repository, so its code runs from a `node_modules`, where Node refuses to load TypeScript
// (`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`, Node 25 and 26). In this repository it works whatever is wrong, because the workspace link is
// not under `node_modules`. So this packs the package the way `files` ships it, unpacks it into `node_modules/@rasheed/svelte-native` of a scratch app
// and loads every entry a Node process loads with plain `node` (no Bun, no loader): the command line, the Metro config and transformer, the Expo
// config plugin and Vite's config.
const packageDirectory = resolve(import.meta.dirname, "..");
const fixture = join(import.meta.dirname, "fixtures/installed-app");
const manifest = JSON.parse(readFileSync(join(packageDirectory, "package.json"), "utf8")) as { dependencies: Record<string, string>; peerDependencies: Record<string, string> };

const node = Bun.which("node");
const scratch = realpathSync(mkdtempSync(join(tmpdir(), "svelte-native-installed-")));
const app = join(scratch, "app");
const installed = join(app, "node_modules/@rasheed/svelte-native");
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

/** What an install links at the top of the app's `node_modules`: the package's dependencies and the peers the app has, as real directories of this install. */
function link(name: string, from = packageDirectory): boolean {
  const found = findPackage(name, from);
  if (!found) return false;
  mkdirSync(dirname(join(app, "node_modules", name)), { recursive: true });
  symlinkSync(found.directory, join(app, "node_modules", name));
  return true;
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
  // The dependencies are installed with the package; the peers (those this repository has) by the app. `@expo/config-plugins` and `@expo/metro-config` are what Expo
  // brings to a hoisted install, and the tools the entries are loaded by.
  for (const name of [...Object.keys(manifest.dependencies), ...Object.keys(manifest.peerDependencies), "@expo/config-plugins", "@expo/metro-config"]) link(name);
});

/** Runs `node` in the scratch app. */
function run(args: string[]): { stdout: string; stderr: string; exitCode: number } {
  if (!node) throw new Error("node is not on the PATH: the entries Node loads are run with it");
  const result = Bun.spawnSync([node, ...args], { cwd: app, stdout: "pipe", stderr: "pipe", env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0" } });
  return { stdout: result.stdout.toString(), stderr: result.stderr.toString(), exitCode: result.exitCode ?? -1 };
}
const NOT_TYPESCRIPT = "ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING";
/** Runs a probe of the fixture and returns the JSON it printed; the run must have loaded everything without the TypeScript error. */
function probe(file: string): Record<string, unknown> {
  const result = run([file]);
  expect(result.stderr).not.toContain(NOT_TYPESCRIPT);
  expect(result.stderr + result.exitCode).toMatch(/0$/);
  return JSON.parse(result.stdout.trim().split("\n").pop() ?? "") as Record<string, unknown>;
}

describe("the package as it is packed", () => {
  test("ships the built JavaScript next to the sources, and the bin points at it", () => {
    for (const file of ["cli.js", "expo.cjs", "lower.js", "metro.cjs", "routes.js", "transformer.cjs", "vite.js"]) expect([file, existsSync(join(installed, "dist/node", file))]).toEqual([file, true]);
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

  test("@rasheed/svelte-native/metro: require, withSvelteNative on a minimal config, the route table written, the runtime files found in the package's src/", () => {
    const result = probe("metro.cjs") as Record<string, string>;
    expect(result.transformerPath).toBe(join(installed, "dist/node/transformer.cjs"));
    expect(result.lite).toBe(join(installed, "src/fabric/react-native-lite.ts"));
    expect(result.environment).toBe(join(installed, "src/environment.ts"));
    expect(result.rendererStub).toBe(join(installed, "src/fabric/renderer-stub.ts"));
    expect(result.initializeCore).toBe(join(installed, "src/init.ts"));
    // `svelte/*` is resolved from the entry of the svelte the app installed.
    expect(result.svelte).toBe(`${join(findPackage("svelte", packageDirectory)?.directory ?? "", "native-entry.js")}::svelte/internal/client`);
    expect(result.routes).toBe(join(app, ".svelte-native/routes.qa.ts"));
    expect(result.table).toContain("../src/routes/+mobile.svelte");
    expect(result.entry).toContain("createFabricApp");
  });

  test("@rasheed/svelte-native/transformer: the path Metro's worker requires compiles a .svelte file and a remote module", () => {
    const result = probe("transformer.cjs") as { exports: string[]; svelteImports: string[]; remote: string; cacheKey: string; resolvedFrom: string };
    expect(result.resolvedFrom).toBe(join(installed, "dist/node/transformer.cjs"));
    expect(result.exports).toEqual(["getCacheKey", "sourceOf", "transform"]);
    expect(result.svelteImports).toContain("@rasheed/svelte-native/renderer");
    expect(result.svelteImports).toContain("svelte/internal/client");
    expect(result.remote).toContain("@rasheed/svelte-native/remote/runtime");
    expect(result.cacheKey).toMatch(/^[0-9a-f]{64}$/);
  });

  test("@rasheed/svelte-native/expo: @expo/config-plugins loads the config plugin and runs it", () => {
    const result = probe("expo.cjs") as { mods: string[]; remote: { origin: string } };
    expect(result.mods).toEqual(["android", "ios"]);
    expect(result.remote.origin).toBe("https://app.example.com");
  });

  test("@rasheed/svelte-native/vite: imported, and loaded by Vite's own config loader", () => {
    const result = probe("vite.mjs") as { config: string; plugins: string[]; direct: string[] };
    expect(result.config).toBe("native.vite.config.ts");
    expect(result.plugins).toEqual(["svelte-native"]);
    expect(result.direct).toEqual(["svelte-native"]);
  });

  test("@rasheed/svelte-native/lower and /routes are importable", () => {
    const result = probe("lower.mjs") as { routes: string[]; lowered: string };
    expect(result.routes).toEqual([]);
    expect(result.lowered).toContain("native-view");
  });
});
