import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

// The package is installed by apps outside this repository, as a git dependency (`git+ssh://…#<tag>&path:packages/svelte-native`). What such an
// app gets is the package directory as `files` packs it: the JavaScript, the library's native modules and the one `expo-module.config.json`
// that links them. Nothing of the repository around it is there, so nothing in the manifest may point at it.
const root = resolve(import.meta.dirname, "../..");
const read = (path: string) => readFileSync(join(root, path), "utf8");
const manifest = JSON.parse(read("package.json")) as {
  files: string[];
  exports: Record<string, string | Record<string, string>>;
  bin: Record<string, string>;
  dependencies: Record<string, string>;
  peerDependencies: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
};
/** Every file the exports map and `bin` point at (an entry is a path, or a path per condition: `svelte-native-source` the sources, `types` the declarations in `dist/types`, `default` what runs). */
const entryFiles = [...Object.values(manifest.exports).flatMap((target) => (typeof target === "string" ? [target] : Object.values(target))), ...Object.values(manifest.bin)];
const config = JSON.parse(read("expo-module.config.json")) as {
  platforms: string[];
  android: { projects: { name: string; path: string; modules: string[] }[] };
  apple: { podspecPath: string[]; swiftModuleName: string[]; modules: string[]; appDelegateSubscribers: string[]; reactDelegateHandlers: string[] };
};

/** Every file below `directory` (relative to the package), skipping directories a build leaves. */
function filesUnder(directory: string): string[] {
  return readdirSync(join(root, directory), { withFileTypes: true }).flatMap((entry) => {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) return ["build", ".cxx", ".gradle", "Pods"].includes(entry.name) ? [] : filesUnder(path);
    return [path];
  });
}

describe("the manifest holds nothing that only resolves inside this repository", () => {
  test("no file:, link:, workspace: or catalog: specifier is installed by a dependent, and svelte is a peer", () => {
    for (const group of [manifest.dependencies, manifest.peerDependencies, manifest.optionalDependencies ?? {}])
      for (const [name, spec] of Object.entries(group)) expect([name, /^(file|link|workspace|catalog):/.test(spec)]).toEqual([name, false]);
    expect(Object.keys(manifest.dependencies)).not.toContain("svelte");
    expect(manifest.peerDependencies.svelte).toBe("5.56.7");
  });

  test("the entries are in the package, and package.json is an entry (tools that resolve a package's directory ask for it)", () => {
    expect(manifest.exports["./package.json"]).toBe("./package.json");
    for (const target of entryFiles) expect([target, existsSync(join(root, target))]).toEqual([target, true]);
  });

  test("the config plugin is reachable by the package's own name (app.plugin.js, which Expo looks for first) and by its path `/app.plugin`, both at the built file; `/expo`, which named that file up to 0.4.0-rc.6, is not an entry", () => {
    expect(manifest.exports["./expo"]).toBeUndefined();
    expect(manifest.exports["./app.plugin"]).toEqual({ "svelte-native-source": "./src/expo.ts", types: "./dist/types/expo.d.ts", default: "./app.plugin.js" });
    expect(manifest.files).toContain("dist/node");
    expect(manifest.files).toContain("dist/types");
    expect(manifest.files).toContain("app.plugin.js");
    expect(read("app.plugin.js")).toContain('from "./dist/node/expo.cjs"');
    expect([existsSync(join(root, "dist/node/expo.cjs")), existsSync(join(root, "src/expo.ts"))]).toEqual([true, true]);
  });

  // React Native's autolinking links a native module only from the app's own dependencies, so an app installs these itself: they are required peers, at an exact version where several of
  // them share a runtime, and not dependencies of the package. SvelteKit and Vite it may leave out. The Nitro runtime and MMKV are not among them: the library carries them (vendor/, below).
  test("hermes-intl, the SVG library and the two the web's crypto is made of are required peers, not dependencies; SvelteKit and Vite are optional", () => {
    for (const name of ["hermes-intl", "react-native-svg", "react-native-quick-crypto", "react-native-quick-base64"]) {
      expect([name, typeof manifest.peerDependencies[name]]).toEqual([name, "string"]);
      expect([name, manifest.peerDependenciesMeta?.[name]]).toEqual([name, undefined]);
      expect([name, manifest.dependencies[name]]).toEqual([name, undefined]);
    }
    for (const name of ["react-native-quick-crypto", "react-native-quick-base64"]) expect([name, manifest.peerDependencies[name]]).toEqual([name, expect.stringMatching(/^\d+\.\d+\.\d+$/)]);
    expect(manifest.peerDependenciesMeta?.["@sveltejs/kit"]).toEqual({ optional: true });
    expect(manifest.peerDependenciesMeta?.vite).toEqual({ optional: true });
  });

  test("the vendored packages are no peer, no dependency and no development dependency: an app's package.json lists the library and nothing beside it", () => {
    for (const name of ["react-native-mmkv", "react-native-nitro-modules"]) {
      expect([name, manifest.peerDependencies[name], manifest.peerDependenciesMeta?.[name], manifest.dependencies[name], (manifest as { devDependencies?: Record<string, string> }).devDependencies?.[name]]).toEqual([name, undefined, undefined, undefined, undefined]);
    }
  });

  test("the license is the repository's", () => {
    expect(read("LICENSE")).toBe(readFileSync(resolve(root, "../../LICENSE"), "utf8"));
  });
});

describe("expo-module.config.json links the package's native module, once", () => {
  const modules = readdirSync(join(root, "native"), { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name);

  test("the native code is one module, svelte-core, and it carries no config of its own (autolinking reads only the package's: a second one would be dead or link twice)", () => {
    expect(modules).toEqual(["svelte-core"]);
    expect(filesUnder("native").filter((file) => file.endsWith("/expo-module.config.json"))).toEqual([]);
  });

  test("each Gradle project keeps the name the rest of the Gradle build uses, at the module's android directory", () => {
    const withGradle = modules.filter((name) => existsSync(join(root, "native", name, "android/build.gradle"))).sort();
    expect(config.android.projects.map((project) => project.name).sort()).toEqual(withGradle);
    for (const project of config.android.projects) expect(project.path).toBe(`native/${project.name}/android`);
    expect(config.android.projects.map((project) => project.name)).toEqual(["svelte-core"]);
    expect(config.platforms).toEqual(["android", "apple"]);
  });

  test("every Android module class is defined where its package says", () => {
    for (const project of config.android.projects)
      for (const name of project.modules) {
        const file = `${project.path}/src/main/java/${name.replaceAll(".", "/")}.kt`;
        expect([file, existsSync(join(root, file))]).toEqual([file, true]);
        expect(read(file)).toContain(`class ${name.split(".").pop()} : Module()`);
      }
  });

  test("the one podspec under native/ is listed, and the Swift module name is its pod's", () => {
    const podspecs = filesUnder("native").filter((file) => file.endsWith(".podspec")).sort();
    expect([...config.apple.podspecPath].sort()).toEqual(podspecs);
    const definesModule = podspecs.filter((file) => /DEFINES_MODULE['"]\s*=>\s*['"]YES/.test(read(file))).map((file) => file.split("/").pop()?.replace(/\.podspec$/, ""));
    expect([...config.apple.swiftModuleName].sort()).toEqual(definesModule.sort());
    expect(config.apple.podspecPath).toEqual(["native/svelte-core/ios/SvelteCore.podspec"]);
    expect(config.apple.swiftModuleName).toEqual(["SvelteCore"]);
    // The Objective-C++ screens are in the same pod, their headers outside the Swift module: a C++ header cannot be in a Clang module Swift imports.
    expect(read("native/svelte-core/ios/SvelteCore.podspec")).toContain("s.project_header_files = 'screens/**/*.h'");
  });

  test("every Swift module, app delegate subscriber and React delegate handler is a class the pods define", () => {
    const swift = filesUnder("native").filter((file) => file.endsWith(".swift")).map(read).join("\n");
    for (const name of [...config.apple.modules, ...config.apple.appDelegateSubscribers, ...config.apple.reactDelegateHandlers]) expect(swift).toMatch(new RegExp(`class ${name}\\b`));
  });
});

describe("what `files` packs", () => {
  // The listing of the tool a dependent's install uses: pnpm packs a git dependency's directory with `files`, and npm's packlist is the same code.
  const packer = Bun.which("pnpm") ? ["pnpm", "pack", "--dry-run", "--json"] : ["npm", "pack", "--dry-run", "--json", "--ignore-scripts"];
  const run = Bun.spawnSync(packer, { cwd: root, stdout: "pipe", stderr: "pipe" });
  const parsed = JSON.parse(run.stdout.toString()) as { files: { path: string }[] } | { files: { path: string }[] }[];
  const listed = (Array.isArray(parsed) ? parsed[0] : parsed)?.files.map((file) => file.path) ?? [];

  test("the pack tool ran", () => {
    expect(run.exitCode).toBe(0);
    expect(listed.length).toBeGreaterThan(200);
  });

  test("it holds the JavaScript, every native module's sources and build files, the one linking config, the patches folder and the documents an app reads", () => {
    for (const path of [
      "package.json",
      "LICENSE",
      "README.md",
      "REFERENCE.md",
      "CHANGELOG.md",
      "expo-module.config.json",
      "app.plugin.js",
      "src/index.ts",
      "src/platform.ts",
      "src/cli.ts",
      "src/expo.ts",
      "native/svelte-core/android/build.gradle",
      "native/svelte-core/android/CMakeLists.txt",
      "native/svelte-core/android/src/main/cpp/OnLoad.cpp",
      "native/svelte-core/android/src/main/java/expo/modules/svelteengine/SvelteEngineModule.kt",
      "native/svelte-core/android/src/main/java/expo/modules/svelteupdates/SvelteUpdatesModule.kt",
      "native/svelte-core/android/src/main/java/expo/modules/svelteblur/SvelteBlurModule.kt",
      "native/svelte-core/android/src/main/java/expo/modules/sveltecore/SvelteFetchModule.kt",
      "native/svelte-core/ios/SvelteCore.podspec",
      "native/svelte-core/ios/fetch/SvelteFetchModule.swift",
      "native/svelte-core/ios/capture/SvelteCaptureSubscriber.swift",
      "native/svelte-core/ios/updates/SvelteUpdatesModule.swift",
      "native/svelte-core/ios/screens/Views/SvelteStackView.mm",
    ])
      expect([path, listed.includes(path)]).toEqual([path, true]);
    expect(listed.some((path) => path.startsWith("patches/"))).toBe(true);
    for (const project of config.android.projects) expect(listed.some((path) => path.startsWith(`${project.path}/src/main/`))).toBe(true);
    for (const target of entryFiles) expect([target, listed.includes(relative(".", target))]).toEqual([target, true]);
  });

  test("it holds no test, fixture, plan, specification or build output", () => {
    // A `build/` directory is a native build's output (`android/build`, `ios/build`) and is not packed; an Expo module's JavaScript is in `build/` and its config plugin's in `plugin/build/`, and a
    // vendored copy carries them (`vendor/expo-image/build/`).
    const nativeBuild = (path: string) => /(^|\/)(android|ios)\/build\//.test(path) || (/(^|\/)build\//.test(path) && !/^vendor\/(?:@[^/]+\/)?[^/]+\/(?:plugin\/)?build\//.test(path));
    const unwanted = listed.filter((path) => /^tests\/|(^|\/)test\/|(^|\/)(\.cxx|\.gradle|Pods)\//.test(path) || nativeBuild(path) || /(^|\/)(SPEC|NOTES|PLAN)\.md$/.test(path) || /\.test\.ts$/.test(path));
    expect(unwanted).toEqual([]);
    // The package's own documents; a vendored package brings its README and the VENDOR.md that says where it came from (checked below).
    expect(listed.filter((path) => path.endsWith(".md") && !path.startsWith("vendor/")).sort()).toEqual(["CHANGELOG.md", "README.md", "REFERENCE.md"]);
  });

  test("it holds the vendored packages whole, each with the license and the VENDOR.md that came with the copy (VENDORING.md)", () => {
    for (const name of ["react-native-mmkv", "react-native-nitro-modules"]) {
      // What the library's `imports` map points at (`#vendor/<name>`): the source Metro bundles and the declarations the type checker reads.
      for (const file of ["LICENSE", "VENDOR.md", "package.json", "android/build.gradle", "android/CMakeLists.txt", "react-native.config.js", "src/index.ts", name === "react-native-mmkv" ? "lib/index.d.ts" : "lib/typescript/index.d.ts"])
        expect([`vendor/${name}/${file}`, listed.includes(`vendor/${name}/${file}`)]).toEqual([`vendor/${name}/${file}`, true]);
      expect([name, listed.some((path) => path.startsWith(`vendor/${name}/cpp/`)), listed.some((path) => path.startsWith(`vendor/${name}/android/src/main/`))]).toEqual([name, true, true]);
    }
    // The generated code of MMKV (Nitro's codegen output, which the app does not run), the podspecs and the Swift of both, and Nitro's own iOS sources.
    for (const path of [
      "vendor/react-native-mmkv/NitroMmkv.podspec",
      "vendor/react-native-mmkv/nitro.json",
      "vendor/react-native-mmkv/nitrogen/generated/android/NitroMmkv+autolinking.cmake",
      "vendor/react-native-mmkv/nitrogen/generated/android/NitroMmkv+autolinking.gradle",
      "vendor/react-native-mmkv/nitrogen/generated/ios/NitroMmkv+autolinking.rb",
      "vendor/react-native-mmkv/ios/HybridMMKVPlatformContext.swift",
      "vendor/react-native-mmkv/android/src/main/java/com/margelo/nitro/mmkv/NitroMmkvPackage.java",
      "vendor/react-native-nitro-modules/NitroModules.podspec",
      "vendor/react-native-nitro-modules/nitro_pod_utils.rb",
      "vendor/react-native-nitro-modules/android/src/main/java/com/margelo/nitro/NitroModulesPackage.kt",
      "vendor/react-native-nitro-modules/ios/core/HybridObject.swift",
    ])
      expect([path, listed.includes(path)]).toEqual([path, true]);
  });

  test("the vendored LICENSE and VENDOR.md are the copy's own files, not the package's: the package's LICENSE is still the repository's", () => {
    expect(read("vendor/react-native-mmkv/LICENSE")).not.toBe(read("LICENSE"));
    expect(read("LICENSE")).toBe(readFileSync(resolve(root, "../../LICENSE"), "utf8"));
    for (const name of ["react-native-mmkv", "react-native-nitro-modules"]) expect(read(`vendor/${name}/VENDOR.md`)).toStartWith(`# ${name} `);
  });
});
