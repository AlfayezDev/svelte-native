import { afterAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { commandFor, excludedBy, filesUnder, packageRoot, parseSpec, vendorTarball } from "../../scripts/vendor.ts";

// `scripts/vendor.ts` (VENDORING.md): the published tarball of a third-party package unpacked into `vendor/<name>/`, its license, and a `VENDOR.md`. These tests build a tarball the way npm does
// (one `package/` directory) from files below, so nothing here touches the network; the copies in `vendor/` are checked against the notes the script wrote for them.
const scratch = mkdtempSync(join(tmpdir(), "expo-svelte-vendor-test-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

let counter = 0;
const fresh = (): string => {
  const directory = join(scratch, `case-${counter++}`);
  mkdirSync(directory, { recursive: true });
  return directory;
};

/** An npm tarball: `files` under a `package/` directory. */
function pack(files: Record<string, string>, manifest: Record<string, unknown> = {}): string {
  const directory = fresh();
  const root = join(directory, "package");
  const all = { "package.json": JSON.stringify({ name: "fake-native", version: "1.2.3", repository: { type: "git", url: "git+https://github.com/example/fake-native.git" }, ...manifest }), ...files };
  for (const [file, content] of Object.entries(all)) {
    mkdirSync(join(root, file, ".."), { recursive: true });
    writeFileSync(join(root, file), content);
  }
  const tarball = join(directory, "fake-native-1.2.3.tgz");
  execFileSync("tar", ["-czf", tarball, "-C", directory, "package"]);
  return tarball;
}

const sources = { "android/build.gradle": "apply plugin: 'com.android.library'\n", "ios/Thing.swift": "import Foundation\n", "src/index.ts": "export const x = 1\n", "lib/tsconfig.build.tsbuildinfo": "{}", "Fake.podspec": "Pod::Spec.new\n" };
const mit = "MIT License\n\nCopyright (c) 2024 Someone\n";

describe("parseSpec", () => {
  test("takes an exact version of a plain or scoped name, and nothing else", () => {
    expect(parseSpec("react-native-mmkv@4.3.1")).toEqual({ name: "react-native-mmkv", version: "4.3.1" });
    expect(parseSpec("@scope/name@0.1.0-rc.1")).toEqual({ name: "@scope/name", version: "0.1.0-rc.1" });
    for (const spec of ["react-native-mmkv", "react-native-mmkv@^4.3.1", "react-native-mmkv@latest", "react-native-mmkv@4", "@4.3.1", "../x@1.0.0"]) expect(() => parseSpec(spec)).toThrow();
  });
});

describe("vendorTarball", () => {
  test("unpacks the tarball's files as they are into <into>/<name>, with the license it holds and a VENDOR.md", () => {
    const into = fresh();
    const tarball = pack({ ...sources, LICENSE: mit });
    const result = vendorTarball({ tarball, name: "fake-native", version: "1.2.3", into });
    const directory = join(into, "fake-native");
    expect(result.directory).toBe(directory);
    expect(filesUnder(directory)).toEqual(["Fake.podspec", "LICENSE", "VENDOR.md", "android/build.gradle", "ios/Thing.swift", "lib/tsconfig.build.tsbuildinfo", "package.json", "src/index.ts"]);
    for (const [file, content] of Object.entries(sources)) expect([file, readFileSync(join(directory, file), "utf8")]).toEqual([file, content]);
    // The license is the tarball's, byte for byte.
    expect(readFileSync(join(directory, "LICENSE"), "utf8")).toBe(mit);
    expect(result.license).toEqual({ file: "LICENSE", source: "the tarball", sha256: createHash("sha256").update(mit).digest("hex") });
  });

  test("VENDOR.md names the upstream, the tarball's integrity and sha256, what was left out and every local change", () => {
    const into = fresh();
    const tarball = pack({ ...sources, LICENSE: mit });
    const data = readFileSync(tarball);
    const result = vendorTarball({ tarball, name: "fake-native", version: "1.2.3", into });
    const notes = readFileSync(join(into, "fake-native/VENDOR.md"), "utf8");
    expect(notes).toStartWith("# fake-native 1.2.3 (vendored)\n");
    expect(notes).toContain("`fake-native` 1.2.3 on npm, repository https://github.com/example/fake-native");
    expect(notes).toContain(`\`sha512-${createHash("sha512").update(data).digest("base64")}\``);
    expect(result.integrity).toBe(`sha512-${createHash("sha512").update(data).digest("base64")}`);
    expect(notes).toContain(`sha256: \`${createHash("sha256").update(data).digest("hex")}\``);
    expect(notes).toContain(`${data.length} bytes, 7 files`);
    expect(notes).toContain("## Left out\n\nNothing: the files here are the tarball's.");
    expect(notes).toContain("## Local changes\n\nNone.");
    expect(notes).toContain("`node scripts/vendor.ts fake-native@1.2.3`");
  });

  test("a tarball without a license gets the one it is given, and says where it is from; without one it is refused", () => {
    const into = fresh();
    const tarball = pack(sources);
    const source = "https://raw.githubusercontent.com/example/fake-native/0123abc/LICENSE";
    const result = vendorTarball({ tarball, name: "fake-native", version: "1.2.3", into, license: { text: mit, source } });
    expect(readFileSync(join(into, "fake-native/LICENSE"), "utf8")).toBe(mit);
    expect(result.license).toEqual({ file: "LICENSE", source, sha256: createHash("sha256").update(mit).digest("hex") });
    expect(readFileSync(join(into, "fake-native/VENDOR.md"), "utf8")).toContain(`License: \`LICENSE\` from ${source}, sha256 \`${result.license.sha256}\``);
    // The tarball's own file count is the one in the notes: the license that was added is not in it.
    expect(readFileSync(join(into, "fake-native/VENDOR.md"), "utf8")).toContain("6 files");
    expect(() => vendorTarball({ tarball, name: "fake-native", version: "1.2.3", into: fresh() })).toThrow("has no license file");
  });

  test("a license file of another spelling is the tarball's license", () => {
    const into = fresh();
    const result = vendorTarball({ tarball: pack({ ...sources, "LICENCE.md": mit }), name: "fake-native", version: "1.2.3", into });
    expect(result.license.file).toBe("LICENCE.md");
    expect(existsSync(join(into, "fake-native/LICENSE"))).toBe(false);
  });

  test("an exclusion is removed from the copy and listed in VENDOR.md, with the command that reproduces it; a path the tarball lacks, or outside it, is refused", () => {
    const into = fresh();
    const tarball = pack({ ...sources, LICENSE: mit });
    const result = vendorTarball({ tarball, name: "fake-native", version: "1.2.3", into, exclude: ["lib/tsconfig.build.tsbuildinfo"] });
    expect(result.excluded).toEqual(["lib/tsconfig.build.tsbuildinfo"]);
    expect(existsSync(join(into, "fake-native/lib/tsconfig.build.tsbuildinfo"))).toBe(false);
    const notes = readFileSync(join(into, "fake-native/VENDOR.md"), "utf8");
    expect(notes).toContain("## Left out\n\n- `lib/tsconfig.build.tsbuildinfo`");
    expect(notes).toContain("`node scripts/vendor.ts fake-native@1.2.3 --exclude lib/tsconfig.build.tsbuildinfo`");
    expect(() => vendorTarball({ tarball, name: "fake-native", version: "1.2.3", into: fresh(), exclude: ["nope"] })).toThrow("no such path");
    expect(() => vendorTarball({ tarball, name: "fake-native", version: "1.2.3", into: fresh(), exclude: ["../x"] })).toThrow("inside the package");
    expect(commandFor("a", "1.0.0", ["x", "y/z"], "https://e/LICENSE")).toBe("node scripts/vendor.ts a@1.0.0 --license-url https://e/LICENSE --exclude x --exclude y/z");
  });

  test("an exclusion with * is a pattern over the package's files: * stays in one directory, a directory part of two stars and a slash is any number of them, and the command quotes it", () => {
    const files = ["lib/a.js", "lib/a.js.map", "lib/x/b.d.ts.map", "lib/x/y/c.js.map", "src/a.map", "map"];
    expect(excludedBy("plain/path", files)).toEqual(["plain/path"]);
    expect(excludedBy("lib/**/*.map", files)).toEqual(["lib/a.js.map", "lib/x/b.d.ts.map", "lib/x/y/c.js.map"]);
    expect(excludedBy("lib/*.map", files)).toEqual(["lib/a.js.map"]);
    expect(excludedBy("**/*.map", files)).toEqual(["lib/a.js.map", "lib/x/b.d.ts.map", "lib/x/y/c.js.map", "src/a.map"]);
    expect(excludedBy("lib/a*js", ["lib/aXjs", "lib/a.js", "lib/a/js"])).toEqual(["lib/aXjs", "lib/a.js"]);
    expect(excludedBy("lib/*.nothing", files)).toEqual([]);
    expect(commandFor("a", "1.0.0", ["x", "lib/**/*.map"])).toBe("node scripts/vendor.ts a@1.0.0 --exclude x --exclude 'lib/**/*.map'");
    const into = fresh();
    const tarball = pack({ ...sources, LICENSE: mit, "lib/a.js": "1", "lib/a.js.map": "{}", "lib/deep/b.d.ts.map": "{}" });
    const result = vendorTarball({ tarball, name: "fake-native", version: "1.2.3", into, exclude: ["lib/**/*.map"] });
    expect(filesUnder(join(into, "fake-native")).filter((file) => file.startsWith("lib/"))).toEqual(["lib/a.js", "lib/tsconfig.build.tsbuildinfo"]);
    expect(result.excluded).toEqual(["lib/**/*.map"]);
    expect(readFileSync(join(into, "fake-native/VENDOR.md"), "utf8")).toContain("`node scripts/vendor.ts fake-native@1.2.3 --exclude 'lib/**/*.map'`");
    expect(() => vendorTarball({ tarball, name: "fake-native", version: "1.2.3", into: fresh(), exclude: ["lib/**/*.nothing"] })).toThrow("no such path");
  });

  test("a patch is applied after the unpack and recorded as a local change; one that does not apply fails and leaves the earlier copy as it was", () => {
    const into = fresh();
    const tarball = pack({ ...sources, LICENSE: mit });
    const patch = join(fresh(), "0001-index.patch");
    writeFileSync(patch, "diff --git a/src/index.ts b/src/index.ts\n--- a/src/index.ts\n+++ b/src/index.ts\n@@ -1 +1 @@\n-export const x = 1\n+export const x = 2\n");
    const result = vendorTarball({ tarball, name: "fake-native", version: "1.2.3", into, patches: [patch] });
    expect(readFileSync(join(into, "fake-native/src/index.ts"), "utf8")).toBe("export const x = 2\n");
    expect(result.patches).toEqual([{ file: patch, sha256: createHash("sha256").update(readFileSync(patch)).digest("hex") }]);
    expect(readFileSync(join(into, "fake-native/VENDOR.md"), "utf8")).toContain(`## Local changes\n\n- \`${patch}\``);
    // A patch of the package's own vendor-patches/ is named by its place there, not by the directory of the machine that ran the script.
    const own = join(packageRoot, "vendor-patches/fake-native/0001-index.patch");
    mkdirSync(join(packageRoot, "vendor-patches/fake-native"), { recursive: true });
    try {
      writeFileSync(own, readFileSync(patch));
      const placed = fresh();
      expect(vendorTarball({ tarball, name: "fake-native", version: "1.2.3", into: placed, patches: [own] }).patches[0]?.file).toBe("vendor-patches/fake-native/0001-index.patch");
      expect(readFileSync(join(placed, "fake-native/VENDOR.md"), "utf8")).toContain("- `vendor-patches/fake-native/0001-index.patch` (sha256");
    } finally {
      rmSync(join(packageRoot, "vendor-patches/fake-native"), { recursive: true, force: true });
    }
    const broken = join(fresh(), "0002-broken.patch");
    writeFileSync(broken, "--- a/src/index.ts\n+++ b/src/index.ts\n@@ -1 +1 @@\n-nothing like it\n+x\n");
    expect(() => vendorTarball({ tarball, name: "fake-native", version: "1.2.3", into, patches: [broken] })).toThrow();
    expect(readFileSync(join(into, "fake-native/src/index.ts"), "utf8")).toBe("export const x = 2\n");
  });

  test("a tarball of another name or version is refused", () => {
    const tarball = pack({ ...sources, LICENSE: mit });
    expect(() => vendorTarball({ tarball, name: "fake-native", version: "9.9.9", into: fresh() })).toThrow("fake-native@1.2.3, not fake-native@9.9.9");
    expect(() => vendorTarball({ tarball, name: "other", version: "1.2.3", into: fresh() })).toThrow("not other@1.2.3");
  });

  test("the copy is replaced as a whole and is the same bytes every time: a file of the earlier copy is gone, nothing depends on the date or the directory", () => {
    const into = fresh();
    const tarball = pack({ ...sources, LICENSE: mit });
    mkdirSync(join(into, "fake-native"), { recursive: true });
    writeFileSync(join(into, "fake-native/stale.txt"), "left from an older version");
    vendorTarball({ tarball, name: "fake-native", version: "1.2.3", into });
    expect(existsSync(join(into, "fake-native/stale.txt"))).toBe(false);
    const again = fresh();
    vendorTarball({ tarball, name: "fake-native", version: "1.2.3", into: again });
    const first = filesUnder(join(into, "fake-native"));
    expect(filesUnder(join(again, "fake-native"))).toEqual(first);
    for (const file of first) expect([file, readFileSync(join(into, "fake-native", file)).equals(readFileSync(join(again, "fake-native", file)))]).toEqual([file, true]);
  });
});

describe("the copies in vendor/ are what the script wrote", () => {
  const vendor = join(import.meta.dirname, "../../vendor");
  const names = ["react-native-mmkv", "react-native-nitro-modules", "react-native-gesture-handler", "react-native-reanimated", "react-native-worklets", "react-native-svg"];

  for (const name of names) {
    test(`${name}: package.json, LICENSE and VENDOR.md agree (name, version, the license's sha256, the command that reproduces it)`, () => {
      const directory = join(vendor, name);
      const manifest = JSON.parse(readFileSync(join(directory, "package.json"), "utf8")) as { name: string; version: string };
      const notes = readFileSync(join(directory, "VENDOR.md"), "utf8");
      expect(manifest.name).toBe(name);
      expect(notes).toStartWith(`# ${name} ${manifest.version} (vendored)\n`);
      expect(notes).toContain(`\`node scripts/vendor.ts ${name}@${manifest.version}`);
      expect(notes).toContain(`sha256 \`${createHash("sha256").update(readFileSync(join(directory, "LICENSE"))).digest("hex")}\``);
      expect(notes).toMatch(/Integrity \(npm's `dist.integrity`\): `sha512-[A-Za-z0-9+/=]+`/);
      // A copy that differs from its tarball says how in "Local changes": one line for each file of vendor-patches/<name>/ (and none for a package that has no patch), with the sha256 of the file.
      const patchDirectory = join(import.meta.dirname, "../../vendor-patches", name);
      const patches = existsSync(patchDirectory) ? readdirSync(patchDirectory).filter((file) => file.endsWith(".patch")).sort() : [];
      if (patches.length === 0) expect(notes).toContain("## Local changes\n\nNone.");
      else {
        const listed = [...notes.slice(notes.indexOf("## Local changes")).matchAll(/^- `([^`]+)` \(sha256 `([0-9a-f]{64})`\)/gm)].map((match) => [match[1], match[2]]);
        expect(listed).toEqual(patches.map((file) => [`vendor-patches/${name}/${file}`, createHash("sha256").update(readFileSync(join(patchDirectory, file))).digest("hex")]));
      }
      expect(readFileSync(join(directory, "LICENSE"), "utf8")).toMatch(/^(?:The )?MIT License\b/);
    });
  }
});
