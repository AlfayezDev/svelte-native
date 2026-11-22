import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { type AutolinkingConfig, deferNitroLibraries } from "../../src/autolinking.ts";
import { alwaysLinkedPackages, collisionMessage, declaredVendored, linkVendored, optionalPackages, VendoredCollision, type VendoredPackage, vendoredDependency, vendoredNames, vendoredPackages, vendoredRoot } from "../../src/vendored.ts";
import { withPlugins } from "@expo/config-plugins";
import expoPlugin, { assertNoVendoredOriginals } from "../../src/expo.ts";
import { createProject } from "../support/project.ts";

/**
 * The packages the library carries (`src/vendored.ts`, VENDORING.md) in React Native's autolinking config. The reference entries in `fixtures/vendored-autolinking/` are what Expo's
 * own `react-native-config` printed for the packages installed in `apps/example` (SDK 58: `node --no-warnings --eval "require('expo/bin/autolinking')" expo-modules-autolinking
 * react-native-config --json --platform android|ios`, 18 November 2026, before they were vendored), with the package's directory written as `$PACKAGE`: the entries the library adds
 * must be those, with the directory of the copy. One file per batch of packages and platform: `expo-sdk58-<platform>.json` (the pilot's two), `expo-sdk58-crypto-<platform>.json`
 * (react-native-quick-crypto, react-native-quick-base64 and hermes-intl, captured from the same app with all three installed), `expo-sdk58-optional-<platform>.json` (the eleven React Native packages
 * among the optional libraries, which an app links only when it turns them on, captured the same way; the Expo modules among them have no entry) and `expo-sdk58-ui-<platform>.json` (gesture handler,
 * Worklets, Reanimated and svg, run in `apps/example` with the four installed).
 */
const fixtures = resolve(import.meta.dirname, "fixtures/vendored-autolinking");
const reference = (platform: "android" | "ios"): Record<string, unknown> =>
  Object.assign({}, ...readdirSync(fixtures).filter((file) => new RegExp(`^expo-sdk58-(?:[a-z0-9]+-)*${platform}\\.json$`).test(file)).sort().map((file) => JSON.parse(readFileSync(join(fixtures, file), "utf8")) as Record<string, unknown>));
const alwaysNames = alwaysLinkedPackages.map((vendored) => vendored.name);
const withRoot = (value: unknown, root: string): unknown => JSON.parse(JSON.stringify(value).replaceAll("$PACKAGE", root.replaceAll("\\", "\\\\")));

const projects: { remove(): void }[] = [];
afterAll(() => { for (const project of projects) project.remove(); });
/** An app directory (a package.json that lists `dependencies`), and a config the way the config command prints it for it. */
function app(dependencies: Record<string, string> = {}) {
  const project = createProject({ "package.json": JSON.stringify({ name: "app", dependencies: { "expo-svelte": "*", ...dependencies } }) }, "vendored-app-");
  projects.push(project);
  return project.directory;
}

/** What the config command prints for an installed original, at `root`. */
function installed(name: string, platform: "android" | "ios", root: string) {
  const entry = (reference(platform)[name] as { platforms: Record<string, unknown> });
  return withRoot(entry, root) as { root: string; name: string; platforms: Record<string, unknown> };
}

// A package that is not vendored, found in the app's node_modules.
const other = (platform: "android" | "ios") => ({ root: "/app/node_modules/react-native-get-random-values", name: "react-native-get-random-values", platforms: { [platform]: { sourceDir: "/app/node_modules/react-native-get-random-values/android" } } });

describe("the entries the library adds are the ones Expo's autolinking prints for the installed packages", () => {
  for (const platform of ["android", "ios"] as const) {
    test(`${platform}: the same fields in the same order, with the paths of vendor/<name>`, () => {
      // The Expo modules have no entry: Expo's own autolinker links them (`libraries.ts`). Every other package has the one Expo printed for the installed copy.
      for (const vendored of vendoredPackages.filter((candidate) => candidate.optional?.kind !== "expo")) {
        const entry = vendoredDependency(vendored, platform);
        if (reference(platform)[vendored.name] === undefined) {
          // A package with no code for the platform (react-native-fast-shadow has no iOS) has no entry, as Expo printed none.
          expect([vendored.name, entry]).toEqual([vendored.name, undefined]);
          continue;
        }
        const wanted = withRoot(reference(platform)[vendored.name], vendoredRoot(vendored.name));
        expect(entry, vendored.name).toEqual(wanted as typeof entry);
        // Same order too: the JSON is what the Gradle plugin and CocoaPods read, and a diff against the installed package's must be the paths alone.
        expect(JSON.stringify(entry), vendored.name).toBe(JSON.stringify(wanted));
      }
    });
  }

  test("the directory of a copy is vendor/<name> of the package, and holds what the entry points at", () => {
    for (const vendored of vendoredPackages) {
      const root = vendoredRoot(vendored.name);
      expect(root).toBe(resolve(import.meta.dirname, "../..", "vendor", vendored.name));
      const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { name: string; version: string };
      expect([manifest.name, manifest.version]).toEqual([vendored.name, vendored.version]);
      if (vendored.optional?.kind === "expo") continue;
      const android = vendoredDependency(vendored, "android")?.platforms.android as { sourceDir: string };
      const ios = vendoredDependency(vendored, "ios")?.platforms.ios as { podspecPath: string; version: string } | undefined;
      expect(["build.gradle", "build.gradle.kts"].some((file) => existsSync(join(android.sourceDir, file))), vendored.name).toBe(true);
      if (ios === undefined) {
        expect([vendored.name, readdirSync(root).filter((file) => file.endsWith(".podspec"))]).toEqual([vendored.name, []]);
        continue;
      }
      expect(existsSync(ios.podspecPath)).toBe(true);
      // The podspec is the only one at the package's root, which is how CocoaPods names the pod, and the version is the package's own.
      expect(readdirSync(root).filter((file) => file.endsWith(".podspec"))).toEqual([ios.podspecPath.slice(root.length + 1)]);
      expect(ios.version).toBe(manifest.version);
    }
  });

  test("an Expo module is found by Expo's autolinker from its expo-module.config.json, which names a class the copy has", () => {
    const modules = optionalPackages.filter((vendored) => vendored.optional?.kind === "expo");
    expect(modules.map((vendored) => vendored.name)).toEqual(["expo-blur", "expo-conic-gradient", "expo-image", "expo-linear-gradient", "expo-video"]);
    for (const vendored of modules) {
      expect([vendored.name, vendored.android, vendored.ios]).toEqual([vendored.name, undefined, undefined]);
      const config = JSON.parse(readFileSync(join(vendoredRoot(vendored.name), "expo-module.config.json"), "utf8")) as { android: { modules: string[] }; apple: { modules: string[] } };
      for (const classifier of config.android.modules) expect(existsSync(join(vendoredRoot(vendored.name), "android/src/main/java", `${classifier.replaceAll(".", "/")}.kt`)), classifier).toBe(true);
      expect(config.apple.modules).toHaveLength(1);
    }
  });

  test("the packages' Android classes are the ones named: a ReactPackage in the package's own Java or Kotlin, found where autolinking looks for it", () => {
    for (const vendored of vendoredPackages.filter((candidate) => candidate.optional?.kind !== "expo")) {
      const android = vendored.android;
      if (!android) throw new Error(`${vendored.name} has no Android entry`);
      const fqcn = /^import\s+([\w.]+);$/.exec(android.packageImportPath)?.[1];
      expect(fqcn, vendored.name).toBeDefined();
      const path = `${fqcn?.replaceAll(".", "/")}`;
      const source = ["java", "kt"].map((extension) => join(vendoredRoot(vendored.name), "android/src/main/java", `${path}.${extension}`)).find(existsSync);
      expect(source, vendored.name).toBeDefined();
      const text = readFileSync(source ?? "", "utf8");
      expect(text).toMatch(/ReactPackage/);
      expect(text).toContain(`package ${fqcn?.slice(0, fqcn.lastIndexOf("."))}`);
      expect(android.packageInstance).toBe(`new ${fqcn?.slice(fqcn.lastIndexOf(".") + 1)}()`);
    }
  });

  test("the component descriptors and the codegen CMake file the registry names are the copy's own: svg's react-native.config.js lists them, and its CMake file is where it says", () => {
    for (const vendored of vendoredPackages) {
      const android = vendored.android;
      const config = join(vendoredRoot(vendored.name), "react-native.config.js");
      if (existsSync(config)) {
        // The package's own config is what Expo's autolinking reads the descriptors and the CMake path from (relative to its `android/` folder).
        const text = readFileSync(config, "utf8");
        if (/componentDescriptors:/.test(text)) expect(android?.componentDescriptors ?? [], vendored.name).toEqual([...new Set([...text.matchAll(/'(\w+ComponentDescriptor)'/g)].map((match) => match[1] ?? ""))]);
        const cmake = /cmakeListsPath:\s*'([^']+)'/.exec(text)?.[1];
        if (cmake !== undefined) expect(android?.cmakeListsPath, vendored.name).toBe(join("android", cmake));
      }
      if (android?.cmakeListsPath !== undefined) expect(existsSync(join(vendoredRoot(vendored.name), android.cmakeListsPath)), `${vendored.name}: ${android.cmakeListsPath}`).toBe(true);
    }
    // Gesture handler 3 lists one component in its own config: the detector (`RNGestureHandlerDetector`); its button and root view are the codegen's alone.
    const handler = vendoredPackages.find((vendored) => vendored.name === "react-native-gesture-handler");
    const codegen = JSON.parse(readFileSync(join(vendoredRoot("react-native-gesture-handler"), "package.json"), "utf8")) as { codegenConfig: { name: string } };
    expect([handler?.android?.componentDescriptors, codegen.codegenConfig.name]).toEqual([["RNGestureHandlerDetectorComponentDescriptor"], "rngesturehandler_codegen"]);
  });

  test("the list is what vendor/ holds, and what the library no longer asks an app to install", () => {
    expect(alwaysNames).toEqual(expect.arrayContaining(["react-native-nitro-modules", "react-native-mmkv", "react-native-gesture-handler", "react-native-reanimated", "react-native-worklets", "react-native-svg"]));
    // The directories of vendor/: a package, or a scope that holds packages.
    const vendorDirectory = resolve(import.meta.dirname, "../../vendor");
    const held = readdirSync(vendorDirectory).flatMap((entry) => (entry.startsWith("@") ? readdirSync(join(vendorDirectory, entry)).map((name) => `${entry}/${name}`) : [entry]));
    expect(held.sort()).toEqual([...vendoredNames].sort());
    const manifest = JSON.parse(readFileSync(resolve(import.meta.dirname, "../../package.json"), "utf8")) as { peerDependencies: Record<string, string>; devDependencies: Record<string, string> };
    for (const name of vendoredNames) expect([name, name in manifest.peerDependencies, name in manifest.devDependencies]).toEqual([name, false, false]);
  });
});

describe("the registry can say what the entries of every kind of package have", () => {
  // A codegen library name from package.json or, failing that, from the `react { }` block of build.gradle (or the registry's own `libraryName`), a view library's component descriptors, svg's CMake file and
  // a pure C++ TurboModule's CMake module are all in the real copies, so the entries the registry builds for them are compared with Expo's output above; this is the one precedence that needs a pair of fields.
  test("a package whose manifest has a codegen name uses it even when build.gradle names another library (Nitro's: NitroModulesSpec, not NitroModules)", () => {
    const entry = vendoredDependency(vendoredPackages.find((vendored) => vendored.name === "react-native-nitro-modules") as VendoredPackage, "android")?.platforms.android as { libraryName: string };
    expect(entry.libraryName).toBe("NitroModulesSpec");
    expect(readFileSync(join(vendoredRoot("react-native-nitro-modules"), "android/build.gradle"), "utf8")).toContain('libraryName = "NitroModules"');
  });
});

describe("linkVendored", () => {
  test("adds an entry for each package, by name, beside the others, and does not change its input", () => {
    for (const platform of ["android", "ios"] as const) {
      const config = { root: app(), dependencies: { zeta: { root: "/z", name: "zeta", platforms: {} }, "react-native-get-random-values": other(platform), alpha: { root: "/a", name: "alpha", platforms: {} } }, project: { [platform]: { sourceDir: "/app" } } };
      const before = JSON.stringify(config);
      const linked = linkVendored(config, platform);
      expect(JSON.stringify(config)).toBe(before);
      expect(Object.keys(linked.dependencies)).toEqual(["alpha", "react-native-get-random-values", ...alwaysNames, "zeta"].sort());
      for (const vendored of alwaysLinkedPackages) expect(linked.dependencies[vendored.name]).toEqual(vendoredDependency(vendored, platform) as never);
      expect(linked.dependencies.zeta).toEqual(config.dependencies.zeta);
      expect(linked.dependencies["react-native-get-random-values"]).toEqual(config.dependencies["react-native-get-random-values"]);
      expect({ ...linked, dependencies: undefined }).toEqual({ ...config, dependencies: undefined });
      // Running it on its own output changes nothing.
      expect(linkVendored(linked, platform)).toEqual(linked);
    }
  });

  test("a config without dependencies gets the packages alone", () => {
    expect(Object.keys(linkVendored({}, "android").dependencies ?? {})).toEqual([...alwaysNames].sort());
  });

  test("an original that autolinking found all the same (installed as a peer of another package, not the app's own) is replaced: the name, and so the Gradle project and the pod, stay", () => {
    for (const platform of ["android", "ios"] as const) {
      const root = app();
      const originals = Object.fromEntries(alwaysNames.map((name) => [name, installed(name, platform, `/app/node_modules/${name}`)]));
      const linked = linkVendored({ root, dependencies: { ...originals, "react-native-get-random-values": other(platform) } }, platform);
      for (const name of alwaysNames) {
        expect(linked.dependencies[name]?.root, name).toBe(vendoredRoot(name));
        expect(JSON.stringify(linked.dependencies[name]), name).not.toContain("/app/node_modules/");
      }
      expect(Object.keys(linked.dependencies).filter((name) => vendoredNames.includes(name)).sort()).toEqual([...alwaysNames].sort());
    }
  });

  test("an app that lists an original itself is refused, naming it: the library's copy would be linked beside the app's", () => {
    for (const platform of ["android", "ios"] as const) {
      // The packages Expo printed an entry for (`installed` reads it): the optional Expo modules have none, and are refused by name all the same (`declaredVendored`, tested below).
      const printed = vendoredNames.filter((name) => reference(platform)[name] !== undefined);
      const cases = [...printed.map((name) => [[name], [name]] as const), [["react-native-nitro-modules", "react-native-mmkv"], ["react-native-nitro-modules", "react-native-mmkv"]] as const, [["react-native-reanimated", "react-native-worklets", "react-native-gesture-handler", "react-native-svg"], ["react-native-gesture-handler", "react-native-worklets", "react-native-reanimated", "react-native-svg"]] as const];
      for (const [declared, expected] of cases) {
        const root = app(Object.fromEntries(declared.map((name) => [name, "*"])));
        const config = { root, dependencies: Object.fromEntries(declared.map((name) => [name, installed(name, platform, `/app/node_modules/${name}`)])) };
        let refused: unknown;
        try { linkVendored(config, platform); } catch (error) { refused = error; }
        expect(refused).toBeInstanceOf(VendoredCollision);
        expect((refused as VendoredCollision).names).toEqual(expected as unknown as string[]);
        expect((refused as Error).message).toBe(collisionMessage([...expected]));
      }
    }
  });

  test("the refusal is said the same way by the plugin, the doctor and the command: the library includes it, remove it from the app's dependencies", () => {
    expect(collisionMessage(["react-native-mmkv"])).toStartWith("expo-svelte includes react-native-mmkv 4.3.2; remove it from the app's dependencies (package.json)");
    expect(collisionMessage(["react-native-nitro-modules", "react-native-mmkv"])).toContain("includes react-native-nitro-modules 0.35.10 and react-native-mmkv 4.3.2; remove them from");
    expect(collisionMessage(["react-native-reanimated"])).toStartWith("expo-svelte includes react-native-reanimated 4.7.1; remove it from the app's dependencies (package.json) and any `patchedDependencies` entry for it (pnpm stops on a patch of a package it no longer installs), reinstall, and prebuild again.");
  });

  test("the refusal says what becomes of a library that asks for the package as a peer: the copy serves it, under the same name, so nothing replaces what is removed", () => {
    for (const names of [["react-native-gesture-handler"], ["react-native-reanimated", "react-native-worklets"]]) {
      const message = collisionMessage(names);
      expect(message).toContain("A library of the app that asks for");
      expect(message).toContain("as a peer dependency is served by the copy (Metro resolves the name to it; the Gradle project and the pod keep the name)");
      expect(message).toContain(names.length === 1 ? "nothing needs to take its place" : "nothing needs to take their place");
    }
  });

  test("an app that declares an original the autolinking did not find (excluded, say) is not refused here: the plugin and the doctor refuse it from package.json", () => {
    const root = app({ "react-native-mmkv": "*" });
    expect(() => linkVendored({ root, dependencies: {} }, "android")).not.toThrow();
  });

  test("an entry that is already the copy's (a second pass) is not an original, even for an app that lists the package", () => {
    const root = app({ "react-native-mmkv": "*" });
    const once = linkVendored({ root, dependencies: {} }, "ios");
    expect(() => linkVendored(once, "ios")).not.toThrow();
  });
});

describe("what the app lists", () => {
  test("declaredVendored reads dependencies, devDependencies and optionalDependencies, and only the vendored names", () => {
    const project = createProject({ "package.json": JSON.stringify({ dependencies: { "react-native-mmkv": "4.3.2", react: "*" }, devDependencies: { "react-native-nitro-modules": "*" }, optionalDependencies: { "react-native-mmkv-storage": "*" } }) }, "vendored-declared-");
    projects.push(project);
    expect(declaredVendored(project.directory).sort()).toEqual(["react-native-mmkv", "react-native-nitro-modules"]);
    expect(declaredVendored(join(project.directory, "nowhere"))).toEqual([]);
    mkdirSync(join(project.directory, "empty"));
    expect(declaredVendored(join(project.directory, "empty"))).toEqual([]);
    expect(declaredVendored(app())).toEqual([]);
  });

  test("the config plugin's check stops the prebuild with the message, for an app that lists one, and lets another through", () => {
    expect(() => assertNoVendoredOriginals(app({ "react-native-mmkv": "4.3.2" }))).toThrow(collisionMessage(["react-native-mmkv"]));
    expect(() => assertNoVendoredOriginals(app({ "react-native-nitro-modules": "0.35.10", "react-native-mmkv": "4.3.2" }))).toThrow("includes react-native-nitro-modules 0.35.10 and react-native-mmkv 4.3.2");
    expect(() => assertNoVendoredOriginals(app({ "react-native-get-random-values": "2.0.0", "react-native-mmkv-storage": "1.0.0" }))).not.toThrow();
  });
});

describe("with the Nitro libraries deferred (Android)", () => {
  const nitroPeers = (): AutolinkingConfig => ({
    root: "/app",
    dependencies: {
      "react-native-quick-crypto": { root: "/app/node_modules/react-native-quick-crypto", name: "react-native-quick-crypto", platforms: { android: { sourceDir: "/app/node_modules/react-native-quick-crypto/android", packageImportPath: "import com.margelo.nitro.quickcrypto.QuickCryptoPackage;", packageInstance: "new QuickCryptoPackage()" } } },
    },
  });
  const androidOf = (config: AutolinkingConfig, name: string) => (config.dependencies?.[name]?.platforms?.android ?? {}) as { packageInstance?: string; sourceDir?: string; libraryName?: string };
  const instance = (config: AutolinkingConfig, name: string) => androidOf(config, name).packageInstance;

  test("the vendored entries are matched by the relinking as the installed ones were: MMKV is deferred, Nitro's package is gated, quick-crypto's is deferred too", () => {
    const relinked = deferNitroLibraries(linkVendored(nitroPeers(), "android"));
    expect(instance(relinked, "react-native-mmkv")).toBe('new DeferredNitroPackage("NitroMmkv")');
    expect(instance(relinked, "react-native-nitro-modules")).toBe("new NitroGate(new com.margelo.nitro.NitroModulesPackage())");
    expect(instance(relinked, "react-native-quick-crypto")).toBe('new DeferredNitroPackage("QuickCrypto")');
    // The paths are still the copy's.
    expect(androidOf(relinked, "react-native-mmkv").sourceDir).toBe(join(vendoredRoot("react-native-mmkv"), "android"));
    expect(androidOf(relinked, "react-native-nitro-modules").libraryName).toBe("NitroModulesSpec");
  });

  test("the same when the originals were in the config and got replaced", () => {
    const config = nitroPeers();
    for (const name of alwaysNames) config.dependencies = { ...config.dependencies, [name]: installed(name, "android", `/app/node_modules/${name}`) as never };
    const relinked = deferNitroLibraries(linkVendored(config, "android"));
    expect(instance(relinked, "react-native-mmkv")).toBe('new DeferredNitroPackage("NitroMmkv")');
    expect(instance(relinked, "react-native-nitro-modules")).toStartWith("new NitroGate(");
  });
});

describe("the commands", () => {
  const node = Bun.which("node");
  const sources = resolve(import.meta.dirname, "../../src/cli.ts");
  const built = resolve(import.meta.dirname, "../../dist/node/cli.js");
  /** A command that prints `config` as the config command does. */
  const printing = (config: unknown) => [node ?? "node", "-e", `process.stdout.write(JSON.stringify(${JSON.stringify(config)}))`];
  const run = (cli: string, command: "android-autolinking" | "ios-autolinking", ...rest: string[]) => Bun.spawnSync([node ?? "node", cli, command, ...rest], { cwd: import.meta.dirname });
  const entries = (result: { stdout: Buffer }): AutolinkingConfig => JSON.parse(result.stdout.toString()) as AutolinkingConfig;

  for (const [name, cli] of [["expo-svelte", sources], ["the shipped dist/node/cli.js (what settings.gradle and the Podfile run)", built]] as const) {
    describe.skipIf(!node)(name, () => {
      test("android-autolinking prints the config with the vendored packages linked from the library and the Nitro libraries deferred", () => {
        const result = run(cli, "android-autolinking", ...printing({ root: app(), dependencies: { "react-native-get-random-values": other("android") }, project: { android: { packageName: "io.example.app" } } }));
        expect(result.exitCode).toBe(0);
        const printed = entries(result);
        expect(Object.keys(printed.dependencies ?? {})).toEqual(["react-native-get-random-values", ...alwaysNames].sort());
        const mmkv = printed.dependencies?.["react-native-mmkv"] as { root: string; platforms: { android: { sourceDir: string; packageInstance: string } } };
        expect(mmkv.root).toBe(vendoredRoot("react-native-mmkv"));
        expect(mmkv.platforms.android.sourceDir).toBe(join(vendoredRoot("react-native-mmkv"), "android"));
        expect(mmkv.platforms.android.packageInstance).toBe('new DeferredNitroPackage("NitroMmkv")');
        expect(printed.project).toEqual({ android: { packageName: "io.example.app" } });
      });

      test("ios-autolinking prints the config with the vendored packages' podspecs, and nothing else changed", () => {
        const config = { root: app(), reactNativePath: "/app/node_modules/react-native", dependencies: { "react-native-get-random-values": other("ios") }, project: { ios: { sourceDir: "/app/ios" } } };
        const result = run(cli, "ios-autolinking", ...printing(config));
        expect(result.exitCode).toBe(0);
        const printed = entries(result);
        expect(Object.keys(printed.dependencies ?? {})).toEqual(["react-native-get-random-values", ...alwaysNames].sort());
        for (const name of alwaysNames) expect(printed.dependencies?.[name], name).toEqual(withRoot(reference("ios")[name], vendoredRoot(name)) as never);
        expect(printed.dependencies?.["react-native-mmkv"]).toEqual(withRoot(reference("ios")["react-native-mmkv"], vendoredRoot("react-native-mmkv")) as never);
        expect(printed.dependencies?.["react-native-nitro-modules"]).toEqual(withRoot(reference("ios")["react-native-nitro-modules"], vendoredRoot("react-native-nitro-modules")) as never);
        expect(printed.dependencies?.["react-native-get-random-values"]).toEqual(config.dependencies["react-native-get-random-values"] as never);
        expect({ ...printed, dependencies: undefined }).toEqual({ ...config, dependencies: undefined } as never);
      });

      test("an app that lists an original is refused by both: exit status 1, the message on standard error, no config on standard output", () => {
        const root = app({ "react-native-mmkv": "4.3.2" });
        for (const command of ["android-autolinking", "ios-autolinking"] as const) {
          const platform = command === "android-autolinking" ? "android" : "ios";
          const result = run(cli, command, ...printing({ root, dependencies: { "react-native-mmkv": installed("react-native-mmkv", platform, "/app/node_modules/react-native-mmkv") } }));
          expect([command, result.exitCode]).toEqual([command, 1]);
          expect(result.stderr.toString()).toContain(`expo-svelte ${command}: ${collisionMessage(["react-native-mmkv"])}`);
          expect(result.stdout.toString()).toBe("");
        }
      });

      test("ios-autolinking passes a failing command's status and output on, output that is not JSON as it came, and wants a command", () => {
        const failed = run(cli, "ios-autolinking", node ?? "node", "-e", "console.error('no config'); process.exit(3)");
        expect(failed.exitCode).toBe(3);
        expect(failed.stderr.toString()).toContain("no config");
        const text = run(cli, "ios-autolinking", node ?? "node", "-e", "process.stdout.write('not json')");
        expect([text.exitCode, text.stdout.toString()]).toEqual([0, "not json"]);
        const missing = run(cli, "ios-autolinking");
        expect(missing.exitCode).toBe(2);
        expect(missing.stderr.toString()).toContain("the Podfile gives it React Native's config command");
      });
    });
  }
});

describe("the config plugin", () => {
  /** Runs the dangerous mod the plugin registers for a platform: what `expo prebuild` runs first. */
  async function prebuild(root: string, platform: "android" | "ios"): Promise<void> {
    const config = withPlugins({ name: "a", slug: "a", android: { package: "io.e.a" }, ios: { bundleIdentifier: "io.e.a" }, _internal: { projectRoot: root } }, [[expoPlugin, undefined]]);
    const mod = (config.mods as Record<string, Record<string, (config: object) => Promise<unknown>>>)[platform]?.dangerous;
    await mod?.({ ...config, modRequest: { projectRoot: root, platformProjectRoot: root, platform, modName: "dangerous", introspect: false }, modResults: {} });
  }

  test("the prebuild of either platform stops for an app that lists a vendored package, before it writes anything", async () => {
    for (const platform of ["android", "ios"] as const) {
      const root = app({ "react-native-mmkv": "4.3.2" });
      let refused: unknown;
      try { await prebuild(root, platform); } catch (error) { refused = error; }
      expect([platform, (refused as Error | undefined)?.message]).toEqual([platform, collisionMessage(["react-native-mmkv"])]);
      expect(existsSync(join(root, ".expo-svelte"))).toBe(false);
    }
  });
});
