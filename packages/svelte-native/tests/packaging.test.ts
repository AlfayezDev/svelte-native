import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

// The package is installed by apps outside this repository, as a git dependency (`git+ssh://…#<tag>&path:packages/svelte-native`). What such an
// app gets is the package directory as `files` packs it: the JavaScript, the library's native modules and the one `expo-module.config.json`
// that links them. Nothing of the repository around it is there, so nothing in the manifest may point at it.
const root = resolve(import.meta.dirname, "..");
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
  });

  test("an app installs hermes-intl itself (React Native's autolinking links only its own dependencies); SvelteKit and Vite it may leave out", () => {
    expect(manifest.peerDependencies["hermes-intl"]).toBeDefined();
    expect(manifest.peerDependenciesMeta?.["hermes-intl"]).toBeUndefined();
    expect(manifest.dependencies["hermes-intl"]).toBeUndefined();
    expect(manifest.peerDependenciesMeta?.["@sveltejs/kit"]).toEqual({ optional: true });
    expect(manifest.peerDependenciesMeta?.vite).toEqual({ optional: true });
  });

  test("the license is the repository's", () => {
    expect(read("LICENSE")).toBe(readFileSync(resolve(root, "../../LICENSE"), "utf8"));
  });
});

describe("expo-module.config.json links every native module of the package, once", () => {
  const modules = readdirSync(join(root, "native"), { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name);

  test("the eight modules are there, and none of them carries a config of its own (autolinking reads only the package's: a second one would be dead or link twice)", () => {
    expect(modules.sort()).toEqual(["svelte-blur", "svelte-capture-ios", "svelte-core", "svelte-engine", "svelte-insets-ios", "svelte-navigation-ios", "svelte-screens-ios", "svelte-updates"]);
    expect(filesUnder("native").filter((file) => file.endsWith("/expo-module.config.json"))).toEqual([]);
  });

  test("each Gradle project keeps the name the rest of the Gradle build uses, at the module's android directory", () => {
    const withGradle = modules.filter((name) => existsSync(join(root, "native", name, "android/build.gradle"))).sort();
    expect(config.android.projects.map((project) => project.name).sort()).toEqual(withGradle);
    for (const project of config.android.projects) expect(project.path).toBe(`native/${project.name}/android`);
    expect(config.android.projects.map((project) => project.name)).toEqual(["svelte-engine", "svelte-updates", "svelte-blur", "svelte-core"]);
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

  test("every podspec under native/ is listed, and the Swift module names are exactly the pods that define a module", () => {
    const podspecs = filesUnder("native").filter((file) => file.endsWith(".podspec")).sort();
    expect([...config.apple.podspecPath].sort()).toEqual(podspecs);
    const definesModule = podspecs.filter((file) => /DEFINES_MODULE['"]\s*=>\s*['"]YES/.test(read(file))).map((file) => file.split("/").pop()?.replace(/\.podspec$/, ""));
    expect([...config.apple.swiftModuleName].sort()).toEqual(definesModule.sort());
    // The pod that is not a Swift module (the Objective-C++ screens) is still a pod: it has to be linked, and `import`ing it would not compile.
    expect(config.apple.swiftModuleName).not.toContain("SvelteScreensIOS");
    expect(config.apple.podspecPath).toContain("native/svelte-screens-ios/native/SvelteScreensIOS.podspec");
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
      "native/svelte-engine/android/build.gradle",
      "native/svelte-engine/android/CMakeLists.txt",
      "native/svelte-engine/android/src/main/cpp/OnLoad.cpp",
      "native/svelte-engine/android/src/main/java/expo/modules/svelteengine/SvelteEngineModule.kt",
      "native/svelte-updates/android/build.gradle",
      "native/svelte-blur/android/build.gradle",
      "native/svelte-core/android/build.gradle",
      "native/svelte-capture-ios/ios/SvelteCapture.podspec",
      "native/svelte-insets-ios/ios/SvelteInsets.podspec",
      "native/svelte-blur/ios/SvelteBlur.podspec",
      "native/svelte-core/ios/SvelteCore.podspec",
      "native/svelte-navigation-ios/ios/SvelteNavigation.podspec",
      "native/svelte-screens-ios/native/SvelteScreensIOS.podspec",
      "native/svelte-screens-ios/native/Views/SvelteStackView.mm",
      "native/svelte-updates/ios/SvelteUpdates.podspec",
    ])
      expect([path, listed.includes(path)]).toEqual([path, true]);
    expect(listed.some((path) => path.startsWith("patches/"))).toBe(true);
    for (const project of config.android.projects) expect(listed.some((path) => path.startsWith(`${project.path}/src/main/`))).toBe(true);
    for (const target of entryFiles) expect([target, listed.includes(relative(".", target))]).toEqual([target, true]);
  });

  test("it holds no test, fixture, plan, specification or build output", () => {
    const unwanted = listed.filter((path) => /^tests\/|(^|\/)test\/|(^|\/)(build|\.cxx|\.gradle|Pods)\//.test(path) || /(^|\/)(SPEC|NOTES|PLAN)\.md$/.test(path) || /\.test\.ts$/.test(path));
    expect(unwanted).toEqual([]);
    expect(listed.filter((path) => path.endsWith(".md")).sort()).toEqual(["CHANGELOG.md", "README.md", "REFERENCE.md"]);
  });
});
