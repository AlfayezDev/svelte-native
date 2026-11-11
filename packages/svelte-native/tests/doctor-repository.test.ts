import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runChecks } from "../src/doctor/checks.ts";
import { patchedDependenciesOfYaml } from "../src/doctor/declared.ts";
import { isRepositoryApp } from "../src/doctor/index.ts";
import { patchesDirectory, patchFiles, patchKey, patchSpecs } from "../src/doctor/patches.ts";
import { requirements } from "../src/doctor/requirements.ts";
import { satisfies } from "../src/doctor/semver.ts";
import { library, repository } from "./doctor-fixture.ts";

// The doctor and the repository it comes from: the patches in `patches/` are the ones the repository's own install applies, each has a doctor entry,
// the tools it asks for are the ones the repository names, and the example app passes it.

const read = (path: string) => readFileSync(join(repository, path), "utf8");
const packagePatches = "packages/svelte-native/patches";

test("every patch file of the package is one the doctor knows, and every entry of the doctor has its file", () => {
  expect(patchesDirectory).toBe(join(repository, packagePatches));
  expect(patchFiles().map((patch) => patch.package)).toEqual(patchSpecs.map((spec) => spec.package));
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
  expect(others).toEqual([
    ["react-native-live-direction@0.1.1", "patches/react-native-live-direction@0.1.1.patch"],
    ["svelte@5.56.7", "patches/svelte@5.56.7.patch"],
  ]);
  expect(readdirSync(join(repository, "patches")).sort()).toEqual(["react-native-live-direction@0.1.1.patch", "svelte@5.56.7.patch"]);
  // Svelte's is not an app's: an app's Metro transformer removes the compiler's refusals itself (`svelte-compiler.ts`), so the package ships no patch of Svelte and the doctor asks for none. The patch is only
  // for this repository's tests, which run under Bun, where no Node hook runs.
  expect(patchFiles().map((patch) => patch.package)).not.toContain("svelte");
  // Nothing of the library imports it or lists it: the patch fixes `I18nManager` for the production app's use of the library, which the example's smoke app stands in for.
  const sources = readdirSync(join(repository, "packages/svelte-native/src"), { recursive: true, encoding: "utf8" }).filter((file) => /\.(ts|svelte)$/.test(file));
  for (const file of sources) expect(read(`packages/svelte-native/src/${file}`), file).not.toContain("react-native-live-direction");
  expect(JSON.stringify(library)).not.toContain("react-native-live-direction");
});

test("the README's table and YAML block name every patch with its version and file", () => {
  const readme = read("packages/svelte-native/README.md");
  for (const patch of patchFiles()) {
    const key = patch.package.startsWith("@") ? `"${patchKey(patch)}"` : patchKey(patch);
    expect(readme, `YAML entry of ${patch.file}`).toContain(`  ${key}: patches/svelte-native/${patch.file}\n`);
    expect(readme, `table row of ${patch.file}`).toContain(`| \`${patch.package}\` ${patch.version} |`);
  }
  expect(readme.match(/^ {2}"?[@\w/.-]+@[\w.-]+"?: patches\/svelte-native\//gm)).toHaveLength(patchFiles().length);
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
    packageRoot: join(repository, "packages/svelte-native"),
    // The tools are asked about in doctor.test.ts (and the Node the app runs is not the one these tests run on); everything else is the repository's own install.
    node: requirements.node.repository.slice(2),
    pnpm: () => requirements.pnpm.slice(2),
    repository: true,
  });
  expect(checks.filter((entry) => entry.status !== "pass")).toEqual([]);
  expect(checks.filter((entry) => entry.group === "patches")).toHaveLength(patchFiles().length);
  expect(checks.filter((entry) => entry.group === "peer dependencies").length).toBeGreaterThan(20);
});

describe("which Node the doctor holds an app to", () => {
  const packageRoot = join(repository, "packages/svelte-native");

  test("the apps that are members of the repository's workspace are the repository's, examples/minimal and an app elsewhere are not", () => {
    expect(isRepositoryApp(join(repository, "apps/qa"), packageRoot)).toBe(true);
    expect(isRepositoryApp(join(repository, "apps/example"), packageRoot)).toBe(true);
    // Its own workspace root: it is the template of an app, built and checked outside the repository.
    expect(isRepositoryApp(join(repository, "examples/minimal"), packageRoot)).toBe(false);
    expect(isRepositoryApp(tmpdir(), packageRoot)).toBe(false);
  });

  test("the library installed in an app (node_modules/@example/svelte-native, or a link to a checkout) does not make the app the repository's", () => {
    const outside = mkdtempSync(join(tmpdir(), "doctor-scope-"));
    try {
      writeFileSync(join(outside, "package.json"), "{}\n");
      writeFileSync(join(outside, "pnpm-workspace.yaml"), "allowBuilds:\n  esbuild: true\n");
      // The installed copy: its directory is not `packages/<name>` of a workspace.
      const installed = join(outside, "node_modules/@example/svelte-native");
      mkdirSync(installed, { recursive: true });
      expect(isRepositoryApp(outside, installed)).toBe(false);
      // A `link:` to the checkout: the package is the repository's, the app is not in its workspace.
      mkdirSync(join(outside, "node_modules/@example"), { recursive: true });
      rmSync(installed, { recursive: true });
      symlinkSync(packageRoot, installed);
      expect(isRepositoryApp(outside, packageRoot)).toBe(false);
      // An app under the repository's directory but with a workspace root of its own is not a member either.
      expect(isRepositoryApp(join(repository, "examples/minimal"), join(repository, "packages/svelte-native"))).toBe(false);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  test("a directory that is not there is an app", () => {
    expect(isRepositoryApp(join(tmpdir(), "doctor-scope-missing"), packageRoot)).toBe(false);
  });
});

describe("the guide tells an app which Node to use", () => {
  test("every place that tells a user the Node says the range the doctor holds an app to, and that Node 25 is not in it", () => {
    expect(requirements.node.app).toBe("^22.17.0 || ^24.3.0 || >=26.0.0");
    for (const file of ["README.md", "docs/10-getting-started/20-creating-a-project.md", "docs/60-appendix/10-adding-to-an-existing-expo-app.md", "docs/60-appendix/20-troubleshooting.md", "packages/svelte-native/README.md"]) {
      const text = read(file);
      expect(text, file).toContain("Node 24 LTS (24.3 or newer");
      expect(text, file).toContain("Node 22.17 or newer");
      expect(text, file).toContain("Node 26 or newer");
      expect(text, file).toContain("Node 25");
    }
    for (const file of ["README.md", "docs/10-getting-started/20-creating-a-project.md", "docs/60-appendix/10-adding-to-an-existing-expo-app.md", "packages/svelte-native/README.md"]) expect(read(file), file).toMatch(/Not Node 25|not Node 25/);
    // The first install of a Node 25 user stops, and the troubleshooting page says how it looks and what to do.
    const troubleshooting = read("docs/60-appendix/20-troubleshooting.md");
    expect(troubleshooting).toContain("ERR_PNPM_UNSUPPORTED_ENGINE");
    expect(troubleshooting).toContain('(current: {"node":"25.0.0"})');
    expect(troubleshooting).toContain("before `svelte-native init`");
    // The doctor's sample output in the package README prints the app's range, and the root README still tells a contributor the repository's own Node.
    const sample = /pass {2}node (\d+\.\d+\.\d+) \(needs ([^)]*)\)/.exec(read("packages/svelte-native/README.md"));
    expect(sample?.[2]).toBe(requirements.node.app);
    expect(satisfies(sample?.[1] ?? "", requirements.node.app)).toBe(true);
    expect(read("README.md")).toContain("Node 25, pnpm 12.3.4 (the `packageManager` field)");
    expect(read("README.md")).toContain(`Node ${requirements.node.repository.slice(2, 4)}, pnpm`);
  });
});
