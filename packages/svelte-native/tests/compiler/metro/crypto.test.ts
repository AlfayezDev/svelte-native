import { afterAll, describe, expect, test } from "bun:test";
import { createRequire } from "node:module";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ConfigT } from "@expo/metro/metro-config";
import { LITE_ORIGINS, NODE_CRYPTO, QUICK_CRYPTO, withSvelteNative } from "../../../src/metro.ts";
import { packageRoot } from "../../support/paths.ts";
import { type RealResolver, fakeConfig, resolveFrom as resolveWith } from "../../support/metro.ts";
import { createProject } from "../../support/project.ts";

/**
 * Node-style libraries import `crypto` or `node:crypto`; Metro resolves both to react-native-quick-crypto, from the app's directory. And the four packages `crypto` and
 * `localStorage` are made of get the React Native shim the other native-module packages get (`LITE_ORIGINS`), which must export what they import from `react-native`.
 */
// What Metro's own resolver would answer: the file name, with the directory it was asked from, so a test sees where an import was resolved from.
const real: RealResolver = (context, moduleName) => ({ type: "sourceFile", filePath: `/real/${moduleName} (from ${context.originModulePath})` });
const resolveFrom = (config: ConfigT, origin: string, moduleName: string): string => resolveWith(config, origin, moduleName, real);

describe("`crypto` and `node:crypto` are react-native-quick-crypto", () => {
  const project = createProject({}, "metro-crypto-");
  afterAll(() => project.remove());
  const root = project.directory;
  const config = withSvelteNative(fakeConfig(root), { variant: "qa" });
  const library = join(root, "node_modules/jose/dist/browser/index.js");
  const wanted = `/real/react-native-quick-crypto (from ${join(root, "package.json")})`;

  test("both names, from the app's code and from a library's, and the package is resolved from the app's package.json: a library written for Node does not depend on it, the app does", () => {
    expect([...NODE_CRYPTO]).toEqual(["crypto", "node:crypto"]);
    expect(QUICK_CRYPTO).toBe("react-native-quick-crypto");
    for (const origin of [join(root, "src/lib/hash.ts"), library]) {
      expect(resolveFrom(config, origin, "crypto")).toBe(wanted);
      expect(resolveFrom(config, origin, "node:crypto")).toBe(wanted);
    }
  });

  test("the package itself and every other name are resolved as before, from where they are imported", () => {
    expect(resolveFrom(config, library, "react-native-quick-crypto")).toBe(`/real/react-native-quick-crypto (from ${library})`);
    for (const name of ["crypto-js", "crypto/promises", "node:crypto/webcrypto", "node:buffer", "node:fs", "cryptography", "Crypto", "expo-crypto"]) {
      expect(resolveFrom(config, library, name), name).toBe(`/real/${name} (from ${library})`);
    }
  });

  test("an app that stubs the package gets its stub for `crypto` as well: the alias goes through the rest of the resolver", () => {
    using other = createProject({}, "metro-crypto-");
    const stubbed = withSvelteNative(fakeConfig(other.directory), { stubbedPackages: [QUICK_CRYPTO], variant: "smoke" });
    const stub = resolveFrom(stubbed, library, QUICK_CRYPTO);
    expect(stub).toContain(".svelte-native/stubs/smoke/react-native-quick-crypto.js");
    expect(resolveFrom(stubbed, library, "crypto")).toBe(stub);
    expect(resolveFrom(stubbed, library, "node:crypto")).toBe(stub);
  });
});

describe("the React Native shim of the packages `crypto` and `localStorage` are made of", () => {
  const packages = ["react-native-quick-crypto", "react-native-nitro-modules", "react-native-mmkv", "react-native-quick-base64"];
  const origin = (name: string, file = "lib/index.js") => `/app/node_modules/${name}/${file}`;

  test("LITE_ORIGINS has them, hoisted or in pnpm's store, and not a package that only starts like one", () => {
    for (const name of packages) {
      expect(LITE_ORIGINS.test(origin(name)), name).toBe(true);
      expect(LITE_ORIGINS.test(`/app/node_modules/.pnpm/${name}@1.0.0_react-native@0.86.3/node_modules/${name}/src/index.ts`), name).toBe(true);
      expect(LITE_ORIGINS.test(origin(`${name}-extra`)), `${name}-extra`).toBe(false);
    }
    expect(LITE_ORIGINS.test("/app/node_modules/react-native-mmkv-storage/index.js")).toBe(false);
  });

  /** The names a package's sources import from `react-native` (types left out), from the installed copy. */
  function importedFromReactNative(name: string): string[] {
    const directory = dirname(createRequire(import.meta.url).resolve(`${name}/package.json`));
    const names = new Set<string>();
    const walk = (folder: string) => {
      for (const entry of readdirSync(folder, { withFileTypes: true })) {
        const path = join(folder, entry.name);
        if (entry.isDirectory()) { if (entry.name !== "__tests__") walk(path); continue; }
        if (!/\.tsx?$/.test(entry.name) || /\.test\.tsx?$/.test(entry.name) || entry.name.endsWith(".d.ts")) continue;
        const source = readFileSync(path, "utf8");
        expect(/import\s+(?:\*\s+as\s+\w+|\w+)\s+from\s+['"]react-native['"]/.test(source), `${path} imports react-native as a namespace or by default`).toBe(false);
        for (const [, clause] of source.matchAll(/import\s+(?!type\b)\{([^}]*)\}\s+from\s+['"]react-native['"]/g)) {
          for (const item of (clause ?? "").split(",").map((part) => part.trim()).filter(Boolean)) if (!item.startsWith("type ")) names.add(item.split(/\s+as\s+/)[0] ?? item);
        }
      }
    };
    walk(join(directory, "src"));
    return [...names].sort();
  }

  /** What `react-native-lite.ts` exports. */
  const lite = readFileSync(join(packageRoot, "src/fabric/react-native-lite.ts"), "utf8");
  const exported = new Set([
    ...[...lite.matchAll(/^export (?:const|class|function) (\w+)/gm)].map((match) => match[1]),
    ...[...lite.matchAll(/^export \{ default as (\w+) \}/gm)].map((match) => match[1]),
    ...[...lite.matchAll(/^export \{ (\w+) \};?$/gm)].map((match) => match[1]),
  ]);

  test("what they import from `react-native` at run time is exported by the shim: a name the shim lacks is `undefined` in a bundle, and a native module call that depends on it fails on the device", () => {
    const imported = Object.fromEntries(packages.map((name) => [name, importedFromReactNative(name)]));
    // Not empty: this reads the packages' sources, and a layout change that made it read none would pass for nothing.
    expect(imported["react-native-nitro-modules"]).toContain("TurboModuleRegistry");
    expect(imported["react-native-mmkv"]).toContain("Platform");
    expect(imported["react-native-quick-base64"]).toEqual(["NativeModules"]);
    for (const [name, names] of Object.entries(imported)) for (const item of names) expect(exported.has(item), `${name} imports ${item} from react-native, which the shim does not export`).toBe(true);
  });
});
