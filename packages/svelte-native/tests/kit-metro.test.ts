import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ConfigT } from "@expo/metro/metro-config";
import { KIT_MODULES, KIT_UNAVAILABLE, kitResolution } from "../src/kit/modules.ts";
import { withSvelteNative } from "../src/metro.ts";
import { sourceFile } from "../src/package-root.ts";

/** SvelteKit's modules on the device: the imports Metro resolves to the library's files (`withSvelteNative`) and the ones it refuses; `svelte/motion` is not among them: it is Svelte's own. */
function fakeConfig(projectRoot: string): ConfigT {
  return { projectRoot, resolver: { sourceExts: ["ts"], resolveRequest: undefined }, serializer: { getModulesRunBeforeMainModule: () => [] }, transformer: {} } as unknown as ConfigT;
}
// What Metro's own resolver would answer: the file name, so a test sees an import that fell through to it.
const real = { resolveRequest: (_context: unknown, moduleName: string) => ({ type: "sourceFile", filePath: `/real/${moduleName}` }) };
const root = mkdtempSync(join(tmpdir(), "kit-metro-"));
const config = withSvelteNative(fakeConfig(root), { variant: "qa" });
const resolveFrom = (origin: string, moduleName: string): string => {
  const resolveRequest = config.resolver.resolveRequest as (context: unknown, moduleName: string, platform: string) => { filePath: string };
  return resolveRequest({ ...real, originModulePath: origin, unstable_conditionNames: [] }, moduleName, "android").filePath;
};
const app = join(root, "src/routes/+mobile.svelte");

describe("SvelteKit's modules resolve to the library's files", () => {
  test("$app/navigation, $app/state, $app/env, $app/environment and $app/paths, from an app's code and from a library's", () => {
    expect(Object.keys(KIT_MODULES)).toEqual(["$app/navigation", "$app/state", "$app/env", "$app/environment", "$app/paths"]);
    for (const [name, file] of Object.entries(KIT_MODULES)) {
      expect(existsSync(sourceFile(file)), file).toBe(true);
      expect(resolveFrom(app, name), name).toBe(sourceFile(file));
      expect(resolveFrom(join(root, "node_modules/some-svelte-lib/Nav.svelte"), name), name).toBe(sourceFile(file));
    }
    // `$app/env` is SvelteKit 3's name and `$app/environment` the deprecated one: one device module answers both.
    expect(resolveFrom(app, "$app/environment")).toBe(resolveFrom(app, "$app/env"));
  });

  test("a path inside one of them, and a package that only starts like one, are not the library's", () => {
    expect(resolveFrom(app, "$app/navigation/client")).toBe("/real/$app/navigation/client");
    expect(resolveFrom(app, "$app/state-extra")).toBe("/real/$app/state-extra");
    expect(resolveFrom(app, "@sveltejs/kit")).toBe("/real/@sveltejs/kit");
    // A name of Object.prototype is no module.
    expect(resolveFrom(app, "constructor")).toBe("/real/constructor");
    expect(resolveFrom(app, "toString")).toBe("/real/toString");
  });

  test("what has nothing behind it on the device fails the bundle, naming the module, why and the guide's page", () => {
    for (const [name, why] of Object.entries(KIT_UNAVAILABLE)) expect(() => resolveFrom(app, name), name).toThrow(`${name} is not available on the device (svelte-native): ${why}. The guide's "SvelteKit modules" page lists what is.`);
    expect(Object.keys(KIT_UNAVAILABLE)).toEqual(["$app/forms", "$app/manifest", "$app/service-worker", "$app/stores", "$app/env/public"]);
    // The server's own modules stay refused as before.
    expect(() => resolveFrom(app, "$app/server")).toThrow("Server-only import in native bundle: $app/server");
    expect(() => resolveFrom(app, "$app/env/private")).toThrow("Server-only import in native bundle: $app/env/private");
    expect(() => resolveFrom(app, "$env/static/private")).toThrow("Server-only import in native bundle: $env/static/private");
  });
});

describe("svelte/motion", () => {
  test("is Svelte's own, from an app's code and from a library's: it builds prefersReducedMotion from window.matchMedia, which the polyfills install", () => {
    // Metro resolves it from Svelte's own directory, as it does every other `svelte/*` import.
    expect(resolveFrom(app, "svelte/motion")).toBe("/real/svelte/motion");
    expect(resolveFrom(join(root, "node_modules/svelte-sonner/dist/Toast.svelte"), "svelte/motion")).toBe("/real/svelte/motion");
    expect(resolveFrom(app, "svelte/transition")).toBe("/real/svelte/transition");
    expect(resolveFrom(app, "svelte/reactivity")).toBe("/real/svelte/reactivity");
    expect(kitResolution("svelte/motion")).toBeUndefined();
    expect(Object.keys(KIT_MODULES)).not.toContain("svelte/motion");
  });
});
