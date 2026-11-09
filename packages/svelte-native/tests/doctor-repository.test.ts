import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { runChecks } from "../src/doctor/checks.ts";
import { patchedDependenciesOfYaml } from "../src/doctor/declared.ts";
import { patchesDirectory, patchFiles, patchKey, patchSpecs } from "../src/doctor/patches.ts";
import { requirements } from "../src/doctor/requirements.ts";
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

test("the one patch left at the root is the example's, for a library the package does not use", () => {
  const declared = patchedDependenciesOfYaml(read("pnpm-workspace.yaml"));
  const others = [...declared].filter(([key]) => !patchFiles().some((patch) => patchKey(patch) === key));
  expect(others).toEqual([["react-native-live-direction@0.1.1", "patches/react-native-live-direction@0.1.1.patch"]]);
  expect(readdirSync(join(repository, "patches"))).toEqual(["react-native-live-direction@0.1.1.patch"]);
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
  expect(requirements.node).toBe(`>=${root.engines.node}`);
  expect(root.devEngines.runtime.version).toBe(root.engines.node);
  expect(requirements.pnpm).toBe(`>=${root.packageManager.replace(/^pnpm@/, "")}`);
});

test("the example app, installed and patched by the repository, passes every check", () => {
  const checks = runChecks({
    appRoot: join(repository, "apps/example"),
    packageRoot: join(repository, "packages/svelte-native"),
    // The tools are asked about in doctor.test.ts (and the Node the app runs is not the one these tests run on); everything else is the repository's own install.
    node: requirements.node.slice(2),
    pnpm: () => requirements.pnpm.slice(2),
  });
  expect(checks.filter((entry) => entry.status !== "pass")).toEqual([]);
  expect(checks.filter((entry) => entry.group === "patches")).toHaveLength(patchFiles().length);
  expect(checks.filter((entry) => entry.group === "peer dependencies").length).toBeGreaterThan(20);
});
