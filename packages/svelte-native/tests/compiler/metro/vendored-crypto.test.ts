import { afterAll, describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ConfigT } from "@expo/metro/metro-config";
import { isLiteOrigin, LITE_ORIGINS, NODE_CRYPTO, QUICK_CRYPTO, withSvelteNative } from "../../../src/metro.ts";
import { vendoredFileAs, vendoredImport, vendoredRoot } from "../../../src/vendored.ts";
import { packageRoot } from "../../support/paths.ts";
import { type RealResolver, fakeConfig, resolveFrom as resolveWith } from "../../support/metro.ts";
import { createProject } from "../../support/project.ts";

/**
 * The crypto batch (react-native-quick-crypto, react-native-quick-base64, hermes-intl) in Metro (`vendored.test.ts` is the pilot's: the same rules, the same resolver). The names resolve to
 * the copies in `vendor/` for every importer, `crypto` and `node:crypto` reach the copy of quick-crypto, and the three get the React Native shim, which must export what they take from it.
 */
const real: RealResolver = (context, moduleName) => ({ type: "sourceFile", filePath: `/real/${moduleName} (from ${context.originModulePath})` });
const resolveFrom = (config: ConfigT, origin: string, moduleName: string): string => resolveWith(config, origin, moduleName, real);
const copy = (name: string, path = "") => join(vendoredRoot(name), path);
const names = ["react-native-quick-crypto", "react-native-quick-base64", "hermes-intl"] as const;

describe("the names of the three resolve to the copies, whoever imports them", () => {
  const project = createProject({}, "metro-vendored-crypto-");
  afterAll(() => project.remove());
  const config = withSvelteNative(fakeConfig(project.directory), { variant: "qa" });
  const origins = [
    join(project.directory, "src/lib/hash.ts"),
    // The Buffer package imports quick-base64 by name; the copy of quick-crypto imports the Buffer package, readable-stream and the Nitro runtime; a package installed beside the library may import any of them.
    join(project.directory, "node_modules/@craftzdog/react-native-buffer/index.js"),
    copy("react-native-quick-crypto", "src/subtle.ts"),
    copy("hermes-intl", "src/index.js"),
    "/elsewhere/anything.js",
  ];

  test("a bare name, and every path below it", () => {
    for (const origin of origins)
      for (const name of names) {
        expect(resolveFrom(config, origin, name), `${name} from ${origin}`).toBe(`/real/${copy(name)} (from ${origin})`);
        expect(resolveFrom(config, origin, `${name}/package.json`), name).toBe(`/real/${copy(name, "package.json")} (from ${origin})`);
      }
    expect(resolveFrom(config, origins[0] ?? "", "react-native-quick-crypto/src/subtle")).toBe(`/real/${copy("react-native-quick-crypto", "src/subtle")} (from ${origins[0]})`);
    expect(resolveFrom(config, origins[0] ?? "", "hermes-intl/js/bootstrap")).toBe(`/real/${copy("hermes-intl", "js/bootstrap")} (from ${origins[0]})`);
  });

  test("the library's own import (#vendor/<name>), a relative path and a name that only starts like one are resolved as before", () => {
    const origin = origins[0] ?? "";
    for (const name of ["#vendor/react-native-quick-crypto", "#vendor/hermes-intl", "./hermes-intl", "react-native-quick-base64-extra", "react-native-quick-crypto-extra/src", "hermes-intl-extra", "@scope/hermes-intl", "base64"]) {
      expect(resolveFrom(config, origin, name), name).toBe(`/real/${name} (from ${origin})`);
    }
    for (const name of names) expect(vendoredImport(`${name}-extra`), name).toBeUndefined();
  });

  test("`crypto` and `node:crypto` are the copy of quick-crypto, whoever imports them, and the bare name reaches the same directory the `imports` entry's source is in", () => {
    expect([...NODE_CRYPTO]).toEqual(["crypto", "node:crypto"]);
    for (const origin of origins) {
      for (const name of NODE_CRYPTO) expect(resolveFrom(config, origin, name), `${name} from ${origin}`).toBe(`/real/${copy(QUICK_CRYPTO)} (from ${join(project.directory, "package.json")})`);
    }
    // `#vendor/react-native-quick-crypto` (`src/index.ts` of the same copy) is what `web-crypto.ts` requires; Metro reads the `react-native` field of the copy for the directory the name gives.
    const manifest = JSON.parse(readFileSync(copy(QUICK_CRYPTO, "package.json"), "utf8")) as { "react-native": string };
    expect(join(copy(QUICK_CRYPTO), `${manifest["react-native"]}.ts`)).toBe(join(packageRoot, "vendor/react-native-quick-crypto/src/index.ts"));
  });

  test("an app that stubs one of them gets its stub, and `crypto` follows the stub of quick-crypto", () => {
    using other = createProject({}, "metro-vendored-crypto-");
    const stubbed = withSvelteNative(fakeConfig(other.directory), { stubbedPackages: ["react-native-quick-crypto", "hermes-intl"], variant: "smoke" });
    const origin = join(other.directory, "src/a.ts");
    expect(resolveFrom(stubbed, origin, "react-native-quick-crypto")).toContain(".svelte-native/stubs/smoke/react-native-quick-crypto.js");
    expect(resolveFrom(stubbed, origin, "node:crypto")).toContain(".svelte-native/stubs/smoke/react-native-quick-crypto.js");
    expect(resolveFrom(stubbed, origin, "hermes-intl/js/bootstrap")).toContain(".svelte-native/stubs/smoke/hermes-intl.js");
    expect(resolveFrom(stubbed, origin, "react-native-quick-base64")).toBe(`/real/${copy("react-native-quick-base64")} (from ${origin})`);
  });
});

describe("the React Native shim", () => {
  test("the three get it as the installed packages did: by name, from either spelling of the path, and the library's names for them are in LITE_ORIGINS", () => {
    for (const name of names) {
      expect(LITE_ORIGINS.test(`/app/node_modules/${name}/src/index.ts`), name).toBe(true);
      expect(isLiteOrigin(copy(name, "src/index.ts")), name).toBe(true);
      expect(vendoredFileAs(copy(name, "src/index.ts")), name).toBe(`${name}/src/index.ts`);
    }
    expect(isLiteOrigin(copy("react-native-quick-base64", "lib/module/index.js"))).toBe(true);
    expect(isLiteOrigin(copy("hermes-intl", "js/bootstrap.js"))).toBe(true);
    expect(isLiteOrigin(join(packageRoot, "src/web-crypto.ts"))).toBe(false);
    expect(isLiteOrigin(join(packageRoot, "vendor/hermes-intl-extra/src/index.js"))).toBe(false);
  });

  test("an import of react-native from a copy resolves to the shim; from the library's own source, to React Native", () => {
    using app = createProject({}, "metro-vendored-crypto-lite-");
    const config = withSvelteNative(fakeConfig(app.directory), { variant: "qa" });
    for (const [name, file] of [["react-native-quick-crypto", "src/utils/conversion.ts"], ["react-native-quick-base64", "lib/module/index.js"], ["hermes-intl", "src/index.js"], ["hermes-intl", "src/NativeHermesIntl.ts"]] as const)
      expect(resolveFrom(config, copy(name, file), "react-native"), `${name}/${file}`).toEndWith("src/fabric/react-native-lite.ts");
    expect(resolveFrom(config, join(packageRoot, "src/web-crypto.ts"), "react-native")).toStartWith("/real/react-native");
  });

  /** What hermes-intl takes from `react-native`, by an import or a require (its `src/` is JavaScript and a little TypeScript, so crypto.test.ts's reader of imports does not see it). */
  function takenFromReactNative(directory: string): string[] {
    const found = new Set<string>();
    for (const file of readdirSync(directory, { recursive: true, withFileTypes: true }).filter((entry) => entry.isFile() && /\.(?:js|ts)$/.test(entry.name))) {
      const text = readFileSync(join(file.parentPath, file.name), "utf8");
      for (const [, clause] of text.matchAll(/import\s+\{([^}]*)\}\s+from\s+['"]react-native['"]/g)) for (const item of (clause ?? "").split(",").map((part) => part.trim()).filter(Boolean)) found.add(item.split(/\s+as\s+/)[0] ?? item);
      for (const [, clause] of text.matchAll(/const\s+\{([^}]*)\}\s+=\s+require\(\s*['"]react-native['"]\s*\)/g)) for (const item of (clause ?? "").split(",").map((part) => part.trim()).filter(Boolean)) found.add(item);
    }
    return [...found].sort();
  }

  test("what hermes-intl takes from `react-native` is exported by the shim (a name it lacks is `undefined` in a bundle, and `Intl.PluralRules` then fails on the device)", () => {
    const lite = readFileSync(join(packageRoot, "src/fabric/react-native-lite.ts"), "utf8");
    const exported = new Set([...lite.matchAll(/^export (?:const|class|function) (\w+)/gm), ...lite.matchAll(/^export \{ default as (\w+) \}/gm), ...lite.matchAll(/^export \{ (\w+) \};?$/gm)].map((match) => match[1]));
    const taken = takenFromReactNative(copy("hermes-intl", "src"));
    // Not empty: this reads the copy's sources, and a layout change that made it read none would pass for nothing.
    expect(taken).toContain("I18nManager");
    expect(taken).toContain("TurboModuleRegistry");
    for (const item of taken.filter((name) => name !== "TurboModule")) expect([item, exported.has(item)]).toEqual([item, true]);
  });
});
