import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { vendoredPackages, vendoredRoot } from "../../src/vendored.ts";
import { packageRoot } from "../support/paths.ts";

/**
 * The crypto batch of the vendored packages (VENDORING.md): react-native-quick-crypto 1.1.3 (`crypto`), react-native-quick-base64 2.2.2 (what it and its Buffer ask for) and hermes-intl 0.1.2 (the
 * `Intl` constructors Hermes lacks). The layout of the three copies, what they leave out and why, the library's imports of them, quick-crypto's JavaScript dependencies and the pack.
 */
const names = ["react-native-quick-crypto", "react-native-quick-base64", "hermes-intl"] as const;
const manifestOf = (directory: string) => JSON.parse(readFileSync(join(directory, "package.json"), "utf8")) as { name: string; version: string; main?: string; "react-native"?: string; dependencies?: Record<string, string>; peerDependencies?: Record<string, string>; codegenConfig?: unknown };
const library = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")) as { dependencies: Record<string, string>; peerDependencies: Record<string, string>; devDependencies: Record<string, string>; imports: Record<string, string | { default: string }>; files: string[] };
const copy = (name: string, path = "") => join(vendoredRoot(name), path);

/** Every file below `directory` (relative, forward slashes). */
const filesUnder = (directory: string): string[] => readdirSync(directory, { recursive: true, withFileTypes: true }).filter((entry) => entry.isFile()).map((entry) => join(entry.parentPath, entry.name).slice(directory.length + 1));

describe("the three copies are what scripts/vendor.ts wrote", () => {
  for (const [name, version] of [["react-native-quick-crypto", "1.1.3"], ["react-native-quick-base64", "2.2.2"], ["hermes-intl", "0.1.2"]] as const) {
    test(`${name}: the registry's version, package.json, LICENSE and VENDOR.md agree, and its local changes are the files of vendor-patches/ (none for most)`, () => {
      const directory = copy(name);
      expect(vendoredPackages.find((vendored) => vendored.name === name)?.version).toBe(version);
      expect([manifestOf(directory).name, manifestOf(directory).version]).toEqual([name, version]);
      const notes = readFileSync(join(directory, "VENDOR.md"), "utf8");
      expect(notes).toStartWith(`# ${name} ${version} (vendored)\n`);
      expect(notes).toContain(`\`node scripts/vendor.ts ${name}@${version}`);
      expect(notes).toContain(`sha256 \`${createHash("sha256").update(readFileSync(join(directory, "LICENSE"))).digest("hex")}\``);
      expect(notes).toMatch(/Integrity \(npm's `dist.integrity`\): `sha512-[A-Za-z0-9+/=]+`/);
      // quick-base64's iOS module has one (React Native 0.88 has no RCTCxxBridge); optional-libraries.test.ts checks that each patch is listed with its sha256.
      const patches = join(packageRoot, "vendor-patches", name);
      if (existsSync(patches)) for (const file of readdirSync(patches)) expect(notes).toContain(`vendor-patches/${name}/${file}`);
      else expect(notes).toContain("## Local changes\n\nNone.");
      expect(readFileSync(join(directory, "LICENSE"), "utf8")).toMatch(/MIT License|Permission is hereby granted/);
    });
  }

  test("quick-crypto's copy leaves out its Expo plugin and the built copies of src, and VENDOR.md says so, with the command that reproduces it", () => {
    const left = ["app.plugin.js", "lib/commonjs", "lib/module", "src/expo-plugin", "lib/typescript/expo-plugin"];
    const notes = readFileSync(copy("react-native-quick-crypto", "VENDOR.md"), "utf8");
    for (const path of left) {
      expect([path, existsSync(copy("react-native-quick-crypto", path))]).toEqual([path, false]);
      expect(notes).toContain(`- \`${path}\``);
      expect(notes).toContain(`--exclude ${path}`);
    }
    // What stays: the sources Metro bundles (`react-native` field), the declarations, and every native build input.
    for (const path of ["src/index.ts", "lib/typescript/index.d.ts", "QuickCrypto.podspec", "android/build.gradle", "android/CMakeLists.txt", "cpp", "deps/simdutf/src/simdutf.cpp", "deps/ncrypto/src/ncrypto.cpp", "nitrogen/generated/android", "nitrogen/generated/ios"])
      expect([path, existsSync(copy("react-native-quick-crypto", path))]).toEqual([path, true]);
    // Nothing that stayed imports the plugin or what it needs (it would be code that cannot resolve in an app).
    const sources = filesUnder(copy("react-native-quick-crypto", "src")).filter((file) => /\.tsx?$/.test(file));
    expect(sources.length).toBeGreaterThan(20);
    for (const file of sources) expect([file, readFileSync(copy("react-native-quick-crypto", `src/${file}`), "utf8").match(/expo\/config-plugins|expo-build-properties|expo-plugin/)]).toEqual([file, null]);
  });

  test("the other two leave nothing out: the files are the tarballs'", () => {
    for (const name of ["react-native-quick-base64", "hermes-intl"]) expect(readFileSync(copy(name, "VENDOR.md"), "utf8")).toContain("## Left out\n\nNothing: the files here are the tarball's.");
  });

  test("a package's native build inputs are all there: hermes-intl's prebuilt ICU4X libraries (one per ABI, and the xcframework), the C++ of the three, the podspecs", () => {
    for (const abi of ["arm64-v8a", "armeabi-v7a", "x86", "x86_64"]) expect([abi, statSync(copy("hermes-intl", `prebuilt/android/${abi}/libhermes_intl.so`)).size > 100_000]).toEqual([abi, true]);
    expect(existsSync(copy("hermes-intl", "prebuilt/ios/HermesIntlCore.xcframework/Info.plist"))).toBe(true);
    for (const path of ["hermes-intl/cpp/hermes_intl.cpp", "hermes-intl/android/CMakeLists.txt", "hermes-intl/HermesIntl.podspec", "react-native-quick-base64/cpp/react-native-quick-base64.cpp", "react-native-quick-base64/android/CMakeLists.txt", "react-native-quick-base64/ios/QuickBase64Module.mm", "react-native-quick-base64/react-native-quick-base64.podspec"])
      expect([path, existsSync(join(packageRoot, "vendor", path))]).toEqual([path, true]);
  });
});

describe("the library imports its copies through its `imports` map, and Metro resolves the names to the same files", () => {
  test("#vendor/react-native-quick-crypto is the copy's source, #vendor/hermes-intl its entry, and the files exist", () => {
    for (const [name, file] of [["react-native-quick-crypto", "src/index.ts"], ["hermes-intl", "src/index.js"]] as const) {
      const entry = library.imports[`#vendor/${name}`];
      expect([name, typeof entry === "string" ? entry : entry?.default]).toEqual([name, `./vendor/${name}/${file}`]);
      expect([name, existsSync(copy(name, file))]).toEqual([name, true]);
    }
  });

  test("the entries a bare name gets from Metro's own resolution are the copy's too: the `react-native` field (quick-crypto), `main` (quick-base64, hermes-intl)", () => {
    // Metro resolves `<vendor>/<name>` as a directory, through package.json: the same file as the `imports` entry, so there is one module of each.
    expect(manifestOf(copy("react-native-quick-crypto"))["react-native"]).toBe("src/index");
    expect(existsSync(copy("react-native-quick-crypto", "src/index.ts"))).toBe(true);
    expect(manifestOf(copy("react-native-quick-base64")).main).toBe("./lib/module/index.js");
    expect(existsSync(copy("react-native-quick-base64", "lib/module/index.js"))).toBe(true);
    expect(manifestOf(copy("hermes-intl"))["react-native"]).toBe("src/index.js");
  });

  test("the library's own sources require them by that name and by no other", () => {
    expect(readFileSync(join(packageRoot, "src/web-crypto.ts"), "utf8")).toContain('require("#vendor/react-native-quick-crypto")');
    expect(readFileSync(join(packageRoot, "src/intl.ts"), "utf8")).toContain('require("#vendor/hermes-intl")');
    const sources = readdirSync(join(packageRoot, "src"), { recursive: true, withFileTypes: true }).filter((entry) => entry.isFile() && /\.(?:ts|svelte)$/.test(entry.name));
    for (const entry of sources) {
      const text = readFileSync(join(entry.parentPath, entry.name), "utf8");
      expect([entry.name, /require\("(?:react-native-quick-crypto|react-native-quick-base64|hermes-intl)"\)/.test(text)]).toEqual([entry.name, false]);
    }
  });
});

describe("what the three asked the app to install is not asked any more", () => {
  test("none of the three is a peer, a dependency or a development dependency of the library, and the apps list none", () => {
    for (const name of names) expect([name, library.peerDependencies[name], library.dependencies[name], library.devDependencies[name]]).toEqual([name, undefined, undefined, undefined]);
    for (const app of ["apps/example", "apps/qa", "examples/minimal"]) {
      const manifest = JSON.parse(readFileSync(join(packageRoot, "../..", app, "package.json"), "utf8")) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
      for (const name of names) expect([app, name, manifest.dependencies?.[name], manifest.devDependencies?.[name]]).toEqual([app, name, undefined, undefined]);
    }
  });

  test("the lockfile has no top-level install of any of them, and none of the Nitro runtime that pnpm used to add for quick-crypto's peer (quick-base64 stays as a dependency of the Buffer package)", () => {
    const lockfile = readFileSync(join(packageRoot, "../../pnpm-lock.yaml"), "utf8");
    const importers = lockfile.slice(lockfile.indexOf("\nimporters:"), lockfile.indexOf("\npackages:"));
    for (const name of [...names, "react-native-nitro-modules", "react-native-mmkv"]) expect([name, importers.includes(`      ${name}:\n`)]).toEqual([name, false]);
    expect(lockfile).not.toContain("react-native-nitro-modules@");
    expect(lockfile).not.toContain("react-native-quick-crypto@");
    expect(lockfile).not.toContain("hermes-intl@");
    expect(lockfile).toContain("react-native-quick-base64@2.2.2");
  });
});

describe("quick-crypto's JavaScript dependencies are the library's", () => {
  const crypto = manifestOf(copy("react-native-quick-crypto"));
  const dependencies = Object.entries(crypto.dependencies ?? {});
  const requireFrom = createRequire(join(copy("react-native-quick-crypto", "src"), "index.ts"));

  test("each one is a dependency of the library, at the version quick-crypto pins", () => {
    expect(dependencies.map(([name]) => name).sort()).toEqual(["@craftzdog/react-native-buffer", "events", "readable-stream", "safe-buffer", "string_decoder", "util"]);
    for (const [name, range] of dependencies) expect([name, library.dependencies[name]]).toEqual([name, range]);
  });

  test("the specifiers are exact or caret ranges, and the installed versions satisfy them: a library dependency must resolve in an app", () => {
    for (const [name] of dependencies) {
      expect([name, library.dependencies[name]]).toEqual([name, expect.stringMatching(/^\^?\d+\.\d+\.\d+$/)]);
      const installed = manifestOf(dirname(requireFrom.resolve(`${name}/package.json`)));
      expect([name, installed.version.split(".")[0]]).toEqual([name, (library.dependencies[name] ?? "").replace("^", "").split(".")[0]]);
    }
  });

  test("none has native code, so none needs linking: no android or ios folder, no podspec, no codegen config; the one native package the Buffer package depends on is quick-base64, which is vendored", () => {
    for (const [name] of dependencies) {
      const directory = dirname(requireFrom.resolve(`${name}/package.json`));
      const entries = readdirSync(directory);
      expect([name, entries.filter((entry) => entry === "android" || entry === "ios" || entry.endsWith(".podspec") || entry === "react-native.config.js" || entry === "cpp")]).toEqual([name, []]);
      expect([name, manifestOf(directory).codegenConfig]).toEqual([name, undefined]);
    }
    const buffer = manifestOf(dirname(requireFrom.resolve("@craftzdog/react-native-buffer/package.json")));
    expect(Object.keys(buffer.dependencies ?? {}).sort()).toEqual(["ieee754", "react-native-quick-base64"]);
    expect(vendoredPackages.some((vendored) => vendored.name === "react-native-quick-base64")).toBe(true);
  });

  test("every package the copy's sources import (type-only imports aside) is one of its dependencies, a vendored package, a Node built-in the bundler maps, or React Native", () => {
    const known = new Set([...dependencies.map(([name]) => name), ...vendoredPackages.map((vendored) => vendored.name), "react-native", "crypto", "node:crypto"]);
    const found = new Set<string>();
    for (const file of filesUnder(copy("react-native-quick-crypto", "src")).filter((file) => /\.tsx?$/.test(file))) {
      const text = readFileSync(copy("react-native-quick-crypto", `src/${file}`), "utf8").replace(/import type[\s\S]*?from\s+['"][^'"]+['"]/g, "").replace(/\/\/.*$/gm, "");
      for (const [, specifier] of text.matchAll(/(?:from|require\()\s*['"]([^./'"][^'"]*)['"]/g)) found.add(specifier ?? "");
    }
    expect([...found].filter((specifier) => !known.has(specifier)).sort()).toEqual([]);
    expect(found.has("readable-stream")).toBe(true);
  });
});

describe("what `files` packs", () => {
  const packer = Bun.which("pnpm") ? ["pnpm", "pack", "--dry-run", "--json"] : ["npm", "pack", "--dry-run", "--json", "--ignore-scripts"];
  const run = Bun.spawnSync(packer, { cwd: packageRoot, stdout: "pipe", stderr: "pipe" });
  const parsed = JSON.parse(run.stdout.toString()) as { files: { path: string }[] } | { files: { path: string }[] }[];
  const listed = (Array.isArray(parsed) ? parsed[0] : parsed)?.files.map((file) => file.path) ?? [];

  test("the three copies are packed whole, each with its LICENSE and VENDOR.md: the JavaScript, the C++, the build files, the podspec, the generated Nitro code and hermes-intl's prebuilt libraries", () => {
    expect(run.exitCode).toBe(0);
    for (const path of [
      "vendor/react-native-quick-crypto/LICENSE", "vendor/react-native-quick-crypto/VENDOR.md", "vendor/react-native-quick-crypto/package.json", "vendor/react-native-quick-crypto/src/index.ts",
      "vendor/react-native-quick-crypto/QuickCrypto.podspec", "vendor/react-native-quick-crypto/android/build.gradle", "vendor/react-native-quick-crypto/android/CMakeLists.txt", "vendor/react-native-quick-crypto/android/gradle.properties",
      "vendor/react-native-quick-crypto/android/src/main/java/com/margelo/nitro/quickcrypto/QuickCryptoPackage.java", "vendor/react-native-quick-crypto/cpp/hash/HybridHash.cpp", "vendor/react-native-quick-crypto/deps/simdutf/src/simdutf.cpp",
      "vendor/react-native-quick-crypto/deps/ncrypto/src/ncrypto.cpp", "vendor/react-native-quick-crypto/deps/blake3/c/blake3.c", "vendor/react-native-quick-crypto/nitrogen/generated/android/QuickCrypto+autolinking.gradle",
      "vendor/react-native-quick-crypto/nitrogen/generated/ios/QuickCrypto+autolinking.rb",
      "vendor/react-native-quick-base64/LICENSE", "vendor/react-native-quick-base64/VENDOR.md", "vendor/react-native-quick-base64/package.json", "vendor/react-native-quick-base64/lib/module/index.js", "vendor/react-native-quick-base64/react-native-quick-base64.podspec",
      "vendor/react-native-quick-base64/android/build.gradle", "vendor/react-native-quick-base64/cpp/react-native-quick-base64.cpp", "vendor/react-native-quick-base64/ios/QuickBase64Module.mm",
      "vendor/hermes-intl/LICENSE", "vendor/hermes-intl/VENDOR.md", "vendor/hermes-intl/package.json", "vendor/hermes-intl/src/index.js", "vendor/hermes-intl/src/hostLocale.js", "vendor/hermes-intl/js/bootstrap.js", "vendor/hermes-intl/HermesIntl.podspec",
      "vendor/hermes-intl/android/CMakeLists.txt", "vendor/hermes-intl/android/build.gradle", "vendor/hermes-intl/cpp/hermes_intl.cpp", "vendor/hermes-intl/prebuilt/android/arm64-v8a/libhermes_intl.so", "vendor/hermes-intl/prebuilt/android/x86_64/libhermes_intl.so",
      "vendor/hermes-intl/prebuilt/ios/HermesIntlCore.xcframework/Info.plist",
    ])
      expect([path, listed.includes(path)]).toEqual([path, true]);
  });

  test("the Expo plugin and the built copies quick-crypto's copy leaves out are not in the pack, and neither is libsodium's source, which the podspec downloads into the copy when sodium is on", () => {
    expect(listed.filter((path) => /vendor\/react-native-quick-crypto\/(?:app\.plugin\.js|lib\/commonjs|lib\/module|src\/expo-plugin)/.test(path))).toEqual([]);
    expect(listed.filter((path) => path.includes("libsodium"))).toEqual([]);
    expect(library.files).toContain("!vendor/**/libsodium-stable");
  });
});
