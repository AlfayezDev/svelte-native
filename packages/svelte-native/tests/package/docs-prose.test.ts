import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { patchKey, patchFiles } from "../../src/doctor/patches.ts";
import { requirements } from "../../src/doctor/requirements.ts";
import { satisfies } from "../../src/doctor/semver.ts";

/** What the README and the guide tell a user, held to what the doctor holds an app to: the patches the package ships and the Node it runs on. It checks wording, so it lives with the docs and not with the doctor. */
const repository = resolve(import.meta.dirname, "../../../..");
const read = (path: string) => readFileSync(join(repository, path), "utf8");

test("the README's table and YAML block name every patch with its version and file", () => {
  const readme = read("packages/svelte-native/README.md");
  for (const patch of patchFiles()) {
    const key = patch.package.startsWith("@") ? `"${patchKey(patch)}"` : patchKey(patch);
    expect(readme, `YAML entry of ${patch.file}`).toContain(`  ${key}: patches/svelte-native/${patch.file}\n`);
    expect(readme, `table row of ${patch.file}`).toContain(`| \`${patch.package}\` ${patch.version} |`);
  }
  expect(readme.match(/^ {2}"?[@\w/.-]+@[\w.-]+"?: patches\/svelte-native\//gm)).toHaveLength(patchFiles().length);
});

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
  const pnpm = (JSON.parse(read("package.json")) as { packageManager: string }).packageManager.replace(/^pnpm@/, "");
  expect(read("README.md")).toContain(`Node ${requirements.node.repository.slice(2, 4)}, pnpm ${pnpm} (the \`packageManager\` field)`);
});
