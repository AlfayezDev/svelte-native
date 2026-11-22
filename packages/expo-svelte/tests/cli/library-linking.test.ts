import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { AutolinkingConfig } from "../../src/autolinking.ts";
import { splitLinks } from "../../src/autolinking.ts";
import { applyHeadlessSettings, applyPodfileAutolinkingExclude, applyPodfileVendoredLinking } from "../../src/expo.ts";
import { libraryLinks } from "../../src/libraries.ts";
import { alwaysLinkedPackages, linkVendored, optionalPackages, VendoredCollision, vendoredDependency, vendoredRoot } from "../../src/vendored.ts";
import { createProject } from "../support/project.ts";

/**
 * The optional libraries link only when the app turns them on (`src/libraries.ts`, VENDORING.md "Optional libraries"): React Native's config gets an entry for each library that is on
 * and none for the rest (an original that autolinking found of a library that is off is taken out), and Expo's autolinker is given the directory of each Expo module that is on. The
 * generated `settings.gradle` and Podfile carry the decision. The entries are the ones Expo printed for the installed packages (`fixtures/vendored-autolinking/`).
 */
const fixtures = resolve(import.meta.dirname, "fixtures/vendored-autolinking");
const optionalReference = (platform: "android" | "ios"): Record<string, { root: string; name: string; platforms: Record<string, unknown> }> => JSON.parse(readFileSync(join(fixtures, `expo-sdk57-optional-${platform}.json`), "utf8"));
const withRoot = (value: unknown, root: string): unknown => JSON.parse(JSON.stringify(value).replaceAll("$PACKAGE", root.replaceAll("\\", "\\\\")));

const reactNative = optionalPackages.filter((vendored) => vendored.optional?.kind === "react-native").map((vendored) => vendored.name);
const expoModules = optionalPackages.filter((vendored) => vendored.optional?.kind === "expo").map((vendored) => vendored.name);
const alwaysNames = alwaysLinkedPackages.map((vendored) => vendored.name);

const projects: { remove(): void }[] = [];
afterAll(() => { for (const project of projects) project.remove(); });
function app(dependencies: Record<string, string> = {}) {
  const project = createProject({ "package.json": JSON.stringify({ name: "app", dependencies: { "expo-svelte": "*", ...dependencies } }) }, "library-app-");
  projects.push(project);
  return project.directory;
}
const originalOf = (name: string, platform: "android" | "ios") => withRoot(optionalReference(platform)[name], `/app/node_modules/${name}`) as { root: string; name: string; platforms: Record<string, unknown> };

describe("linkVendored: the libraries that are on", () => {
  test("nothing on: the packages every app links, and no optional library", () => {
    for (const platform of ["android", "ios"] as const) {
      const linked = linkVendored({ root: app(), dependencies: {} }, platform);
      expect(Object.keys(linked.dependencies).sort()).toEqual([...alwaysNames].sort());
    }
  });

  test("a library that is on gets the entry Expo printed for the installed package, with the paths of the copy; the others have none", () => {
    for (const platform of ["android", "ios"] as const) {
      const on = ["react-native-maps", "react-native-webview", "react-native-fast-shadow"];
      const linked = linkVendored({ root: app(), dependencies: {} }, platform, undefined, on);
      const present = Object.keys(linked.dependencies).filter((name) => reactNative.includes(name));
      // react-native-fast-shadow has no iOS code, so Expo printed no entry for it.
      expect(present.sort(), platform).toEqual((platform === "android" ? on : on.filter((name) => name !== "react-native-fast-shadow")).sort());
      for (const name of present) {
        expect(JSON.stringify(linked.dependencies[name]), `${platform} ${name}`).toBe(JSON.stringify(withRoot(optionalReference(platform)[name], vendoredRoot(name))));
      }
    }
  });

  test("every optional React Native package has an entry on both platforms when it is on, and the Expo modules never do (Expo's own autolinker links them)", () => {
    for (const platform of ["android", "ios"] as const) {
      const linked = linkVendored({ root: app(), dependencies: {} }, platform, undefined, [...reactNative, ...expoModules]);
      for (const name of expoModules) expect([name, linked.dependencies[name]]).toEqual([name, undefined]);
      for (const vendored of optionalPackages.filter((candidate) => candidate.optional?.kind === "react-native")) {
        expect([platform, vendored.name, linked.dependencies[vendored.name]]).toEqual([platform, vendored.name, vendoredDependency(vendored, platform)]);
      }
    }
  });

  test("a library that needs another brings it: react-native-pdf is linked with react-native-blob-util", () => {
    const linked = linkVendored({ root: app(), dependencies: {} }, "android", undefined, ["react-native-pdf"]);
    expect(Object.keys(linked.dependencies).filter((name) => reactNative.includes(name)).sort()).toEqual(["react-native-blob-util", "react-native-pdf"]);
  });

  test("an original of a library that is off, found by autolinking all the same (a copy another package asked for), is taken out; one that is on is replaced by the library's", () => {
    for (const platform of ["android", "ios"] as const) {
      const originals = Object.fromEntries(["react-native-maps", "react-native-video", "react-native-webview"].map((name) => [name, originalOf(name, platform)]));
      const linked = linkVendored({ root: app(), dependencies: { ...originals, "react-native-get-random-values": { root: "/q", name: "react-native-get-random-values", platforms: {} } } }, platform, undefined, ["react-native-video"]);
      expect(Object.keys(linked.dependencies).filter((name) => !alwaysNames.includes(name)).sort()).toEqual(["react-native-get-random-values", "react-native-video"]);
      expect(linked.dependencies["react-native-video"]?.root).toBe(vendoredRoot("react-native-video"));
      expect(JSON.stringify(linked.dependencies)).not.toContain("/app/node_modules/");
    }
  });

  test("an app that lists a library itself is refused, whether the library is on or not, and the message says how to turn it on", () => {
    for (const on of [[], ["react-native-maps"]]) {
      const root = app({ "react-native-maps": "1.27.2" });
      let refused: unknown;
      try { linkVendored({ root, dependencies: { "react-native-maps": originalOf("react-native-maps", "android") } }, "android", undefined, on); } catch (error) { refused = error; }
      expect(refused).toBeInstanceOf(VendoredCollision);
      expect((refused as Error).message).toContain("includes react-native-maps 1.27.2; remove it from the app's dependencies (package.json)");
      expect((refused as Error).message).toContain('turn it on with `libraries: { "react-native-maps": true }` in the expo-svelte plugin\'s options');
    }
  });

  test("--link names are read in front of the command, which follows them", () => {
    expect(splitLinks(["--link", "react-native-maps", "--link", "expo-image", "node", "-e", "1"])).toEqual({ link: ["react-native-maps", "expo-image"], command: ["node", "-e", "1"] });
    expect(splitLinks(["node", "--link", "x"])).toEqual({ link: [], command: ["node", "--link", "x"] });
    expect(splitLinks([])).toEqual({ link: [], command: [] });
  });
});

describe("the commands settings.gradle and the Podfile run", () => {
  const node = Bun.which("node");
  const cli = resolve(import.meta.dirname, "../../src/cli.ts");
  const built = resolve(import.meta.dirname, "../../dist/node/cli.js");
  const printing = (config: unknown) => [node ?? "node", "-e", `process.stdout.write(JSON.stringify(${JSON.stringify(config)}))`];
  const run = (script: string, command: "android-autolinking" | "ios-autolinking", ...rest: string[]) => Bun.spawnSync([node ?? "node", script, command, ...rest], { cwd: import.meta.dirname });
  const names = (result: { stdout: Buffer }) => Object.keys((JSON.parse(result.stdout.toString()) as AutolinkingConfig).dependencies ?? {});

  for (const [label, script] of [["expo-svelte", cli], ["the shipped dist/node/cli.js", built]] as const) {
    describe.skipIf(!node)(label, () => {
      for (const platform of ["android", "ios"] as const) {
        const command = `${platform}-autolinking` as const;

        test(`${command}: no --link, no optional library`, () => {
          const result = run(script, command, ...printing({ root: app(), dependencies: { "react-native-maps": originalOf("react-native-maps", platform) } }));
          expect(result.exitCode).toBe(0);
          expect(names(result).filter((name) => !alwaysNames.includes(name))).toEqual([]);
        });

        test(`${command}: --link adds the entry of each library that is named, and takes out the original of one that is not`, () => {
          const config = { root: app(), dependencies: { "react-native-webview": originalOf("react-native-webview", platform) } };
          const result = run(script, command, "--link", "react-native-maps", "--link", "react-native-pdf", ...printing(config));
          expect(result.exitCode).toBe(0);
          expect(names(result).filter((name) => !alwaysNames.includes(name))).toEqual(["react-native-blob-util", "react-native-maps", "react-native-pdf"]);
          const printed = JSON.parse(result.stdout.toString()) as AutolinkingConfig;
          expect(JSON.stringify(printed.dependencies?.["react-native-maps"])).toBe(JSON.stringify(withRoot(optionalReference(platform)["react-native-maps"], vendoredRoot("react-native-maps"))));
        });

        test(`${command}: an app that lists a library is refused with the message that says how to turn it on, and prints no config`, () => {
          const root = app({ "react-native-webview": "13.16.1" });
          const result = run(script, command, ...printing({ root, dependencies: { "react-native-webview": originalOf("react-native-webview", platform) } }));
          expect(result.exitCode).toBe(1);
          expect(result.stderr.toString()).toContain('turn it on with `libraries: { "react-native-webview": true }`');
          expect(result.stdout.toString()).toBe("");
        });
      }
    });
  }
});

describe("settings.gradle", () => {
  const settings = "\nextensions.configure(com.facebook.react.ReactSettingsExtension) { ex ->\n  ex.autolinkLibrariesFromCommand(expoAutolinking.rnConfigCommand)\n}\nexpoAutolinking.useExpoModules()\n";

  test("no library on: the Expo modules are left out of Expo's autolinker, nothing is linked, and no search path is set", () => {
    const text = applyHeadlessSettings(settings, [], libraryLinks([]));
    for (const name of expoModules) expect(text).toContain(`"${name}"`);
    expect(text).toContain('def expoSvelteConfigCommand = ["node", expoSvelteCli, "android-autolinking"]');
    expect(text).not.toContain("searchPaths");
    expect(text).not.toContain("--link");
  });

  test("libraries on: --link for each React Native package, and the directory of each Expo module as a search path, after a `--` that ends the options of Expo's command", () => {
    const text = applyHeadlessSettings(settings, [], libraryLinks(["expo-image", "expo-video", "react-native-maps", "react-native-pdf"]));
    expect(text).toContain('def expoSvelteConfigCommand = ["node", expoSvelteCli, "android-autolinking", "--link", "react-native-blob-util", "--link", "react-native-maps", "--link", "react-native-pdf"]');
    expect(text).toContain('def expoSvelteExpoModules = ["expo-image", "expo-video"]');
    expect(text).toContain('expoAutolinking.searchPaths = ["--"] + expoSvelteExpoModules.collect { new File(expoSvelteLibrary, "vendor/" + it).toString() }');
    // The library's directory is found from the CLI's path: dist/node/cli.js is three levels below it.
    expect(text).toContain("def expoSvelteLibrary = new File(expoSvelteCli).getParentFile().getParentFile().getParentFile()");
    // The Expo modules that are on are not excluded, the others are.
    const excluded = /def expoSvelteExclude = \[(.*)\]/.exec(text)?.[1] ?? "";
    expect(excluded).not.toContain('"expo-image"');
    expect(excluded).not.toContain('"expo-video"');
    for (const name of ["expo-blur", "expo-conic-gradient", "expo-linear-gradient"]) expect(excluded).toContain(`"${name}"`);
    // The definitions come before the block that uses them, and the command cache is keyed on settings.gradle too, so a changed `libraries` runs it again.
    expect(text.indexOf("def expoSvelteExpoModules")).toBeLessThan(text.indexOf("extensions.configure"));
    expect(text).toContain('new File(settingsDir, "settings.gradle").toString())');
  });

  test("it is idempotent, and a changed `libraries` replaces the block", () => {
    const links = libraryLinks(["expo-image", "react-native-maps"]);
    const once = applyHeadlessSettings(settings, [], links);
    expect(applyHeadlessSettings(once, [], links)).toBe(once);
    expect(applyHeadlessSettings(once, [], libraryLinks([]))).toBe(applyHeadlessSettings(settings, [], libraryLinks([])));
    expect(applyHeadlessSettings(once, [], libraryLinks(["expo-video"]))).toBe(applyHeadlessSettings(settings, [], libraryLinks(["expo-video"])));
  });

  test("a settings.gradle a prebuild of 0.4.0-rc.9 or before wrote (its variables named svelteNative…) is written as this release writes it", () => {
    const links = libraryLinks(["expo-image", "react-native-maps"]);
    const once = applyHeadlessSettings(settings, [], links);
    const former = once.replaceAll("expoSvelte", "svelteNative");
    expect(former).not.toBe(once);
    expect(applyHeadlessSettings(former, [], links)).toBe(once);
  });
});

describe("the Podfile", () => {
  const podfile = `target 'App' do
  use_expo_modules!

  if ENV['EXPO_USE_COMMUNITY_AUTOLINKING'] == '1'
    config_command = ['node', '-e', "process.argv=['', '', 'config'];require('@react-native-community/cli').run()"];
  else
    config_command = ['node', 'expo-modules-autolinking', 'react-native-config', '--json', '--platform', 'ios']
  end

  config = use_native_modules!(config_command)
end
`;

  test("libraries on: use_expo_modules! gets the directory of each Expo module as a search path, and ios-autolinking a --link for each React Native package", () => {
    const links = libraryLinks(["expo-image", "react-native-maps"]);
    const text = applyPodfileVendoredLinking(applyPodfileAutolinkingExclude(podfile, [...links.expoOff], links.expo), links.reactNative);
    expect(text).toContain('expo_svelte_expo_modules = ["expo-image"]');
    expect(text).toContain("expo_svelte_library = File.dirname(`node --print \"require.resolve('expo-svelte/package.json')\"`)");
    expect(text).toContain("use_expo_modules!(exclude: expo_svelte_exclude, searchPaths: expo_svelte_expo_modules.map { |name| File.join(expo_svelte_library, 'vendor', name) })");
    expect(text).toContain("config_command = ['node', expo_svelte_cli, 'ios-autolinking', '--link', 'react-native-maps'] + config_command");
    // The list the call reads is defined before it; the Expo modules that are on are not in the exclude list.
    expect(text.indexOf("expo_svelte_library =")).toBeLessThan(text.indexOf("use_expo_modules!("));
    expect(/expo_svelte_exclude = \[(.*)\]/.exec(text)?.[1]).not.toContain('"expo-image"');
    expect(/expo_svelte_exclude = \[(.*)\]/.exec(text)?.[1]).toContain('"expo-video"');
  });

  test("nothing on: no search path and no --link; the Expo modules are excluded", () => {
    const links = libraryLinks([]);
    const text = applyPodfileVendoredLinking(applyPodfileAutolinkingExclude(podfile, [...links.expoOff], links.expo), links.reactNative);
    expect(text).toContain("use_expo_modules!(exclude: expo_svelte_exclude)");
    expect(text).not.toContain("searchPaths");
    expect(text).toContain("config_command = ['node', expo_svelte_cli, 'ios-autolinking'] + config_command");
  });

  test("it is idempotent over its own output, and a changed `libraries` is put in place by the next prebuild", () => {
    const prebuild = (contents: string, on: string[]) => {
      const links = libraryLinks(on);
      return applyPodfileVendoredLinking(applyPodfileAutolinkingExclude(contents, [...links.expoOff], links.expo), links.reactNative);
    };
    const first = prebuild(podfile, ["expo-image", "react-native-maps"]);
    expect(prebuild(first, ["expo-image", "react-native-maps"])).toBe(first);
    expect(prebuild(first, [])).toBe(prebuild(podfile, []));
    expect(prebuild(prebuild(podfile, []), ["expo-image", "react-native-maps"])).toBe(first);
  });

  test("a Podfile a prebuild of 0.4.0-rc.9 or before wrote (`svelte_native_exclude`) is written as this release writes it", () => {
    const links = libraryLinks(["expo-image", "react-native-maps"]);
    const first = applyPodfileVendoredLinking(applyPodfileAutolinkingExclude(podfile, [...links.expoOff], links.expo), links.reactNative);
    const former = first.replaceAll("expo_svelte", "svelte_native").replaceAll("expoSvelte", "svelteNative");
    expect(former).not.toBe(first);
    expect(applyPodfileVendoredLinking(applyPodfileAutolinkingExclude(former, [...links.expoOff], links.expo), links.reactNative)).toBe(first);
  });
});

describe("Expo's own autolinker finds the Expo modules that are on", () => {
  // The real command, from the repository's Expo, on the real copies: Expo's Gradle plugin builds `--exclude a --exclude b <search paths>`, and `--exclude` takes any number of values.
  const expoCommand = (platform: "android" | "apple", ...args: string[]) => {
    // From the showcase app, which has Expo installed and none of these libraries as a dependency: the ones found are the ones the search paths name.
    const result = spawnSync("node", ["--no-warnings", "--eval", "require('expo/bin/autolinking')", "expo-modules-autolinking", "resolve", "--platform", platform, "--json", ...args], { cwd: resolve(import.meta.dirname, "../../../../apps/example"), encoding: "utf8", maxBuffer: 1 << 26 });
    if (result.status !== 0) throw new Error(`expo-modules-autolinking: ${result.stderr}`);
    return (JSON.parse(result.stdout) as { modules: { packageName: string; projects?: { name: string; sourceDir: string }[]; pods?: { podName: string; podspecDir: string }[] }[] }).modules;
  };
  const found = (modules: { packageName: string }[]) => modules.map((module) => module.packageName).filter((name) => expoModules.includes(name)).sort();

  test("Android: after the `--` the generated block starts the search paths with, the directories are modules; without it Expo reads them as names to exclude and finds none", () => {
    const paths = ["expo-image", "expo-video"].map((name) => vendoredRoot(name));
    const modules = expoCommand("android", "--exclude", "expo-dev-client", "--exclude", "expo-updates", "--", ...paths);
    expect(found(modules)).toEqual(["expo-image", "expo-video"]);
    const image = modules.find((module) => module.packageName === "expo-image");
    expect(image?.projects?.[0]?.sourceDir).toBe(join(vendoredRoot("expo-image"), "android"));
    // Why the `--` is there.
    expect(found(expoCommand("android", "--exclude", "expo-dev-client", "--exclude", "expo-updates", ...paths))).toEqual([]);
  });

  test("Apple: the search paths come before the options in the command CocoaPods runs, and the same modules are found with their podspec directories", () => {
    const modules = expoCommand("apple", vendoredRoot("expo-blur"), vendoredRoot("expo-conic-gradient"), "--exclude", "expo-dev-client");
    expect(found(modules)).toEqual(["expo-blur", "expo-conic-gradient"]);
    expect(modules.find((module) => module.packageName === "expo-blur")?.pods).toEqual([{ podName: "ExpoBlur", podspecDir: join(vendoredRoot("expo-blur"), "ios") }]);
  });

  test("a module that is not named is not found: nothing else under vendor/ is looked at", () => {
    expect(found(expoCommand("android", "--exclude", "expo-dev-client", "--", vendoredRoot("expo-image")))).toEqual(["expo-image"]);
    expect(found(expoCommand("apple", vendoredRoot("expo-linear-gradient")))).toEqual(["expo-linear-gradient"]);
  });
});
