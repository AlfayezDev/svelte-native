import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runChecks } from "../../src/doctor/checks.ts";
import { patchedDependenciesOfYaml } from "../../src/doctor/declared.ts";
import { isRepositoryApp } from "../../src/doctor/index.ts";
import { patchesDirectory, patchFiles, patchKey, patchSpecs } from "../../src/doctor/patches.ts";
import { requirements } from "../../src/doctor/requirements.ts";
import { library, repository } from "./support/doctor-fixture.ts";

// The doctor and the repository it comes from: the patches in `patches/` are the ones the repository's own install applies, each has a doctor entry,
// the tools it asks for are the ones the repository names, and the example app passes it.

const read = (path: string) => readFileSync(join(repository, path), "utf8");
const packagePatches = "packages/expo-svelte/patches";

test("every patch file of the package is one the doctor knows, and every entry of the doctor has its file", () => {
  expect(patchesDirectory).toBe(join(repository, packagePatches));
  // The libraries the package carries (`vendored: true`) are patched in their copies (`vendor-patches/`), which no app declares: they have a spec and no file here.
  expect(patchFiles().map((patch) => patch.package)).toEqual(patchSpecs.filter((spec) => spec.vendored !== true).map((spec) => spec.package));
  expect(readdirSync(patchesDirectory).filter((file) => !file.endsWith(".patch"))).toEqual([]);
});

test("the repository declares each of them from the package, with the lockfile's hash of the file, and no copy is left at the root", () => {
  const declared = patchedDependenciesOfYaml(read("pnpm-workspace.yaml"));
  const lock = read("pnpm-lock.yaml");
  for (const patch of patchFiles()) {
    expect(declared.get(patchKey(patch)), patchKey(patch)).toBe(`${packagePatches}/${patch.file}`);
    expect(existsSync(join(repository, "patches", patch.file)), `patches/${patch.file}`).toBe(false);
    const hash = createHash("sha256").update(readFileSync(patch.path)).digest("hex");
    // The lockfile's `patchedDependencies` block: `key: hash`, a scoped name in quotes.
    expect(lock.includes(`  ${patchKey(patch)}: ${hash}`) || lock.includes(`  '${patchKey(patch)}': ${hash}`), `${patchKey(patch)}: ${hash} in pnpm-lock.yaml`).toBe(true);
  }
});

test("the patches left at the root are the repository's own: the example's, for a library the package does not use, and Svelte's compiler, for Bun", () => {
  const declared = patchedDependenciesOfYaml(read("pnpm-workspace.yaml"));
  const others = [...declared].filter(([key]) => !patchFiles().some((patch) => patchKey(patch) === key));
  // The versions are whatever the repository installs: the keys name the packages, and each file is named after its key.
  expect(others.map(([key]) => key.replace(/@[\w.-]+$/, ""))).toEqual(["react-native-live-direction", "svelte"]);
  for (const [key, file] of others) expect(file).toBe(`patches/${key}.patch`);
  expect(readdirSync(join(repository, "patches")).sort()).toEqual(others.map(([key]) => `${key}.patch`));
  // Svelte's is not an app's: an app's Metro transformer removes the compiler's refusals itself (`svelte-compiler.ts`), so the package ships no patch of Svelte and the doctor asks for none. The patch is only
  // for this repository's tests, which run under Bun, where no Node hook runs.
  expect(patchFiles().map((patch) => patch.package)).not.toContain("svelte");
  // Nothing of the library imports it or lists it: the patch fixes `I18nManager` for the production app's use of the library, which the example's smoke app stands in for.
  const sources = readdirSync(join(repository, "packages/expo-svelte/src"), { recursive: true, encoding: "utf8" }).filter((file) => /\.(ts|svelte)$/.test(file));
  for (const file of sources) expect(read(`packages/expo-svelte/src/${file}`), file).not.toContain("react-native-live-direction");
  expect(JSON.stringify(library)).not.toContain("react-native-live-direction");
});

test("the tools the doctor asks for are the ones the repository names", () => {
  const root = JSON.parse(read("package.json")) as { engines: { node: string }; packageManager: string; devEngines: { runtime: { version: string } } };
  // The repository's own range; the range for an app outside it (`requirements.node.app`) is not the repository's to name: doctor.test.ts holds it, and the test below holds the docs to it.
  expect(requirements.node.repository).toBe(`>=${root.engines.node}`);
  expect(root.devEngines.runtime.version).toBe(root.engines.node);
  expect(requirements.pnpm).toBe(`>=${root.packageManager.replace(/^pnpm@/, "")}`);
});

test("the example app, installed and patched by the repository, passes every check", () => {
  const checks = runChecks({
    appRoot: join(repository, "apps/qa"),
    packageRoot: join(repository, "packages/expo-svelte"),
    // The tools are asked about in doctor.test.ts (and the Node the app runs is not the one these tests run on); everything else is the repository's own install.
    node: requirements.node.repository.slice(2),
    pnpm: () => requirements.pnpm.slice(2),
    repository: true,
  });
  // The doctor reads the app's config (`libraries`) as Expo does, and Bun cannot run Expo's loader of an `app.config.ts` ("Expected CommonJS module to have a function wrapper"): the one
  // check that skips here is that, and the test below runs the shipped doctor on Node, which reads it.
  expect(checks.filter((entry) => entry.status !== "pass" && !entry.message.startsWith("could not read the app's config"))).toEqual([]);
  expect(checks.filter((entry) => entry.group === "patches")).toHaveLength(patchFiles().length);
  expect(checks.filter((entry) => entry.group === "peer dependencies").length).toBeGreaterThan(5);
});

describe("which Node the doctor holds an app to", () => {
  const packageRoot = join(repository, "packages/expo-svelte");

  test("the apps that are members of the repository's workspace are the repository's, examples/minimal and an app elsewhere are not", () => {
    expect(isRepositoryApp(join(repository, "apps/qa"), packageRoot)).toBe(true);
    expect(isRepositoryApp(join(repository, "apps/example"), packageRoot)).toBe(true);
    // Its own workspace root: it is the template of an app, built and checked outside the repository.
    expect(isRepositoryApp(join(repository, "examples/minimal"), packageRoot)).toBe(false);
    expect(isRepositoryApp(tmpdir(), packageRoot)).toBe(false);
  });

  test("the library installed in an app (node_modules/expo-svelte, or a link to a checkout) does not make the app the repository's", () => {
    const outside = mkdtempSync(join(tmpdir(), "doctor-scope-"));
    try {
      writeFileSync(join(outside, "package.json"), "{}\n");
      writeFileSync(join(outside, "pnpm-workspace.yaml"), "allowBuilds:\n  esbuild: true\n");
      // The installed copy: its directory is not `packages/<name>` of a workspace.
      const installed = join(outside, "node_modules/expo-svelte");
      mkdirSync(installed, { recursive: true });
      expect(isRepositoryApp(outside, installed)).toBe(false);
      // A `link:` to the checkout: the package is the repository's, the app is not in its workspace.
      mkdirSync(join(outside, "node_modules"), { recursive: true });
      rmSync(installed, { recursive: true });
      symlinkSync(packageRoot, installed);
      expect(isRepositoryApp(outside, packageRoot)).toBe(false);
      // An app under the repository's directory but with a workspace root of its own is not a member either.
      expect(isRepositoryApp(join(repository, "examples/minimal"), join(repository, "packages/expo-svelte"))).toBe(false);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  test("a directory that is not there is an app", () => {
    expect(isRepositoryApp(join(tmpdir(), "doctor-scope-missing"), packageRoot)).toBe(false);
  });
});

test.skipIf(!Bun.which("node"))("the shipped doctor, run on Node in the QA app, reads the libraries its config turns on and passes every check", () => {
  const result = Bun.spawnSync(["node", join(repository, "packages/expo-svelte/dist/node/cli.js"), "doctor", "--json"], { cwd: join(repository, "apps/qa") });
  const report = JSON.parse(result.stdout.toString()) as { ok: boolean; checks: { group: string; status: string; message: string }[] };
  const libraries = report.checks.find((entry) => entry.message.startsWith("libraries turned on:"));
  // The fifteen the QA app lists, and react-native-blob-util that react-native-pdf brings.
  expect(libraries?.status).toBe("pass");
  expect(libraries?.message).toContain("react-native-pdf");
  expect(libraries?.message).toContain("(react-native-blob-util: needed by another)");
  expect(report.checks.filter((entry) => entry.status === "fail")).toEqual([]);
});
