import { createHash } from "node:crypto";
import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { patchSpecs } from "../../src/doctor/patches.ts";
import { readerFor } from "../../src/doctor/resolve.ts";
import { optionalPackages, vendoredRoot } from "../../src/vendored.ts";

/**
 * The optional libraries the package carries (`vendor/`, VENDORING.md "Optional libraries"): what each copy holds, what was left out of it and why `VENDOR.md` says so, the licenses, the
 * patches that are in the copies, and what the packed package has. The apps list none of them.
 */
const root = resolve(import.meta.dirname, "../..");
const repository = resolve(root, "../..");
const read = (path: string) => readFileSync(join(root, path), "utf8");
const names = optionalPackages.map((vendored) => vendored.name);
const manifest = JSON.parse(read("package.json")) as { peerDependencies: Record<string, string>; peerDependenciesMeta?: Record<string, unknown>; dependencies: Record<string, string>; devDependencies?: Record<string, string>; files: string[] };

/** Every file below `directory`, relative to it. */
const filesUnder = (directory: string): string[] => readdirSync(directory, { recursive: true, withFileTypes: true }).filter((entry) => entry.isFile()).map((entry) => join(entry.parentPath, entry.name).slice(directory.length + 1));

describe("the copies", () => {
  test("each is the package at the version the registry pins, with its license and the VENDOR.md that came with it", () => {
    for (const vendored of optionalPackages) {
      const directory = vendoredRoot(vendored.name);
      const json = JSON.parse(readFileSync(join(directory, "package.json"), "utf8")) as { name: string; version: string };
      expect([json.name, json.version]).toEqual([vendored.name, vendored.version]);
      const notes = readFileSync(join(directory, "VENDOR.md"), "utf8");
      expect(notes, vendored.name).toStartWith(`# ${vendored.name} ${vendored.version} (vendored)`);
      expect(notes).toContain("sha512-");
      expect(notes).toContain(`node scripts/vendor.ts ${vendored.name}@${vendored.version}`);
      // The license file the notes name, and its sha256.
      const license = /- License: `([^`]+)` from [^,]+, sha256 `([0-9a-f]{64})`/.exec(notes);
      expect([vendored.name, license?.[1] !== undefined]).toEqual([vendored.name, true]);
      expect(createHash("sha256").update(readFileSync(join(directory, license?.[1] ?? ""))).digest("hex"), `${vendored.name}'s license`).toBe(license?.[2]);
    }
  });

  test("lottie-react-native is Apache-2.0: its tarball has no LICENSE, so the repository's is kept, from the commit npm records for the version, and there is no NOTICE to keep", () => {
    const directory = vendoredRoot("lottie-react-native");
    expect(JSON.parse(readFileSync(join(directory, "package.json"), "utf8")).license).toBe("Apache-2.0");
    expect(readFileSync(join(directory, "LICENSE"), "utf8")).toContain("Apache License\n                           Version 2.0, January 2004");
    expect(readFileSync(join(directory, "VENDOR.md"), "utf8")).toMatch(/- License: `LICENSE` from https:\/\/raw\.githubusercontent\.com\/lottie-react-native\/lottie-react-native\/2d60a7b0b6782d1f606991654880b993566dba6d\/LICENSE/);
    expect(existsSync(join(directory, "NOTICE"))).toBe(false);
  });

  test("what was left out is what VENDOR.md lists, and the precompiled frameworks, the Windows and macOS ports, the tests and the tsbuildinfo files are not there", () => {
    for (const vendored of optionalPackages) {
      const directory = vendoredRoot(vendored.name);
      const left = /## Left out\n\n([\s\S]*?)\n\n## Local changes/.exec(readFileSync(join(directory, "VENDOR.md"), "utf8"))?.[1] ?? "";
      for (const path of [...left.matchAll(/^- `([^`]+)`$/gm)].map((match) => match[1] ?? "")) expect([vendored.name, path, existsSync(join(directory, path))]).toEqual([vendored.name, path, false]);
      const files = filesUnder(directory);
      expect(files.filter((file) => /^prebuilds\/|^windows\/|^macos\/|\.tsbuildinfo$|(^|\/)__tests__\/|\.(test|spec)\.[cm]?[jt]sx?$/.test(file)), vendored.name).toEqual([]);
    }
    // The two Expo modules that publish precompiled iOS frameworks: Expo uses them only with EXPO_USE_PRECOMPILED_MODULES=1, and they are 140 MB.
    for (const name of ["expo-image", "expo-video"]) expect(readFileSync(join(vendoredRoot(name), "VENDOR.md"), "utf8")).toContain("- `prebuilds`");
  });

  test("an Expo module keeps what Expo's autolinker and the Android build read: its module config, its Android project with the prebuilt artifact it publishes, its podspec and its JavaScript", () => {
    for (const vendored of optionalPackages.filter((candidate) => candidate.optional?.kind === "expo")) {
      const directory = vendoredRoot(vendored.name);
      const config = JSON.parse(readFileSync(join(directory, "expo-module.config.json"), "utf8")) as { android: { publication?: { repository: string; groupId: string; artifactId: string; version?: string } } };
      expect(existsSync(join(directory, "android/build.gradle")), vendored.name).toBe(true);
      expect(readdirSync(join(directory, "ios")).some((file) => file.endsWith(".podspec")), vendored.name).toBe(true);
      expect(existsSync(join(directory, "build")) || existsSync(join(directory, "src")), vendored.name).toBe(true);
      // Expo's Android build uses the published artifact in local-maven-repo/ when the module declares one: the copy has it, at the version of the package.
      const publication = config.android.publication;
      if (publication !== undefined) {
        // Expo SDK 58's config leaves the version out: it is the package's.
        const version = publication.version ?? (JSON.parse(readFileSync(join(directory, "package.json"), "utf8")) as { version: string }).version;
        const artifact = join(directory, publication.repository, publication.groupId.replaceAll(".", "/"), publication.artifactId, version, `${publication.artifactId}-${version}.aar`);
        expect([vendored.name, existsSync(artifact)]).toEqual([vendored.name, true]);
      }
      if (vendored.optional?.plugin !== undefined) expect(existsSync(join(directory, "plugin/build")), `${vendored.name}'s config plugin`).toBe(true);
    }
  });
});

describe("the patches", () => {
  test("each patch of vendor-patches/ is listed in its copy's VENDOR.md with its sha256, and its shape is in the copy (what the doctor looks for)", () => {
    const patched = readdirSync(join(root, "vendor-patches"));
    expect(patched.sort()).toEqual(["lottie-react-native", "react-native-blob-util", "react-native-gesture-handler", "react-native-maps", "react-native-nitro-modules", "react-native-pdf", "react-native-quick-base64", "react-native-reanimated", "react-native-video", "react-native-worklets", "rive-react-native"]);
    for (const name of patched) {
      const files = readdirSync(join(root, "vendor-patches", name)).filter((file) => file.endsWith(".patch")).sort();
      expect(files.length).toBeGreaterThan(0);
      const notes = read(`vendor/${name}/VENDOR.md`);
      for (const file of files) {
        const hash = createHash("sha256").update(read(`vendor-patches/${name}/${file}`)).digest("hex");
        expect(notes, `${name}/${file}`).toContain(`- \`vendor-patches/${name}/${file}\` (sha256 \`${hash}\`), applied with \`patch -p1\` after the unpack`);
      }
      const spec = patchSpecs.find((candidate) => candidate.package === name);
      expect([name, spec?.vendored]).toEqual([name, true]);
      expect([name, spec?.inspect(readerFor(vendoredRoot(name)), "")]).toEqual([name, []]);
    }
    // And no copy is patched that has no patch file: VENDOR.md says "None." for the others.
    for (const name of names.filter((candidate) => !patched.includes(candidate))) expect(read(`vendor/${name}/VENDOR.md`), name).toContain("## Local changes\n\nNone.");
  });

  test("react-native-pdf finds react-native from the app's directory upwards (its second patch), not from the package's own place beside it in node_modules", () => {
    const gradle = read("vendor/react-native-pdf/android/build.gradle");
    expect(gradle).toContain("def reactNativeFromAncestor = new File(directory, \"node_modules/react-native\")");
    expect(gradle).not.toContain("reactNativeFromNodeModulesWithPDF");
  });

  test("the patches are no longer the pnpm patches an app declared: not in patches/, not in the workspace's patchedDependencies", () => {
    expect(readdirSync(join(root, "patches")).filter((file) => /lottie|react-native-(maps|pdf|video)/.test(file))).toEqual([]);
    const workspace = readFileSync(join(repository, "pnpm-workspace.yaml"), "utf8");
    for (const name of ["lottie-react-native", "react-native-maps", "react-native-pdf", "react-native-video"]) expect([name, workspace.includes(`${name}@`)]).toEqual([name, false]);
  });
});

describe("nobody installs them", () => {
  test("the package lists none of them as a peer, a dependency or a development dependency", () => {
    for (const name of names) expect([name, manifest.peerDependencies[name], manifest.peerDependenciesMeta?.[name], manifest.dependencies[name], manifest.devDependencies?.[name]]).toEqual([name, undefined, undefined, undefined, undefined]);
  });

  test("neither do the example app, the QA app, the minimal example and the docs app: their package.json lists the library and nothing beside it", () => {
    for (const directory of ["apps/example", "apps/qa", "apps/docs", "examples/minimal"]) {
      const json = JSON.parse(readFileSync(join(repository, directory, "package.json"), "utf8")) as Record<string, Record<string, string> | undefined>;
      const listed = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"].flatMap((group) => Object.keys(json[group] ?? {}));
      expect([directory, listed.filter((name) => names.includes(name))]).toEqual([directory, []]);
    }
  });

  test("the example app turns on what its Native views screens use, and no more", () => {
    const config = readFileSync(join(repository, "apps/example/app.config.ts"), "utf8");
    const listed = [...(/libraries: \{([\s\S]*?)\n {6}\},/.exec(config)?.[1] ?? "").matchAll(/"([^"]+)":/g)].map((match) => match[1]);
    expect(listed.sort()).toEqual(names.filter((name) => !["expo-blur", "expo-video", "react-native-blob-util"].includes(name)).sort());
  });
});

describe("what is packed", () => {
  const packer = Bun.which("pnpm") ? ["pnpm", "pack", "--dry-run", "--json"] : ["npm", "pack", "--dry-run", "--json", "--ignore-scripts"];
  const run = Bun.spawnSync(packer, { cwd: root, stdout: "pipe", stderr: "pipe" });
  const parsed = JSON.parse(run.stdout.toString()) as { files: { path: string; size?: number }[] } | { files: { path: string; size?: number }[] }[];
  const files = (Array.isArray(parsed) ? parsed[0] : parsed)?.files ?? [];
  const listed = files.map((file) => file.path);

  test("every copy is whole: its package.json, license, VENDOR.md, native projects and JavaScript, the Expo modules' build/ and plugin/build/, and vendor-patches/", () => {
    for (const vendored of optionalPackages) {
      const prefix = `vendor/${vendored.name}/`;
      for (const file of ["package.json", "VENDOR.md"]) expect([prefix + file, listed.includes(prefix + file)]).toEqual([prefix + file, true]);
      expect([vendored.name, listed.some((path) => path.startsWith(`${prefix}LICENSE`))]).toEqual([vendored.name, true]);
      expect([vendored.name, listed.some((path) => path.startsWith(`${prefix}android/`))]).toEqual([vendored.name, true]);
      if (vendored.optional?.kind === "expo") {
        expect([vendored.name, listed.some((path) => path.startsWith(`${prefix}build/`)), listed.includes(`${prefix}expo-module.config.json`)]).toEqual([vendored.name, true, true]);
        if (vendored.optional.plugin !== undefined) expect([vendored.name, listed.some((path) => path.startsWith(`${prefix}plugin/build/`))]).toEqual([vendored.name, true]);
      }
    }
    expect(listed.filter((path) => path.startsWith("vendor-patches/")).length).toBe(17);
    // The prebuilt AAR the Android build of an Expo module uses.
    expect(listed).toContain("vendor/expo-image/local-maven-repo/expo/modules/image/expo.modules.image/58.0.18/expo.modules.image-58.0.18.aar");
    // Left out of the pack as native build output, never the JavaScript below build/.
    expect(listed.filter((path) => /(^|\/)(android|ios)\/build\//.test(path))).toEqual([]);
  });

  test("what the optional libraries add to the package, in bytes of the files (the number the build report quotes)", () => {
    const own = files.filter((file) => names.some((name) => file.path.startsWith(`vendor/${name}/`)));
    const bytes = own.reduce((sum, file) => sum + (file.size ?? 0), 0);
    // A guard against a copy that grows by an unexcluded folder (the 140 MB of precompiled frameworks of expo-image and expo-video): the sixteen copies are about 14 MB.
    expect(own.length).toBeGreaterThan(1000);
    expect(bytes).toBeLessThan(20 * 1024 * 1024);
  });
});
