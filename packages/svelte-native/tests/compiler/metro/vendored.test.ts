import { afterAll, describe, expect, test } from "bun:test";
import { realpathSync, symlinkSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { ConfigT } from "@expo/metro/metro-config";
import { isLiteOrigin, withSvelteNative } from "../../../src/metro.ts";
import { vendoredFileAs, vendoredImport, vendoredRoot, vendorDirectory } from "../../../src/vendored.ts";
import { packageRoot } from "../../support/paths.ts";
import { type RealResolver, fakeConfig, resolveFrom as resolveWith } from "../../support/metro.ts";
import { createProject } from "../../support/project.ts";

/**
 * The packages the library carries (`src/vendored.ts`) are the app's for every importer: Metro resolves their names, and every path below them, to `vendor/<name>/`, so the app, a
 * library that imports them (react-native-quick-crypto and the Nitro runtime) and the copies themselves share one module of each.
 */
const real: RealResolver = (context, moduleName) => ({ type: "sourceFile", filePath: `/real/${moduleName} (from ${context.originModulePath})` });
const resolveFrom = (config: ConfigT, origin: string, moduleName: string): string => resolveWith(config, origin, moduleName, real);
const copy = (name: string, path = "") => join(vendoredRoot(name), path);

describe("the names of the vendored packages", () => {
  const project = createProject({}, "metro-vendored-");
  afterAll(() => project.remove());
  const config = withSvelteNative(fakeConfig(project.directory), { variant: "qa" });
  const origins = [join(project.directory, "src/lib/storage.ts"), join(project.directory, "node_modules/react-native-quick-crypto/src/random.ts"), join(vendoredRoot("react-native-mmkv"), "src/getMMKVFactory.ts"), "/elsewhere/anything.js"];

  test("a bare name resolves to the copy, whoever imports it", () => {
    for (const origin of origins) {
      expect(resolveFrom(config, origin, "react-native-mmkv"), origin).toBe(`/real/${copy("react-native-mmkv")} (from ${origin})`);
      expect(resolveFrom(config, origin, "react-native-nitro-modules"), origin).toBe(`/real/${copy("react-native-nitro-modules")} (from ${origin})`);
    }
  });

  test("so does a path below it, which a library imports for a file of its own (a subpath, with or without an extension)", () => {
    const origin = origins[0] ?? "";
    expect(resolveFrom(config, origin, "react-native-mmkv/lib/index")).toBe(`/real/${copy("react-native-mmkv", "lib/index")} (from ${origin})`);
    expect(resolveFrom(config, origin, "react-native-nitro-modules/src/turbomodule/NativeNitroModules.ts")).toBe(`/real/${copy("react-native-nitro-modules", "src/turbomodule/NativeNitroModules.ts")} (from ${origin})`);
  });

  test("the library's own import (#vendor/<name>), a relative path and every other name are resolved as before, from where they are imported", () => {
    const origin = origins[0] ?? "";
    for (const name of ["#vendor/react-native-mmkv", "./react-native-mmkv", "react-native-mmkv-storage", "react-native-mmkv-extra/lib", "react-native-nitro-modules-extra", "react-native-quick-crypto", "mmkv", "@scope/react-native-mmkv"]) {
      expect(resolveFrom(config, origin, name), name).toBe(`/real/${name} (from ${origin})`);
    }
  });

  test("an app that stubs one of them gets its stub, as it does for any package: the stub is looked up first", () => {
    using other = createProject({}, "metro-vendored-");
    const stubbed = withSvelteNative(fakeConfig(other.directory), { stubbedPackages: ["react-native-mmkv"], variant: "smoke" });
    expect(resolveFrom(stubbed, origins[0] ?? "", "react-native-mmkv")).toContain(".svelte-native/stubs/smoke/react-native-mmkv.js");
    expect(resolveFrom(stubbed, origins[0] ?? "", "react-native-mmkv/lib/index")).toContain(".svelte-native/stubs/smoke/react-native-mmkv.js");
    expect(resolveFrom(stubbed, origins[0] ?? "", "react-native-nitro-modules")).toBe(`/real/${copy("react-native-nitro-modules")} (from ${origins[0]})`);
  });

  test("the app's own resolver sees the copy's path, as it would an installed package's", () => {
    const seen: string[] = [];
    const wrapped = withSvelteNative(fakeConfig(project.directory, { resolver: { sourceExts: ["ts"], resolveRequest: (_context: unknown, name: string) => { seen.push(name); return { type: "sourceFile", filePath: "/app-resolver" }; } } }), { variant: "qa" });
    const resolve = wrapped.resolver.resolveRequest as (context: unknown, name: string, platform: string) => { filePath: string };
    expect(resolve({ originModulePath: "/app/src/a.ts", resolveRequest: () => ({ type: "sourceFile", filePath: "/default" }) }, "react-native-mmkv", "ios").filePath).toBe("/app-resolver");
    expect(seen).toEqual([copy("react-native-mmkv")]);
  });
});

describe("vendoredImport and vendoredFileAs", () => {
  test("an import names a vendored package by its name, alone or with a path below it", () => {
    expect(vendoredImport("react-native-mmkv")?.subpath).toBe("");
    expect(vendoredImport("react-native-mmkv/lib/index")).toMatchObject({ vendored: { name: "react-native-mmkv" }, subpath: "lib/index" });
    expect(vendoredImport("react-native-nitro-modules/src/index")).toMatchObject({ vendored: { name: "react-native-nitro-modules" }, subpath: "src/index" });
    for (const name of ["react-native-mmkv-storage", "react-native", "react-native-nitro", "#vendor/react-native-mmkv", "./react-native-mmkv"]) expect(vendoredImport(name), name).toBeUndefined();
  });

  test("a file in a copy is named as the installed package's file would be, whether it is reached by its real path or through a link into the package", () => {
    const file = copy("react-native-mmkv", "src/index.ts");
    expect(vendoredFileAs(file)).toBe("react-native-mmkv/src/index.ts");
    expect(vendoredFileAs(copy("react-native-nitro-modules", "src/NitroModules.ts"))).toBe("react-native-nitro-modules/src/NitroModules.ts");
    expect(vendoredFileAs(vendorDirectory())).toBeUndefined();
    expect(vendoredFileAs(join(vendorDirectory(), "react-native-mmkv-storage/index.js"))).toBeUndefined();
    expect(vendoredFileAs(join(packageRoot, "src/mmkv.ts"))).toBeUndefined();
    expect(vendoredFileAs("/app/node_modules/react-native-mmkv/src/index.ts")).toBeUndefined();
    // Through a link (an app's node_modules/@alfayez/svelte-native points at the package): the other spelling of the same file.
    using app = createProject({}, "metro-vendored-link-");
    mkdirSync(join(app.directory, "node_modules/@alfayez"), { recursive: true });
    symlinkSync(realpathSync(packageRoot), join(app.directory, "node_modules/@alfayez/svelte-native"));
    expect(vendoredFileAs(file, join(app.directory, "node_modules/@alfayez/svelte-native"))).toBe("react-native-mmkv/src/index.ts");
  });
});

describe("the React Native shim", () => {
  test("the copies get it as the installed packages did: by name, from either spelling of the path", () => {
    expect(isLiteOrigin("/app/node_modules/react-native-mmkv/src/createMMKV/createMMKV.ts")).toBe(true);
    for (const name of ["react-native-mmkv", "react-native-nitro-modules"]) {
      expect(isLiteOrigin(copy(name, "src/index.ts")), name).toBe(true);
      expect(isLiteOrigin(copy(name, "lib/module/index.js")), name).toBe(true);
    }
    // The library's own files and a package that only starts like a vendored one do not.
    expect(isLiteOrigin(join(packageRoot, "src/mmkv.ts"))).toBe(false);
    expect(isLiteOrigin(join(vendorDirectory(), "react-native-mmkv-storage/index.js"))).toBe(false);
  });

  test("an import of react-native from a copy resolves to the shim; from the library's own source, to React Native", () => {
    using app = createProject({}, "metro-vendored-lite-");
    const config = withSvelteNative(fakeConfig(app.directory), { variant: "qa" });
    expect(resolveFrom(config, copy("react-native-mmkv", "src/createMMKV/createMMKV.ts"), "react-native")).toEndWith("src/fabric/react-native-lite.ts");
    expect(resolveFrom(config, copy("react-native-nitro-modules", "src/turbomodule/NativeNitroModules.ts"), "react-native")).toEndWith("src/fabric/react-native-lite.ts");
    expect(resolveFrom(config, join(packageRoot, "src/mmkv.ts"), "react-native")).toStartWith("/real/react-native");
  });
});
