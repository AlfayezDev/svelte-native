import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { withPlugins } from "@expo/config-plugins";
import { type AutolinkingConfig, deferNitroLibraries, deferredNitroPackages, nitroPackage } from "../../src/autolinking.ts";
import expoPlugin, { applyGradleSodium, applyPodfileSodium, applyPodfileVendoredLinking, assertNoVendoredOriginals } from "../../src/expo.ts";
import { collisionMessage, declaredVendored, linkVendored, VendoredCollision, vendoredDependency, vendoredPackages, vendoredRoot, type VendoredPackage } from "../../src/vendored.ts";
import { createProject } from "../support/project.ts";

/**
 * The crypto batch in React Native's autolinking and in the config plugin (VENDORING.md): react-native-quick-crypto, react-native-quick-base64 and hermes-intl. Their entries on both platforms are
 * compared with what Expo printed for the installed packages in `vendored-autolinking.test.ts` (`fixtures/vendored-autolinking/expo-sdk57-crypto-<platform>.json`); here are the fields that batch
 * is the first to need, the refusal of an app that lists one, the link to the vendored Nitro runtime and the `sodiumEnabled` option that moved from quick-crypto's own plugin.
 */
const names = ["react-native-quick-crypto", "react-native-quick-base64", "hermes-intl"] as const;
const entry = (name: string): VendoredPackage => {
  const found = vendoredPackages.find((vendored) => vendored.name === name);
  if (!found) throw new Error(`${name} is not vendored`);
  return found;
};
type AndroidEntry = { sourceDir: string; packageImportPath: string; packageInstance: string; libraryName?: string; componentDescriptors: string[]; cmakeListsPath: string; cxxModuleCMakeListsModuleName: string | null; cxxModuleCMakeListsPath: string | null; cxxModuleHeaderName: string | null; isPureCxxDependency: boolean };
const androidOf = (name: string) => vendoredDependency(entry(name), "android")?.platforms.android as AndroidEntry;
const iosOf = (name: string) => vendoredDependency(entry(name), "ios")?.platforms.ios as { podspecPath: string; version: string; configurations: unknown[]; scriptPhases: unknown[] };
const read = (name: string, path: string) => readFileSync(join(vendoredRoot(name), path), "utf8");
/** What an entry of a printed config says for a platform; throws when the config has none (an entry's absence is the finding). */
function platformOf<Fields>(config: AutolinkingConfig, name: string, platform: "android" | "ios"): Fields {
  const found = config.dependencies?.[name]?.platforms?.[platform];
  if (found === undefined || found === null) throw new Error(`the config has no ${platform} entry for ${name}`);
  return found as Fields;
}
const rootOf = (config: AutolinkingConfig, name: string): string | undefined => (config.dependencies?.[name] as { root?: string } | undefined)?.root;

const projects: { remove(): void }[] = [];
afterAll(() => { for (const project of projects) project.remove(); });
function app(dependencies: Record<string, string> = {}) {
  const project = createProject({ "package.json": JSON.stringify({ name: "app", dependencies: { "@alfayez/svelte-native": "*", ...dependencies } }) }, "vendored-crypto-");
  projects.push(project);
  return project.directory;
}

describe("the three are in the registry, with what autolinking prints for them", () => {
  test("the Android entries: the ReactPackage, the codegen library name, and for hermes-intl the pure C++ TurboModule's CMake module", () => {
    expect(androidOf("react-native-quick-crypto")).toMatchObject({ packageImportPath: "import com.margelo.nitro.quickcrypto.QuickCryptoPackage;", packageInstance: "new QuickCryptoPackage()", libraryName: "QuickCrypto", componentDescriptors: [], cxxModuleCMakeListsModuleName: null, cxxModuleCMakeListsPath: null, cxxModuleHeaderName: null, isPureCxxDependency: false });
    expect(androidOf("react-native-quick-base64")).toMatchObject({ packageImportPath: "import com.reactnativequickbase64.QuickBase64Package;", packageInstance: "new QuickBase64Package()", libraryName: "QuickBase64", componentDescriptors: [], cxxModuleCMakeListsPath: null });
    expect(androidOf("hermes-intl")).toMatchObject({ packageImportPath: "import dev.hermesintl.HermesIntlPackage;", packageInstance: "new HermesIntlPackage()", libraryName: "HermesIntlSpec", componentDescriptors: [], isPureCxxDependency: false });
    for (const name of names) {
      const android = androidOf(name);
      // The Gradle project is `:<name>` (settings.gradle gets it from `sourceDir`), in the copy; the codegen CMake file is below the copy's android/build/, where React Native's Gradle plugin writes it.
      expect([name, android.sourceDir]).toEqual([name, join(vendoredRoot(name), "android")]);
      expect([name, android.cmakeListsPath]).toEqual([name, join(vendoredRoot(name), "android/build/generated/source/codegen/jni/CMakeLists.txt")]);
    }
    const intl = androidOf("hermes-intl");
    expect([intl.cxxModuleCMakeListsModuleName, intl.cxxModuleCMakeListsPath, intl.cxxModuleHeaderName]).toEqual(["hermesintl", join(vendoredRoot("hermes-intl"), "android/CMakeLists.txt"), "NativeHermesIntl"]);
    // What the registry says is what the copy has: the CMake file defines the module's target, the header it names exists, the codegen name is the manifest's or the `react { }` block's.
    expect(read("hermes-intl", "android/CMakeLists.txt")).toContain("add_library(hermesintl STATIC");
    expect(existsSync(join(vendoredRoot("hermes-intl"), "cpp", `${intl.cxxModuleHeaderName}.h`))).toBe(true);
    expect(JSON.parse(read("hermes-intl", "package.json")).codegenConfig.name).toBe("HermesIntlSpec");
    expect(read("react-native-quick-crypto", "android/build.gradle")).toContain('libraryName = "QuickCrypto"');
    expect(read("react-native-quick-base64", "android/build.gradle")).toContain('libraryName = "QuickBase64"');
  });

  test("the iOS entries: the podspec at the copy's root, and the version of the package", () => {
    for (const [name, podspec] of [["react-native-quick-crypto", "QuickCrypto.podspec"], ["react-native-quick-base64", "react-native-quick-base64.podspec"], ["hermes-intl", "HermesIntl.podspec"]] as const) {
      const ios = iosOf(name);
      expect([name, ios.podspecPath]).toEqual([name, join(vendoredRoot(name), podspec)]);
      expect([name, ios.version]).toEqual([name, entry(name).version]);
      expect([name, ios.configurations, ios.scriptPhases]).toEqual([name, [], []]);
      expect([name, existsSync(ios.podspecPath)]).toEqual([name, true]);
    }
    // The pod's own name is what other pods ask for: quick-crypto's is `QuickCrypto`, hermes-intl's `HermesIntl`.
    expect(read("react-native-quick-crypto", "QuickCrypto.podspec")).toContain('s.name         = "QuickCrypto"');
    expect(read("hermes-intl", "HermesIntl.podspec")).toContain('s.name         = "HermesIntl"');
  });

  test("hermes-intl's react-native.config.js says what the registry does (a C++ TurboModule's CMake module and header), so a change in a new version fails here", () => {
    const config = read("hermes-intl", "react-native.config.js");
    expect(config).toContain("cxxModuleCMakeListsModuleName: 'hermesintl'");
    expect(config).toContain("cxxModuleCMakeListsPath: 'CMakeLists.txt'");
    expect(config).toContain("cxxModuleHeaderName: 'NativeHermesIntl'");
  });

  test("the library's own autolinking adds all three on both platforms, beside what the app's autolinking found", () => {
    for (const platform of ["android", "ios"] as const) {
      const root = app();
      const linked = linkVendored({ root, dependencies: { "react-native-get-random-values": { root: "/app/node_modules/react-native-get-random-values", name: "react-native-get-random-values", platforms: {} } } }, platform);
      for (const name of names) {
        const dependency = linked.dependencies?.[name] as { root: string; name: string } | undefined;
        expect([platform, name, dependency?.root, dependency?.name]).toEqual([platform, name, vendoredRoot(name), name]);
      }
      expect(Object.keys(linked.dependencies ?? {})).toContain("react-native-get-random-values");
    }
  });
});

describe("the refusal of an app that lists one of them", () => {
  for (const name of names) {
    test(`${name}: the config plugin's check, linkVendored and the message name it, with the version that comes with the library`, () => {
      const version = entry(name).version;
      const message = collisionMessage([name]);
      expect(message).toStartWith(`@alfayez/svelte-native includes ${name} ${version}; remove it from the app's dependencies (package.json)`);
      const root = app({ [name]: version });
      expect(declaredVendored(root)).toEqual([name]);
      expect(() => assertNoVendoredOriginals(root)).toThrow(message);
      for (const platform of ["android", "ios"] as const) {
        const original = { root: `/app/node_modules/${name}`, name, platforms: { [platform]: { sourceDir: `/app/node_modules/${name}/android` } } };
        let refused: unknown;
        try { linkVendored({ root, dependencies: { [name]: original } }, platform); } catch (error) { refused = error; }
        expect([name, platform, refused instanceof VendoredCollision]).toEqual([name, platform, true]);
        expect((refused as VendoredCollision).names).toEqual([name]);
      }
    });
  }

  test("an original that autolinking found without the app listing it (quick-base64, which a package manager installs for the Buffer package) is replaced by the copy, once", () => {
    for (const platform of ["android", "ios"] as const) {
      const root = app();
      const original = { root: "/app/node_modules/react-native-quick-base64", name: "react-native-quick-base64", platforms: { [platform]: { sourceDir: "/app/node_modules/react-native-quick-base64/android", podspecPath: "/app/node_modules/react-native-quick-base64/react-native-quick-base64.podspec" } } };
      const linked = linkVendored({ root, dependencies: { "react-native-quick-base64": original } }, platform);
      expect(rootOf(linked, "react-native-quick-base64")).toBe(vendoredRoot("react-native-quick-base64"));
      expect(Object.keys(linked.dependencies ?? {}).filter((name) => name === "react-native-quick-base64")).toHaveLength(1);
      expect(JSON.stringify(linked)).not.toContain("/app/node_modules/");
    }
  });
});

describe("quick-crypto keeps linking the vendored Nitro runtime, and stays deferred", () => {
  test("its Gradle project, its CMake and its pod ask for the Nitro runtime by the names the vendored copy has: `:react-native-nitro-modules`, the prefab `react-native-nitro-modules::NitroModules`, the pod `NitroModules`", () => {
    expect(read("react-native-quick-crypto", "android/build.gradle")).toContain('implementation project(":react-native-nitro-modules")');
    expect(read("react-native-quick-crypto", "nitrogen/generated/android/QuickCrypto+autolinking.cmake")).toContain("react-native-nitro-modules::NitroModules");
    expect(read("react-native-quick-crypto", "nitrogen/generated/ios/QuickCrypto+autolinking.rb")).toContain('spec.dependency "NitroModules"');
    // The Nitro entry's name is the Gradle project's and its podspec's own name is the pod's: both found by what quick-crypto names.
    expect(entry("react-native-nitro-modules").name).toBe("react-native-nitro-modules");
    expect(read("react-native-nitro-modules", "NitroModules.podspec")).toContain('s.name         = "NitroModules"');
    expect(iosOf("react-native-nitro-modules").podspecPath).toBe(join(vendoredRoot("react-native-nitro-modules"), "NitroModules.podspec"));
    expect(existsSync(join(vendoredRoot("react-native-nitro-modules"), "android/build.gradle"))).toBe(true);
    // Its peers are satisfied by the copies (the doctor's test checks the ranges).
    expect(JSON.parse(read("react-native-quick-crypto", "package.json")).peerDependencies).toMatchObject({ "react-native-nitro-modules": expect.any(String), "react-native-quick-base64": expect.any(String) });
  });

  test("deferredNitroPackages matches the registry's entry for quick-crypto (the import and the instance autolinking prints), and the relinking applies to the vendored entry on Android", () => {
    const registered = entry("react-native-quick-crypto").android;
    expect(deferredNitroPackages["react-native-quick-crypto"]).toMatchObject({ packageImportPath: registered?.packageImportPath, packageInstance: registered?.packageInstance, library: "QuickCrypto" });
    const nitro = entry(nitroPackage.name).android;
    expect([nitro?.packageImportPath, nitro?.packageInstance]).toEqual([nitroPackage.packageImportPath, nitroPackage.packageInstance]);
    const relinked = deferNitroLibraries(linkVendored({ root: app(), dependencies: {} } as AutolinkingConfig, "android"));
    const instance = (name: string) => platformOf<{ packageInstance?: string }>(relinked, name, "android").packageInstance;
    expect(instance("react-native-quick-crypto")).toBe('new DeferredNitroPackage("QuickCrypto")');
    expect(instance("react-native-nitro-modules")).toBe("new NitroGate(new com.margelo.nitro.NitroModulesPackage())");
    expect(instance("react-native-quick-base64")).toBe("new QuickBase64Package()");
    expect(instance("hermes-intl")).toBe("new HermesIntlPackage()");
    expect(platformOf<{ sourceDir: string }>(relinked, "react-native-quick-crypto", "android").sourceDir).toBe(join(vendoredRoot("react-native-quick-crypto"), "android"));
    // The library the stand-in loads is the one the copy's package class loads.
    expect(read("react-native-quick-crypto", "android/src/main/java/com/margelo/nitro/quickcrypto/QuickCryptoPackage.java")).toContain('private static final String TAG = "QuickCrypto";');
  });

  test("the commands print the three among the vendored entries and defer quick-crypto's library, from the sources and from the shipped dist/node/cli.js", () => {
    const node = Bun.which("node");
    if (!node) return;
    const printing = (config: unknown) => [node, "-e", `process.stdout.write(JSON.stringify(${JSON.stringify(config)}))`];
    for (const cli of [resolve(import.meta.dirname, "../../src/cli.ts"), resolve(import.meta.dirname, "../../dist/node/cli.js")]) {
      for (const [command, platform] of [["android-autolinking", "android"], ["ios-autolinking", "ios"]] as const) {
        const result = Bun.spawnSync([node, cli, command, ...printing({ root: app(), dependencies: {} })], { cwd: import.meta.dirname });
        expect([cli, command, result.exitCode]).toEqual([cli, command, 0]);
        const printed = JSON.parse(result.stdout.toString()) as AutolinkingConfig;
        for (const name of names) expect([cli, command, name, rootOf(printed, name)]).toEqual([cli, command, name, vendoredRoot(name)]);
        if (platform === "android") expect(platformOf<{ packageInstance: string }>(printed, "react-native-quick-crypto", "android").packageInstance).toBe('new DeferredNitroPackage("QuickCrypto")');
        // An app that lists quick-crypto is refused by both, with nothing on standard output.
        const refused = Bun.spawnSync([node, cli, command, ...printing({ root: app({ "react-native-quick-crypto": "1.1.3" }), dependencies: { "react-native-quick-crypto": { root: "/app/node_modules/react-native-quick-crypto", name: "react-native-quick-crypto", platforms: {} } } })], { cwd: import.meta.dirname });
        expect([cli, command, refused.exitCode, refused.stdout.toString()]).toEqual([cli, command, 1, ""]);
        expect(refused.stderr.toString()).toContain(collisionMessage(["react-native-quick-crypto"]));
      }
    }
  });
});

describe("`sodiumEnabled`, the option of quick-crypto's Expo plugin that moved into the library's", () => {
  const podfile = [
    "require File.join(File.dirname(`node --print \"require.resolve('expo/package.json')\"`), \"scripts/autolinking\")",
    "platform :ios, '16.4'",
    "target 'App' do",
    "  use_expo_modules!",
    "  config_command = ['npx', 'expo-modules-autolinking', 'react-native-config', '--json', '--platform', 'ios']",
    "  config = use_native_modules!(config_command)",
    "end",
    "",
  ].join("\n");

  test("iOS: `ENV['SODIUM_ENABLED'] = '1'` goes before everything else in a marked block, as quick-crypto's plugin wrote it, and is written again or taken out on every prebuild", () => {
    const on = applyPodfileSodium(podfile, true);
    expect(on.split("\n").slice(0, 3)).toEqual(["# Svelte native: libsodium for react-native-quick-crypto (generated, do not edit)", "ENV['SODIUM_ENABLED'] = '1'", "# Svelte native: end of libsodium"]);
    expect(on.slice(on.indexOf("require File.join"))).toBe(podfile);
    // Idempotent, and the block is replaced, not stacked.
    expect(applyPodfileSodium(on, true)).toBe(on);
    expect(on.match(/SODIUM_ENABLED/g)).toHaveLength(1);
    // Off: the block goes and the file is what it was (a project prebuilt with the option and then without it).
    expect(applyPodfileSodium(on, false)).toBe(podfile);
    expect(applyPodfileSodium(podfile, false)).toBe(podfile);
    // A block that is not at the top (the Podfile was edited) is found and removed too.
    expect(applyPodfileSodium(`# mine\n${on}`, false)).toBe(`# mine\n${podfile}`);
  });

  test("Android: `sodiumEnabled=true` is a property of gradle.properties, once, and the plugin owns it: it goes when the option is off, and the app's other properties are untouched", () => {
    const properties = [{ type: "comment" as const, value: "mine" }, { type: "property" as const, key: "org.gradle.jvmargs", value: "-Xmx2g" }];
    const on = applyGradleSodium(properties, true);
    expect(on).toEqual([...properties, { type: "property", key: "sodiumEnabled", value: "true" }]);
    expect(applyGradleSodium(on, true)).toEqual(on);
    expect(applyGradleSodium([...properties, { type: "property", key: "sodiumEnabled", value: "false" }], true)).toEqual(on);
    expect(applyGradleSodium(on, false)).toEqual(properties);
    expect(applyGradleSodium(properties, false)).toEqual(properties);
  });

  /** The plugin's own mods, run on a Podfile and on gradle.properties as `expo prebuild` would. */
  async function prebuilt(options: object | undefined) {
    const root = app();
    const config = withPlugins({ name: "a", slug: "a", android: { package: "io.e.a" }, ios: { bundleIdentifier: "io.e.a" }, _internal: { projectRoot: root } }, [[expoPlugin, options]]);
    const mods = config.mods as Record<string, Record<string, (config: object) => Promise<{ modResults: unknown }>>>;
    const run = async (platform: "android" | "ios", mod: string, modResults: unknown) => (await mods[platform]?.[mod]?.({ ...config, modRequest: { projectRoot: root, platformProjectRoot: root, platform, modName: mod, introspect: false }, modResults }))?.modResults;
    return {
      podfile: ((await run("ios", "podfile", { path: join(root, "Podfile"), language: "rb", contents: podfile })) as { contents: string }).contents,
      gradle: (await run("android", "gradleProperties", [{ type: "property", key: "org.gradle.daemon", value: "true" }])) as { type: string; key?: string; value?: string }[],
    };
  }

  test("through the plugin: with `sodiumEnabled: true` both files get it, without the option (or with false) neither does, and a Podfile and properties that had it lose it", async () => {
    const on = await prebuilt({ sodiumEnabled: true });
    expect(on.podfile).toContain("ENV['SODIUM_ENABLED'] = '1'");
    expect(on.podfile.indexOf("ENV['SODIUM_ENABLED']")).toBeLessThan(on.podfile.indexOf("require File.join"));
    // The vendored-package block of the same prebuild is still there: the two do not disturb each other.
    expect(on.podfile).toContain("'ios-autolinking'");
    expect(on.gradle.filter((item) => item.key === "sodiumEnabled")).toEqual([{ type: "property", key: "sodiumEnabled", value: "true" }]);
    expect(on.gradle.find((item) => item.key === "org.gradle.daemon")).toBeDefined();
    for (const options of [undefined, {}, { sodiumEnabled: false }]) {
      const off = await prebuilt(options);
      expect(off.podfile).not.toContain("SODIUM_ENABLED");
      expect(off.gradle.filter((item) => item.key === "sodiumEnabled")).toEqual([]);
    }
    // The block stays one block when the plugin runs on its own output (a second prebuild).
    expect(applyPodfileVendoredLinking(applyPodfileSodium(applyPodfileSodium(podfile, true), true)).match(/SODIUM_ENABLED/g)).toHaveLength(1);
  });

  test("an option that is not true or false stops the prebuild, naming it", () => {
    for (const value of ["yes", 1, null, {}]) {
      expect(() => withPlugins({ name: "a", slug: "a", _internal: { projectRoot: app() } }, [[expoPlugin, { sodiumEnabled: value }]])).toThrow("sodiumEnabled must be true or false");
    }
  });

  test("quick-crypto's other plugin step is not carried, and the facts that make that safe hold: it set iOS 16.4 on every pod (for Xcode 16.x with pods built for 15.1), and the library's pod and ExpoModulesCore need 16.4 already", () => {
    // `withXCode` of react-native-quick-crypto 1.1.3 (src/expo-plugin/withXCode.ts, left out of the copy): `deploymentTarget: '16.4'` through expo-build-properties and `IPHONEOS_DEPLOYMENT_TARGET = '16.4'` in a post_install.
    const forced = "16.4";
    expect(readFileSync(resolve(import.meta.dirname, "../../native/svelte-core/ios/SvelteCore.podspec"), "utf8")).toContain(`s.platforms      = { :ios => '${forced}' }`);
    const core = resolve(import.meta.dirname, "../../../../node_modules/expo-modules-core/ExpoModulesCore.podspec");
    if (existsSync(core)) expect(readFileSync(core, "utf8")).toMatch(new RegExp(`:ios => '${forced.replace(".", "\\.")}'`));
    expect(read("react-native-quick-crypto", "QuickCrypto.podspec")).toContain("min_ios_version_supported");
  });
});
