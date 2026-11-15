import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { patchFiles } from "../../src/doctor/patches.ts";
import { satisfies } from "../../src/doctor/semver.ts";
import { appDependencies } from "../../src/init-app.ts";
import { requiredSvelte } from "../../src/svelte-build.ts";
import { readJson, useInitProjects } from "../cli/support/init-project.ts";

/**
 * What `svelte-native init` writes against what the repository says about it: `examples/minimal` (the app the library is exercised on) and the configuration page of the guide carry the
 * versions, the pnpm overrides and the scripts init writes, so a change to one that is not made to the others fails here. (`cli/init-app.test.ts` is init itself.)
 */
const repository = join(import.meta.dirname, "../../../..");
const { project, run } = useInitProjects();

describe("examples/minimal is what init writes", () => {
  test("examples/minimal's overrides are the ones init writes, and the React Native it pins is the one the override is", () => {
    const minimal = readFileSync(join(repository, "examples/minimal/pnpm-workspace.yaml"), "utf8");
    const root = project();
    run(root);
    const written = readFileSync(join(root, "pnpm-workspace.yaml"), "utf8");
    const block = (text: string) => /^overrides:\n((?: {2}\S.*\n)+)/m.exec(text)?.[1];
    expect(block(minimal)).toBeDefined();
    expect(block(minimal)).toBe(block(written));
    const pinned = JSON.parse(readFileSync(join(repository, "examples/minimal/package.json"), "utf8")) as { dependencies: Record<string, string> };
    expect(minimal).toContain(`  "@react-native/metro-config": ${pinned.dependencies["react-native"]}\n`);
  });

  test("the dependencies are examples/minimal's and inside the package's peer ranges, and the patched ones are the patches' versions", () => {
    const minimal = JSON.parse(readFileSync(join(repository, "examples/minimal/package.json"), "utf8")) as { dependencies: Record<string, string>; main: string; reanimated: unknown; scripts: Record<string, string> };
    for (const [name, version] of Object.entries(appDependencies)) expect(minimal.dependencies[name], name).toBe(version);
    const peers = (JSON.parse(readFileSync(join(import.meta.dirname, "../../package.json"), "utf8")) as { peerDependencies: Record<string, string> }).peerDependencies;
    for (const [name, version] of Object.entries(appDependencies)) expect(satisfies(version.replace(/^[\^~]/, ""), peers[name] ?? "*"), `${name} ${version} satisfies ${peers[name]}`).toBe(true);
    for (const patch of patchFiles().filter((entry) => ["react-native-gesture-handler", "react-native-reanimated", "react-native-worklets"].includes(entry.package))) {
      expect(appDependencies[patch.package]).toBe(patch.version);
    }
    expect(minimal.main).toBe(".svelte-native/entry.ts");
    // examples/minimal's script for the doctor has the name init gives it (`pnpm doctor` is pnpm's own command).
    expect(minimal.scripts["check-setup"]).toBe("svelte-native doctor");
  });
});

describe("the guide says what init writes", () => {
  test("the configuration page's snippets carry the versions, the patches and the Svelte build init writes", () => {
    const page = readFileSync(join(repository, "docs/70-reference/20-configuration.md"), "utf8");
    for (const [name, version] of Object.entries(appDependencies)) expect(page, name).toContain(`"${name}": "${version}"`);
    expect(page).toContain(`"svelte": "${requiredSvelte.preview}"`);
    expect(page).toContain('"main": ".svelte-native/entry.ts"');
    // The yaml of the page is the one a run writes for an sv project, from "overrides" on.
    const root = project();
    run(root);
    const written = readFileSync(join(root, "pnpm-workspace.yaml"), "utf8");
    const block = written.slice(written.indexOf("overrides:"));
    expect(page).toContain(block.trimEnd());
    // The kit pin and the scripts of the page are what the manifest has.
    const manifest = readJson(root, "package.json");
    expect(page).toContain(`"@sveltejs/kit": "${manifest.devDependencies["@sveltejs/kit"]}"`);
    for (const [name, command] of Object.entries(manifest.scripts as Record<string, string>)) if (/^(native|android|ios|check-setup)$/.test(name)) expect(page).toContain(`"${name}": "${command}"`);
  });
});
