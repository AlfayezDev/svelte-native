import { afterAll, describe, expect, test } from "bun:test";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { runChecks, type Check, type Context } from "../../src/doctor/checks.ts";
import { patchedDependenciesOfYaml } from "../../src/doctor/declared.ts";
import { parsePatch } from "../../src/doctor/hunks.ts";
import { formatReport, runDoctor } from "../../src/doctor/index.ts";
import { findPackage } from "../../src/doctor/resolve.ts";
import { expoPluginFinding, metroFinding, withoutJsComments } from "../../src/doctor/integration.ts";
import { patchFiles, patchKey, patchSpecs } from "../../src/doctor/patches.ts";
import { compareVersions, parseVersion, satisfies } from "../../src/doctor/semver.ts";
import { alwaysLinkedPackages, collisionMessage, optionalPackages, vendoredPackages, vendoredRoot } from "../../src/vendored.ts";
import { patchVersion, peerVersion } from "../support/versions.ts";
import { createProject } from "../support/project.ts";
import { library, makeFakeApp, repository, type FakeApp } from "./support/doctor-fixture.ts";

// `svelte-native doctor` against fake apps: node_modules stubs with patched and unpatched copies of the files the patches change (support/doctor-fixture.ts),
// the configs it reads, and the tools it asks about. The repository's own install is checked in doctor-repository.test.ts.

const apps: string[] = [];
afterAll(() => { for (const app of apps) rmSync(app, { recursive: true, force: true }); });

const tools = { node: "26.0.0", pnpm: () => "12.3.4" };
function check(options: FakeApp = {}, context: Partial<Context> = {}): { root: string; checks: Check[] } {
  const root = makeFakeApp(options);
  apps.push(root);
  return { root, checks: runChecks({ appRoot: root, packageRoot: join(repository, "packages/svelte-native"), ...tools, ...context }) };
}
const failed = (checks: Check[]) => checks.filter((entry) => entry.status === "fail");
const find = (checks: Check[], text: string) => checks.find((entry) => entry.message.includes(text));
const patchChecks = (checks: Check[]) => checks.filter((entry) => entry.group === "patches");
/** The package.json of an app that depends on the library and on these packages. */
const manifestWith = (dependencies: readonly string[]) => JSON.stringify({ name: "fake-app", dependencies: { [library.name]: "*", ...Object.fromEntries(dependencies.map((name) => [name, "*"])) } });

describe("an app that is set up", () => {
  const { checks } = check();

  test("passes every check", () => {
    expect(failed(checks)).toEqual([]);
    expect(checks.filter((entry) => entry.status === "unknown")).toEqual([]);
  });

  test("looks at every patch of the library, each as applied", () => {
    const patches = patchFiles();
    expect(patchChecks(checks).map((entry) => entry.status)).toEqual(patches.map(() => "pass"));
    for (const patch of patches) expect(find(checks, `${patchKey(patch)} applied`), patchKey(patch)).toBeDefined();
  });

  test("names the versions it found, the renderer build of Svelte among them", () => {
    expect(find(checks, `svelte ${peerVersion("svelte")} has the ./renderer export`)?.status).toBe("pass");
    expect(find(checks, `react-native ${peerVersion("react-native")} satisfies ${peerVersion("react-native")}`)?.status).toBe("pass");
    expect(find(checks, `expo ${peerVersion("expo")} satisfies ~${peerVersion("expo")}`)?.status).toBe("pass");
    expect(find(checks, `react ${peerVersion("react")} satisfies ${peerVersion("react")}`)?.status).toBe("pass");
    expect(find(checks, "node 26.0.0")?.status).toBe("pass");
    expect(find(checks, "pnpm 12.3.4")?.status).toBe("pass");
  });
});

describe("a patch that is not applied", () => {
  for (const patch of patchFiles()) {
    test(`${patchKey(patch)} fails alone, with what is missing and how to fix it`, () => {
      const { checks } = check({ unpatched: [patch.package] });
      const failures = failed(checks);
      expect(failures.map((entry) => entry.message)).toEqual([expect.stringContaining(`${patchKey(patch)} is not applied`)]);
      const [failure] = failures;
      expect(failure?.group).toBe("patches");
      expect(failure?.details?.length).toBeGreaterThan(0);
      // Declared in the app's pnpm-workspace.yaml, so the fix is to install again (and, failing that, to copy the library's patch over the app's).
      expect(failure?.fix).toContain("pnpm install");
      expect(failure?.fix).toContain(`node_modules/${library.name}/patches/${patch.file}`);
    });
  }

  test("every patch unapplied is a failure each", () => {
    const { checks } = check({ unpatched: "all" });
    expect(patchChecks(checks).map((entry) => entry.status)).toEqual(patchFiles().map(() => "fail"));
  });

  test("one that the app does not declare is told how to declare it", () => {
    const { checks } = check({ unpatched: ["@sveltejs/kit"], declared: false });
    const failure = find(checks, `@sveltejs/kit@${patchVersion("@sveltejs/kit")} is not applied`);
    expect(failure?.fix).toContain(`declare "@sveltejs/kit@${patchVersion("@sveltejs/kit")}: patches/svelte-native/@sveltejs__kit@${patchVersion("@sveltejs/kit")}.patch" under patchedDependencies`);
  });

  test("a patch declared at a file that is not there is told so", () => {
    const { checks } = check({ unpatched: ["@sveltejs/kit"], files: { [`patches/svelte-native/@sveltejs__kit@${patchVersion("@sveltejs/kit")}.patch`]: null } });
    expect(find(checks, `@sveltejs/kit@${patchVersion("@sveltejs/kit")} is not applied`)?.fix).toContain("which does not exist");
  });

  test("a package patched with an older copy of the patch is not applied as this version of the library has it", () => {
    // The kit shape is all there (the manifest skips the +mobile files and the warnings preprocessors do too), but a warning preprocessor's line is the older one: a hunk of the library's patch is not in the file.
    const { root } = check();
    const file = join(root, "node_modules/@sveltejs/kit/src/exports/vite/index.js");
    writeFileSync(file, readFileSync(file, "utf8").replace("if (!filename || filename.endsWith('.mobile.svelte')) return;\n\n\t\tconst basename = path.basename(filename);\n\t\tif (basename.startsWith('+page.')", "if (!filename || filename.endsWith('.mobile.svelte')) return; // older\n\n\t\tconst basename = path.basename(filename);\n\t\tif (basename.startsWith('+page.')"));
    const again = runChecks({ appRoot: root, packageRoot: join(repository, "packages/svelte-native"), ...tools });
    const failure = find(again, `@sveltejs/kit@${patchVersion("@sveltejs/kit")} is patched, but not with this version of the library's patch`);
    expect(failure?.status).toBe("fail");
    expect(failure?.details?.[0]).toContain("src/exports/vite/index.js: hunk");
    expect(failed(again)).toHaveLength(1);
  });

  test("a patch for another version of the package cannot apply", () => {
    const { checks } = check({ versions: { "@sveltejs/kit": "3.1.2" } });
    expect(find(checks, `@sveltejs/kit 3.1.2 is installed, the patch is for exactly ${patchVersion("@sveltejs/kit")}`)?.status).toBe("fail");
    expect(find(checks, `@sveltejs/kit 3.1.2 does not satisfy ${patchVersion("@sveltejs/kit")}`)?.status).toBe("fail");
  });

  test("a package that comes with expo is pinned by an override, not added as a dependency", () => {
    const { checks } = check({ versions: { "expo-modules-core": "57.0.25" } });
    const failure = find(checks, `expo-modules-core 57.0.25 is installed, the patch is for exactly ${patchVersion("expo-modules-core")}`);
    expect(failure?.status).toBe("fail");
    expect(failure?.fix).toContain(`\`overrides:\` with \`expo-modules-core: ${patchVersion("expo-modules-core")}\` in pnpm-workspace.yaml`);
    expect(failure?.fix).toContain("ERR_PNPM_UNUSED_PATCH");
    expect(failed(checks)).toHaveLength(1);
    // A package the app depends on itself is added the usual way.
    expect(find(check({ versions: { "@sveltejs/kit": "3.1.2" } }).checks, `@sveltejs/kit 3.1.2 is installed, the patch is for exactly ${patchVersion("@sveltejs/kit")}`)?.fix).toBe(`pnpm add @sveltejs/kit@${patchVersion("@sveltejs/kit")}`);
  });

  test("a package the app does not use needs no patch; one it must have is a failure when it is missing", () => {
    const optional = check({ without: ["@sveltejs/kit"] }).checks;
    expect(failed(optional)).toEqual([]);
    expect(find(optional, `@sveltejs/kit@${patchVersion("@sveltejs/kit")}: @sveltejs/kit is not installed (optional)`)?.status).toBe("skip");
    expect(find(optional, "optional peer dependencies not installed, nothing to check:")?.message).toContain("@sveltejs/kit");
    const required = check({ without: ["expo-modules-core"] }).checks;
    expect(failed(required).map((entry) => entry.message)).toEqual([`expo-modules-core@${patchVersion("expo-modules-core")}: expo-modules-core is not installed`]);
  });

  test("the packages the library carries have no patch file here: they are patched when the library is written, and the doctor looks at their files instead (the vendored packages' group)", () => {
    for (const name of ["react-native-gesture-handler", "react-native-reanimated", "react-native-worklets"]) {
      expect(patchFiles().some((patch) => patch.package === name), name).toBe(false);
      expect(patchSpecs.find((spec) => spec.package === name)?.vendored, name).toBe(true);
    }
  });

  test("expo-modules-core is found through expo, which the app depends on and it does not", () => {
    const { checks } = check({ without: ["expo", "expo-modules-core"] });
    expect(find(checks, `expo-modules-core@${patchVersion("expo-modules-core")}: expo-modules-core is not installed (expo is not either)`)?.status).toBe("fail");
    expect(find(checks, `expo is not installed (needs ~${peerVersion("expo")})`)?.status).toBe("fail");
  });
});

describe("the packages the library carries", () => {
  const vendoredChecks = (checks: Check[]) => checks.filter((entry) => entry.group === "vendored packages");

  test("an app that lists none passes, one line each for the packages every app links, naming the version that comes with the library, and one for the optional libraries", () => {
    const { checks } = check();
    for (const { name, version } of alwaysLinkedPackages) expect(find(checks, `${name} ${version} comes with ${library.name} (vendor/${name}); the app does not list it`)?.status, name).toBe("pass");
    expect(find(checks, `the ${optionalPackages.length} optional libraries come with ${library.name} (vendor/), at the versions it pins; the app lists none of them`)?.status).toBe("pass");
    // The libraries the app's config turns on are read from its config: a fake app has no Expo to read it with, which is said and does not fail the app.
    expect(vendoredChecks(checks).filter((entry) => entry.status !== "pass").map((entry) => [entry.status, entry.message])).toEqual([["skip", expect.stringContaining("could not read the app's config")]]);
    // The libraries the package patches in its own copies (`vendor-patches/`) are looked at there, each as applied.
    const patched = patchSpecs.filter((spec) => spec.vendored);
    expect(patched.length).toBeGreaterThan(0);
    for (const spec of patched) expect(find(checks, `${spec.package}: ${spec.does} (in ${library.name}'s copy)`)?.status, spec.package).toBe("pass");
    expect(vendoredChecks(checks)).toHaveLength(alwaysLinkedPackages.length + 2 + patched.length);
  });

  describe("the patches of a copy (vendor-patches/, applied by scripts/vendor.ts) are looked for in the copy's files", () => {
    const patched = ["react-native-gesture-handler", "react-native-reanimated", "react-native-worklets"];
    /** The files of each copy that the doctor's check reads (`shapes.ts`). */
    const shapeFiles: Record<string, string[]> = {
      "react-native-gesture-handler": ["apple/RNGestureHandlerManager.h", "apple/RNGestureHandlerManager.mm"],
      "react-native-reanimated": [
        "android/src/main/java/com/swmansion/reanimated/SvelteEngineHook.kt", "android/src/main/java/com/swmansion/reanimated/NativeProxy.kt", "android/src/main/cpp/reanimated/android/NativeProxy.cpp",
        "android/src/main/cpp/reanimated/android/NativeProxy.h", "scripts/validate-worklets-version.js", "src/featureFlags/staticFlags.json",
      ],
      "react-native-worklets": ["lib/module/runLoop/uiRuntime/requestAnimationFrame.js", "src/runLoop/uiRuntime/requestAnimationFrame.ts"],
    };
    /** A library directory with the repository's copies (the one that is edited as far as the doctor reads it: its package.json and the files of its patch), `edit` made to one file of it. */
    function libraryWith(name: string, file: string, edit: (text: string) => string) {
      const project = createProject({ "patches/.keep": "" }, "doctor-library-");
      apps.push(project.directory);
      for (const { name: copy } of vendoredPackages) {
        const directory = vendoredRoot(copy, project.directory);
        if (copy !== name) {
          // The others are the repository's copies as they are (a link: nothing writes to them), so only the one that is edited needs a copy of its own.
          mkdirSync(dirname(directory), { recursive: true });
          symlinkSync(vendoredRoot(copy), directory);
          continue;
        }
        for (const path of ["package.json", ...(shapeFiles[copy] ?? [])]) {
          const target = join(directory, path);
          mkdirSync(dirname(target), { recursive: true });
          cpSync(join(vendoredRoot(copy), path), target);
        }
      }
      const target = join(vendoredRoot(name, project.directory), file);
      writeFileSync(target, edit(readFileSync(target, "utf8")));
      return project.directory;
    }
    const cases: [string, string, string, string, string][] = [
      ["react-native-gesture-handler", "apple/RNGestureHandlerManager.mm", "registerRootViewGestureRecognizerIfAttachedBelow", "x", "RNGestureHandlerManager.mm"],
      ["react-native-reanimated", "src/featureFlags/staticFlags.json", '"ANDROID_SYNCHRONOUSLY_UPDATE_UI_PROPS": true', '"ANDROID_SYNCHRONOUSLY_UPDATE_UI_PROPS": false', "synchronous Android update off"],
      ["react-native-reanimated", "scripts/validate-worklets-version.js", "../../react-native-worklets/package.json", "react-native-worklets/package.json", "still looks for react-native-worklets by name"],
      ["react-native-worklets", "src/runLoop/uiRuntime/requestAnimationFrame.ts", "let frameRequested = false;", "", "does not request a native frame on demand"],
    ];
    for (const [name, file, from, to, said] of cases) {
      test(`${name}: ${file} without the patch fails the copy, naming what is missing`, () => {
        const packageRoot = libraryWith(name, file, (text) => text.replaceAll(from, to));
        const { checks } = check({}, { packageRoot });
        const failure = checks.find((entry) => entry.group === "vendored packages" && entry.status === "fail");
        expect(failure?.message).toBe(`${name} in ${library.name}'s copy is not patched: ${patchSpecs.find((spec) => spec.package === name)?.does}`);
        expect((failure?.details ?? []).join("\n")).toContain(said);
        expect(failure?.fix).toContain(`vendor/${name}`);
        expect(vendoredChecks(checks).filter((entry) => entry.status === "fail")).toHaveLength(1);
      });
    }
    test("every copy that has a patch is one the registry carries", () => {
      expect(patchSpecs.filter((spec) => spec.vendored).map((spec) => spec.package)).toEqual(expect.arrayContaining(patched));
      for (const name of patched) expect(vendoredPackages.some((vendored) => vendored.name === name), name).toBe(true);
    });
  });

  test("neither is a peer to ask for: an app without them in node_modules passes, and the Nitro runtime a package manager installed on its own is not a finding", () => {
    for (const name of vendoredPackages.map((vendored) => vendored.name)) expect([name, name in library.peerDependencies]).toEqual([name, false]);
    const { checks } = check({ files: { "node_modules/react-native-nitro-modules/package.json": JSON.stringify({ name: "react-native-nitro-modules", version: "0.99.0" }) } });
    expect(failed(checks)).toEqual([]);
  });

  test("an app that lists one fails, with the message of the config plugin and the command that removes it", () => {
    for (const { name } of vendoredPackages) {
      const { root, checks } = check({ files: { "package.json": manifestWith([name]) } });
      const failure = find(checks, `${name} is a dependency of the app`);
      expect([name, failure?.status, failure?.group]).toEqual([name, "fail", "vendored packages"]);
      expect(failure?.message).toBe(`${name} is a dependency of the app (${join(root, "package.json")}): ${collisionMessage([name], library.name)}`);
      expect(failure?.fix).toBe(`pnpm remove ${name}, then npx expo prebuild`);
      expect(failed(checks)).toHaveLength(1);
    }
    // In devDependencies too: the build links what the config command finds, wherever package.json lists it.
    const { checks } = check({ files: { "package.json": JSON.stringify({ name: "fake-app", dependencies: Object.fromEntries([library.name].map((name) => [name, "*"])), devDependencies: { "react-native-mmkv": "4.3.1" } }) } });
    expect(find(checks, "react-native-mmkv is a dependency of the app")?.status).toBe("fail");
  });

  test("a library installed without its vendor folder, or with another version of a copy, fails, naming it", () => {
    using incomplete = createProject({ "package.json": JSON.stringify({ name: library.name, version: "0.0.0" }), "patches/.keep": "" }, "doctor-library-");
    const { checks } = check({}, { packageRoot: incomplete.directory });
    expect(vendoredChecks(checks).slice(0, vendoredPackages.length).map((entry) => entry.status)).toEqual(vendoredPackages.map(() => "fail"));
    expect(vendoredChecks(checks)[0]?.message).toContain(`has no copy of ${vendoredPackages[0]?.name}`);
    expect(vendoredChecks(checks)[0]?.fix).toContain("install @alfayez/svelte-native again");
    using changed = createProject({ "patches/.keep": "", ...Object.fromEntries(vendoredPackages.map(({ name }) => [`vendor/${name}/package.json`, JSON.stringify({ name, version: "0.0.1" })])) }, "doctor-library-");
    const other = check({}, { packageRoot: changed.directory });
    expect(vendoredChecks(other.checks).slice(0, vendoredPackages.length).map((entry) => entry.message)).toEqual(vendoredPackages.map(({ name, version }) => `${vendoredRoot(name, changed.directory)} is ${name} 0.0.1, the library pins ${version}`));
  });
});

describe("what the library carries needs nothing of the app", () => {
  // `crypto` (react-native-quick-crypto and the base64 module it asks for), `Intl` (hermes-intl) and `localStorage` (MMKV, on the Nitro runtime) are vendored (`src/vendored.ts`): the doctor does not ask the app to
  // depend on them, which it did while they were peers that React Native's autolinking could link only from the app's own dependencies. An app that lists one fails (the packages the library carries, above).
  test("quick-crypto's peers, the Nitro runtime and quick-base64, are satisfied by the library's copies", () => {
    const peers = (JSON.parse(readFileSync(join(vendoredRoot("react-native-quick-crypto"), "package.json"), "utf8")) as { peerDependencies: Record<string, string> }).peerDependencies;
    for (const name of ["react-native-nitro-modules", "react-native-quick-base64"]) {
      const version = vendoredPackages.find((vendored) => vendored.name === name)?.version ?? "";
      expect(satisfies(version, peers[name] ?? ""), `quick-crypto asks for ${name} ${peers[name]}`).toBe(true);
    }
  });

  test("an app without hermes-intl, quick-crypto and quick-base64 in its dependencies or in node_modules passes, and says nothing about them in the peer dependencies", () => {
    const { checks } = check();
    expect(failed(checks)).toEqual([]);
    for (const name of ["hermes-intl", "react-native-quick-crypto", "react-native-quick-base64"]) {
      expect([name, name in library.peerDependencies]).toEqual([name, false]);
      expect([name, checks.filter((entry) => entry.group === "peer dependencies" && entry.message.includes(name))]).toEqual([name, []]);
    }
  });

  test("a copy of them that a package manager installed on its own (a dependency of another package) is not a finding", () => {
    const stray = Object.fromEntries(["hermes-intl", "react-native-quick-crypto", "react-native-quick-base64"].map((name) => [`node_modules/${name}/package.json`, JSON.stringify({ name, version: "0.0.1" })]));
    expect(failed(check({ files: stray }).checks)).toEqual([]);
  });
});

describe("expo's runtime", () => {
  test("an expo that has src/winter passes: the library's polyfills import it for the standard URL", () => {
    expect(find(check().checks, `expo ${peerVersion("expo")} has src/winter, the runtime (URL, fetch, TextDecoder) that the library's polyfills import`)?.status).toBe("pass");
  });

  test("an expo without it fails, with the files and the fix", () => {
    const { checks } = check({ files: { "node_modules/expo/src/winter/runtime.native.ts": null } });
    const failure = find(checks, `expo ${peerVersion("expo")} has no src/winter/runtime.native.ts`);
    expect(failure?.status).toBe("fail");
    expect(failure?.fix).toContain("npx expo install expo");
    expect(failed(checks)).toHaveLength(1);
  });

  test("no expo at all is the peer check's failure alone", () => {
    expect(failed(check({ without: ["expo", "expo-modules-core"] }).checks).some((entry) => entry.message.includes("src/winter"))).toBe(false);
  });
});

describe("SvelteKit and Vite are optional", () => {
  test("a native-only app, which has neither, passes: both are skipped, and so is SvelteKit's patch", () => {
    const { checks } = check({ without: ["@sveltejs/kit", "vite"] });
    expect(failed(checks)).toEqual([]);
    expect(find(checks, "optional peer dependencies not installed, nothing to check:")?.message).toContain("@sveltejs/kit, ");
    expect(find(checks, "optional peer dependencies not installed, nothing to check:")?.message).toContain("vite");
    expect(find(checks, `@sveltejs/kit@${peerVersion("@sveltejs/kit")}: @sveltejs/kit is not installed (optional), nothing to patch`)?.status).toBe("skip");
  });

  test("an app that has SvelteKit must have the version and the patch", () => {
    expect(find(check({ versions: { "@sveltejs/kit": "3.1.2" } }).checks, `@sveltejs/kit 3.1.2 does not satisfy ${peerVersion("@sveltejs/kit")}`)?.status).toBe("fail");
    expect(failed(check({ unpatched: ["@sveltejs/kit"] }).checks).map((entry) => entry.message)).toEqual([expect.stringContaining(`@sveltejs/kit@${peerVersion("@sveltejs/kit")} is not applied`)]);
  });
});

describe("finding an installed package", () => {
  test("in a hoisted install, in a workspace's root and, from a package's real directory, among the dependencies pnpm links beside it", () => {
    const root = makeFakeApp();
    apps.push(root);
    expect(findPackage("react-native", root)?.version).toBe(`${peerVersion("react-native")}`);
    expect(findPackage("react-native", join(root, "apps/deep/inside"))?.version).toBe(`${peerVersion("react-native")}`);
    expect(findPackage("not-installed", root)).toBeUndefined();
    // pnpm's own layout: the app links `expo`; `expo-modules-core` is only beside the real `expo`, in `.pnpm/expo@1/node_modules`.
    const isolated = makeFakeApp({ without: ["expo", "expo-modules-core"] });
    apps.push(isolated);
    const store = join(isolated, "node_modules/.pnpm/expo@1/node_modules");
    for (const [name, version] of [["expo", "57.0.30"], ["expo-modules-core", `${patchVersion("expo-modules-core")}`]] as const) {
      mkdirSync(join(store, name), { recursive: true });
      writeFileSync(join(store, name, "package.json"), JSON.stringify({ name, version }));
    }
    symlinkSync(join(store, "expo"), join(isolated, "node_modules/expo"));
    const expo = findPackage("expo", isolated);
    expect(expo?.directory).toBe(join(store, "expo"));
    expect(findPackage("expo-modules-core", isolated)).toBeUndefined();
    expect(findPackage("expo-modules-core", expo?.directory ?? "")?.version).toBe(`${patchVersion("expo-modules-core")}`);
  });
});

describe("versions", () => {
  test("react-native, expo and react must satisfy the library's peers", () => {
    const { checks } = check({ versions: { "react-native": "0.85.1", expo: "57.1.0", react: "19.2.6" } });
    expect(failed(checks).map((entry) => entry.message).sort()).toEqual([
      `expo 57.1.0 does not satisfy ~${peerVersion("expo")}`,
      `react 19.2.6 does not satisfy ${peerVersion("react")}`,
      `react-native 0.85.1 does not satisfy ${peerVersion("react-native")}`,
    ]);
    expect(find(checks, "react-native 0.85.1")?.fix).toBe(`pnpm add react-native@${peerVersion("react-native")}`);
  });

  test("an optional peer that is installed must match too", () => {
    const { checks } = check({ versions: { vite: "7.0.0" } });
    expect(find(checks, "vite 7.0.0 does not satisfy ^8.1.4")?.status).toBe("fail");
  });

  test("a peer that is not installed is a failure unless it is optional", () => {
    expect(find(check({ without: ["react"] }).checks, `react is not installed (needs ${peerVersion("react")})`)?.status).toBe("fail");
    // The packages the library carries (react-native-svg, ...) are no peer to ask for; an optional one such as tailwindcss is not.
    expect(find(check({ without: ["react-native-svg"] }).checks, "react-native-svg is not installed")).toBeUndefined();
    expect(find(check({ without: ["tailwindcss"] }).checks, "tailwindcss")?.status).not.toBe("fail");
  });

  test("a range it cannot read is not guessed", () => {
    expect(satisfies("1.2.3", "file:../x.tgz")).toBeUndefined();
    expect(satisfies("1.2.3", "git+ssh://git@example.com/x.git#v1")).toBeUndefined();
    expect(satisfies("not a version", "^1.0.0")).toBeUndefined();
  });

  test("semver ranges", () => {
    const table: [string, string, boolean][] = [
      ["57.0.30", "~57.0.27", true], ["57.0.26", "~57.0.27", false], ["57.1.0", "~57.0.27", false], ["8.1.4", "^8.1.4", true], ["8.9.0", "^8.1.4", true], ["9.0.0", "^8.1.4", false],
      ["0.2.1", "~0.2.1", true], ["0.3.0", "~0.2.1", false], ["0.2.5", "^0.2.1", true], ["0.3.0", "^0.2.1", false], ["0.0.4", "^0.0.3", false], ["19.2.7", "19.2.7", true], ["19.2.8", "19.2.7", false],
      ["3.0.0-next.27", "3.0.0-next.27", true], ["3.0.0-next.28", "3.0.0-next.27", false], ["3.0.0", "3.0.0-next.27", false], ["3.0.0-next.28", "^3.0.0-next.27", true], ["3.0.0-next.26", "^3.0.0-next.27", false],
      ["3.1.0-next.1", "^3.0.0-next.27", false], ["2.0.0-beta.1", "^1.0.0", false], ["1.5.0", "1.x", true], ["2.0.0", "1.x", false], ["1.2.9", "1.2", true], ["1.3.0", "1.2", false], ["5.0.0", "*", true],
      ["1.5.0", ">=1.2.0 <2.0.0", true], ["2.0.0", ">=1.2.0 <2.0.0", false], ["1.0.0", "^1.0.0 || ^2.0.0", true], ["2.4.0", "^1.0.0 || ^2.0.0", true], ["3.0.0", "^1.0.0 || ^2.0.0", false], ["1.5.0", ">= 1.2.0", true],
    ];
    for (const [version, range, expected] of table) expect(satisfies(version, range), `${version} in ${range}`).toBe(expected);
    const [a, b, c] = ["1.0.0-alpha", "1.0.0-alpha.1", "1.0.0"].map((text) => parseVersion(text));
    expect(a && b && c && [compareVersions(a, b), compareVersions(b, c), compareVersions(c, a)]).toEqual([-1, -1, 1]);
  });
});

describe("Svelte", () => {
  test("the stock build, without the renderer export, is a failure that names it", () => {
    const { checks } = check({ stockSvelte: true });
    const failure = find(checks, `svelte ${peerVersion("svelte")} is the stock Svelte: it has no ./renderer export`);
    expect(failure?.status).toBe("fail");
    expect(failure?.fix).toContain("custom-renderer build of Svelte");
  });

  test("an export that points at a file that is not there does not count", () => {
    const { checks } = check({ files: { "node_modules/svelte/src/renderer/index.js": null } });
    expect(find(checks, `svelte ${peerVersion("svelte")} is the stock Svelte`)?.status).toBe("fail");
  });

  test("a compiler without the customRenderer option does not count", () => {
    const { checks } = check({ files: { "node_modules/svelte/src/compiler/validate-options.js": "export const options = {};\n" } });
    expect(find(checks, "its compiler has no customRenderer option")?.status).toBe("fail");
  });

  test("a missing Svelte is a failure", () => {
    expect(find(check({ without: ["svelte"] }).checks, "svelte is not installed")?.status).toBe("fail");
  });
});

describe("the tools", () => {
  // An app outside the repository: the Node a fresh install of an `sv create` project accepts (requirements.ts).
  const accepted = ["22.17.0", "22.22.0", "24.3.0", "24.18.1", "26.0.0", "26.13.0"];
  const refused = ["20.19.4", "22.16.0", "24.2.0", "25.0.0", "25.9.0"];

  test("an app takes Node 22.17 and newer 22, Node 24.3 and newer 24, and Node 26 and newer", () => {
    for (const node of accepted) expect(find(check({}, { node }).checks, `node ${node} (needs ^22.17.0 || ^24.3.0 || >=26.0.0)`)?.status, node).toBe("pass");
  });

  test("an app on any other Node fails, with the Node to install, and Node 25 with why it is not one", () => {
    for (const node of refused) {
      const entry = find(check({}, { node }).checks, `node ${node} does not satisfy ^22.17.0 || ^24.3.0 || >=26.0.0`);
      expect(entry?.status, node).toBe("fail");
      expect(entry?.fix, node).toContain("Node 24 LTS (24.3 or newer");
      expect(entry?.fix, node).toContain("Node 25 is not supported");
      expect(entry?.fix, node).toContain("ERR_PNPM_UNSUPPORTED_ENGINE");
      expect(entry?.fix, node).not.toContain("25.0.0");
    }
  });

  test("the repository's own apps need the repository's Node, 25 or newer", () => {
    for (const node of ["25.0.0", "25.9.0", "26.13.0"]) expect(find(check({}, { node, repository: true }).checks, `node ${node} (needs >=25.0.0)`)?.status, node).toBe("pass");
    for (const node of ["22.22.0", "24.18.1"]) {
      const entry = find(check({}, { node, repository: true }).checks, `node ${node} does not satisfy >=25.0.0`);
      expect(entry?.status, node).toBe("fail");
      expect(entry?.fix, node).toContain("Node 25.0.0 or newer (the repository pins 25.0.0)");
      expect(entry?.fix, node).not.toContain("Node 24 LTS");
    }
  });

  test("a Node that cannot be found is not guessed, and the fix is the range's own", () => {
    const entry = find(check({}, { node: undefined }).checks, "could not run node");
    expect(entry?.status).toBe("unknown");
    expect(entry?.message).toContain("needs ^22.17.0 || ^24.3.0 || >=26.0.0");
    expect(entry?.fix).toContain("Node 24 LTS");
    const own = find(check({}, { node: undefined, repository: true }).checks, "could not run node");
    expect(own?.message).toContain("needs >=25.0.0");
    expect(own?.fix).toContain("Node 25.0.0 or newer");
  });

  test("an older pnpm fails and a pnpm that cannot run is not a guess", () => {
    expect(find(check({}, { pnpm: () => "10.8.0" }).checks, "pnpm 10.8.0 does not satisfy")?.status).toBe("fail");
    expect(find(check({}, { pnpm: () => undefined }).checks, "could not run pnpm")?.status).toBe("unknown");
  });
});

describe("the app's configs", () => {
  test("a Metro config without withSvelteNative could not be judged, and none at all is a failure", () => {
    expect(find(check({ files: { "metro.config.cjs": 'module.exports = require("./shared-metro.cjs");\n' } }).checks, "could not tell: metro.config.cjs does not mention withSvelteNative")?.status).toBe("unknown");
    const none = check({ files: { "metro.config.cjs": null } }).checks;
    expect(find(none, "no metro.config.js in the app")?.status).toBe("fail");
  });

  test("a withSvelteNative that is only in a comment does not count", () => {
    const text = `// module.exports = withSvelteNative(getDefaultConfig(__dirname));\n/* withSvelteNative */\nmodule.exports = getDefaultConfig(__dirname);\n`;
    expect(find(check({ files: { "metro.config.cjs": text } }).checks, "metro.config.cjs")?.status).toBe("unknown");
    expect(withoutJsComments("a // b\nc /* d */ e\nhttps://x.y // z")).toBe("a \nc  e\nhttps://x.y ");
  });

  test("the Expo plugin is looked for in app.json and in app.config", () => {
    const listed = check().checks;
    expect(find(listed, `app.json lists the ${library.name} plugin`)?.status).toBe("pass");
    const bare = check({ files: { "app.json": JSON.stringify({ expo: { plugins: ["expo-font"] } }) } }).checks;
    expect(find(bare, `app.json does not list the ${library.name} plugin`)?.status).toBe("fail");
    // `<library>/app.plugin` is the same file.
    const path = check({ files: { "app.json": JSON.stringify({ expo: { plugins: [`${library.name}/app.plugin`] } }) } }).checks;
    expect(find(path, `app.json lists the ${library.name}/app.plugin plugin`)?.status).toBe("pass");
    const code = check({ files: { "app.json": JSON.stringify({ expo: { plugins: [] } }), "app.config.ts": `export default ({ config }) => ({ ...config, plugins: [["${library.name}", {}]] });\n` } }).checks;
    expect(find(code, `app.config.ts lists the ${library.name} plugin`)?.status).toBe("pass");
    const dynamic = check({ files: { "app.json": JSON.stringify({ expo: { plugins: [] } }), "app.config.ts": "export default ({ config }) => ({ ...config, plugins: pluginsFor(process.env) });\n" } }).checks;
    expect(find(dynamic, "could not tell: app.config.ts does not name")?.status).toBe("unknown");
    const none = check({ files: { "app.json": null } }).checks;
    expect(find(none, "no app.json or app.config.* in the app")?.status).toBe("fail");
    // The bare form of app.json, without the `expo` key, is Expo's too.
    const unwrapped = check({ files: { "app.json": JSON.stringify({ plugins: [[library.name, {}]] }) } }).checks;
    expect(find(unwrapped, `app.json lists the ${library.name} plugin`)?.status).toBe("pass");
  });

  test("`<library>/expo`, removed in 0.4.0-rc.7, is an error that says to write the package's name in plugins: in app.json, as a tuple, in app.config, and beside the right name", () => {
    const removed = `${library.name}/expo`;
    const expected = (file: string) => ({ status: "fail", message: `${file} lists ${removed}, a path removed in 0.4.0-rc.7 that no longer resolves: expo prebuild fails on it`, fix: `write "${library.name}" in plugins in ${file}, in place of "${removed}"` });
    const asString = check({ files: { "app.json": JSON.stringify({ expo: { plugins: [removed] } }) } }).checks;
    expect(find(asString, removed)).toMatchObject(expected("app.json"));
    const tuple = check({ files: { "app.json": JSON.stringify({ expo: { plugins: ["expo-font", [removed, { androidProfileable: true }]] } }) } }).checks;
    expect(find(tuple, removed)).toMatchObject(expected("app.json"));
    const code = check({ files: { "app.json": JSON.stringify({ expo: { plugins: [] } }), "app.config.ts": `export default ({ config }) => ({ ...config, plugins: [["${removed}", {}]] });\n` } }).checks;
    expect(find(code, removed)).toMatchObject(expected("app.config.ts"));
    // The right name does not make the removed one resolve: expo prebuild still fails on it.
    const both = check({ files: { "app.json": JSON.stringify({ expo: { plugins: [library.name, removed] } }) } }).checks;
    expect(find(both, removed)?.status).toBe("fail");
    expect(find(both, `lists the ${library.name} plugin`)).toBeUndefined();
    // Nothing else of the build integration changes, and a config that does not list the removed path is as before.
    expect(find(asString, "uses withSvelteNative")?.status).toBe("pass");
    expect(find(check().checks, removed)).toBeUndefined();
  });

  test("the package's own name is the plugin as well (its app.plugin.js), in app.json and in app.config", () => {
    const named = check({ files: { "app.json": JSON.stringify({ expo: { plugins: [library.name] } }) } }).checks;
    expect(find(named, `app.json lists the ${library.name} plugin`)?.status).toBe("pass");
    const tuple = check({ files: { "app.json": JSON.stringify({ expo: { plugins: [[library.name, { androidProfileable: true }]] } }) } }).checks;
    expect(find(tuple, `app.json lists the ${library.name} plugin`)?.status).toBe("pass");
    const code = check({ files: { "app.json": JSON.stringify({ expo: { plugins: [] } }), "app.config.ts": `export default ({ config }) => ({ ...config, plugins: ["${library.name}"] });\n` } }).checks;
    expect(find(code, `app.config.ts lists the ${library.name} plugin`)?.status).toBe("pass");
    // Another package that starts with the name is not the plugin.
    const other = check({ files: { "app.json": JSON.stringify({ expo: { plugins: [`${library.name}-extra`] } }) } }).checks;
    expect(find(other, `app.json does not list the ${library.name} plugin`)?.status).toBe("fail");
  });

  test("the findings, directly", () => {
    const root = makeFakeApp();
    apps.push(root);
    expect(metroFinding(root)).toEqual({ state: "found", file: "metro.config.cjs" });
    expect(expoPluginFinding(root, library.name)).toEqual({ state: "found", file: "app.json", name: library.name });
  });

  test("an app that does not depend on the library is a failure", () => {
    const { checks } = check({ files: { "package.json": JSON.stringify({ name: "fake-app" }) } });
    expect(find(checks, `${library.name} is not a dependency of the app`)?.status).toBe("fail");
  });

  test("a directory that is not an app is one failure and nothing else", () => {
    const { checks } = check({ files: { "package.json": null } });
    expect(checks).toHaveLength(1);
    expect(checks[0]?.status).toBe("fail");
    expect(checks[0]?.message).toContain("has no package.json");
  });
});

describe("what is declared", () => {
  test("patchedDependencies of a pnpm-workspace.yaml, quoted or not, and what follows it", () => {
    const yaml = [
      "packages:", "  - apps/*", "patchedDependencies:", "# the library's patches", '  "@sveltejs/kit@3.0.0-next.27": packages/svelte-native/patches/kit.patch  # a comment', `  expo-modules-core@${patchVersion("expo-modules-core")}: 'patches/a b.patch'`,
      `  react-native-pdf@7.0.3: "patches/pdf.patch"`, "overrides:", "  other@1.0.0: patches/not-a-patch", "",
    ].join("\n");
    expect([...patchedDependenciesOfYaml(yaml)]).toEqual([
      ["@sveltejs/kit@3.0.0-next.27", "packages/svelte-native/patches/kit.patch"], [`expo-modules-core@${patchVersion("expo-modules-core")}`, "patches/a b.patch"], ["react-native-pdf@7.0.3", "patches/pdf.patch"],
    ]);
    expect(patchedDependenciesOfYaml("packages: []\n").size).toBe(0);
  });

  test("pnpm.patchedDependencies of the app's package.json counts too", () => {
    const key = `@sveltejs/kit@${patchVersion("@sveltejs/kit")}`;
    const { checks } = check({
      unpatched: ["@sveltejs/kit"], declared: false,
      files: { "package.json": JSON.stringify({ name: "fake-app", dependencies: { [library.name]: "*" }, pnpm: { patchedDependencies: { [key]: "patches/kit.patch" } } }), "patches/kit.patch": "" },
    });
    expect(find(checks, `${key} is not applied`)?.fix).toContain(`package.json declares ${key} (patches/kit.patch)`);
  });
});

describe("the patch files", () => {
  test("a file of the library parses into its files and hunks, a removed line that looks like a header included", () => {
    const patch = ["diff --git a/x.txt b/x.txt", "index 1..2 100644", "--- a/x.txt", "+++ b/x.txt", "@@ -1,3 +1,3 @@", " keep", "--- looks like a header", "+++ looks like a header", " end",
      "diff --git a/new.txt b/new.txt", "new file mode 100644", "--- /dev/null", "+++ b/new.txt", "@@ -0,0 +1,2 @@", "+one", "+two", "\\ No newline at end of file", ""].join("\n");
    expect(parsePatch(patch)).toEqual([
      { path: "x.txt", created: false, removed: false, hunks: [{ before: ["keep", "-- looks like a header", "end"], after: ["keep", "++ looks like a header", "end"] }] },
      { path: "new.txt", created: true, removed: false, hunks: [{ before: [], after: ["one", "two"] }] },
    ]);
  });

  test("every patch of the library parses, with hunks, and names a package the doctor knows", () => {
    for (const patch of patchFiles()) {
      const files = parsePatch(readFileSync(patch.path, "utf8"));
      expect(files.length, patch.file).toBeGreaterThan(0);
      for (const file of files) expect(file.hunks.length, `${patch.file}: ${file.path}`).toBeGreaterThan(0);
      expect(patchSpecs.some((spec) => spec.package === patch.package), patch.file).toBe(true);
    }
  });
});

describe("the report and the exit status", () => {
  const output = () => { const lines: string[] = []; return { lines, write: (text: string) => { lines.push(text); }, text: () => lines.join("") }; };

  test("a set-up app exits 0 and prints a line per check under its group", () => {
    const root = makeFakeApp();
    apps.push(root);
    const out = output();
    expect(runDoctor(root, [], out, { ...tools })).toBe(0);
    const text = out.text();
    expect(text).toContain(`svelte-native doctor: ${root}`);
    for (const group of ["environment", "svelte", "peer dependencies", "patches", "build integration"]) expect(text).toContain(`\n${group}\n`);
    expect(text).toContain(`  pass  @sveltejs/kit@${patchVersion("@sveltejs/kit")} applied: SvelteKit leaves the \`+mobile.svelte\` files of a route directory alone`);
    // The one skip is the libraries the app's config turns on: a fake app has no Expo to read the config with.
    expect(text).toMatch(/\d+ passed, 0 failed, 0 could not tell, 1 skipped\n$/);
    expect(text).not.toContain("\u001b[");
  });

  test("a failure exits 1, with its details and fix under it", () => {
    const root = makeFakeApp({ unpatched: ["@sveltejs/kit"], versions: { react: "19.0.0" } });
    apps.push(root);
    const out = output();
    expect(runDoctor(root, [], out, { ...tools })).toBe(1);
    const text = out.text();
    expect(text).toMatch(/ {2}FAIL {2}react 19\.0\.0 does not satisfy 19\.2\.7\n {8}fix: pnpm add react@19\.2\.7\n/);
    expect(text).toMatch(/ {2}FAIL {2}@sveltejs\/kit@3\.1\.1 is not applied: .*\n {8}src\/core\/sync\/create_manifest_data\/index\.js: does not skip the \+mobile files of a route directory\n(?: {8}.*\n)* {8}fix: /);
    expect(text).toMatch(/2 failed/);
  });

  test("a check that could not tell, or was skipped, does not fail it", () => {
    const root = makeFakeApp({ without: ["@sveltejs/kit"], files: { "metro.config.cjs": "module.exports = {};\n" } });
    apps.push(root);
    const out = output();
    expect(runDoctor(root, [], out, { ...tools })).toBe(0);
    expect(out.text()).toContain("  ????  could not tell: metro.config.cjs");
    expect(out.text()).toContain(`  skip  @sveltejs/kit@${patchVersion("@sveltejs/kit")}: @sveltejs/kit is not installed (optional)`);
  });

  test("--json prints the checks and whether they all hold", () => {
    const root = makeFakeApp({ unpatched: ["@sveltejs/kit"] });
    apps.push(root);
    const out = output();
    expect(runDoctor(root, ["--json"], out, { ...tools })).toBe(1);
    const parsed = JSON.parse(out.text()) as { ok: boolean; appRoot: string; checks: Check[] };
    expect(parsed.ok).toBe(false);
    expect(parsed.appRoot).toBe(root);
    expect(parsed.checks.filter((entry) => entry.status === "fail")).toHaveLength(1);
  });

  test("an argument it does not know exits 2 with the usage, and --help prints it", () => {
    const out = output();
    expect(runDoctor("/", ["--fix"], out)).toBe(2);
    expect(out.text()).toContain("Unknown argument --fix");
    expect(out.text()).toContain("Usage: svelte-native doctor [--json]");
    const help = output();
    expect(runDoctor("/", ["--help"], help)).toBe(0);
    expect(help.text()).toContain("Usage: svelte-native doctor [--json]");
  });

  test("the words are coloured only when asked", () => {
    const text = formatReport([{ group: "patches", status: "fail", message: "m", fix: "f" }], { color: true });
    expect(text).toContain("\u001b[31mFAIL\u001b[0m");
  });
});

describe("the command", () => {
  test("`svelte-native doctor` exits 1 for an app that is not set up, prints the report, and writes nothing into the app", () => {
    const node = Bun.which("node");
    if (!node) return;
    const root = makeFakeApp({ unpatched: "all", stockSvelte: true });
    apps.push(root);
    const run = Bun.spawnSync([node, join(repository, "packages/svelte-native/src/cli.ts"), "doctor"], { cwd: root, env: { ...process.env, NO_COLOR: "1" } });
    const out = run.stdout.toString();
    expect(out).toContain(`svelte-native doctor: ${root}`);
    expect(out).toContain("FAIL");
    expect(run.exitCode).toBe(1);
    // The sync that every other command makes first is not made: the doctor reads, it does not write.
    expect(existsSync(join(root, ".svelte-native"))).toBe(false);
  });
});
