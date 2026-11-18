import { beforeAll, describe, expect, test } from "bun:test";
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, readdirSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { enableMessage, libraryNames } from "../../../src/libraries.ts";
import { libraryStubSource, withSvelteNative } from "../../../src/metro.ts";
import { vendoredRoot } from "../../../src/vendored.ts";
import { type RealResolver, fakeConfig, resolveFrom as resolveWith } from "../../support/metro.ts";
import { packageRoot } from "../../support/paths.ts";
import { createProject, type Project } from "../../support/project.ts";

/**
 * The optional libraries are bundled only when the app turns them on (`libraries` of the plugin options, `src/libraries.ts`): Metro reads the option from the app's config as Expo reads it
 * and resolves the name of each library that is off, and every path below it, to a stub that throws how to turn it on, for every importer. The ones that are on resolve to their copy.
 */
const real: RealResolver = (context, moduleName) => ({ type: "sourceFile", filePath: `/real/${moduleName} (from ${context.originModulePath})` });
const resolveFrom = (config: ReturnType<typeof withSvelteNative>, origin: string, moduleName: string): string => resolveWith(config, origin, moduleName, real);
const copy = (name: string, path = "") => join(vendoredRoot(name), path);

// Expo's plugin resolver `require`s the library's `app.plugin.js` (an ES module) when it reads the config; Bun with a cold transpiler cache gives it an object without its default
// export the first time, and the config then cannot be read. Metro runs on Node, where it is right every time (`stubs.test.ts`: the same).
beforeAll(async () => { await import(join(packageRoot, "app.plugin.js")); });

/** A project whose app.json gives the library's plugin these options; the library is linked into its node_modules, as `expo/config` reads the plugin from there. */
function app(options?: object): Project {
  const project = createProject({}, "metro-libraries-");
  project.write("package.json", JSON.stringify({ name: "app", version: "1.0.0", dependencies: { "@alfayez/svelte-native": "*" } }));
  project.write("app.json", JSON.stringify({ expo: { name: "app", slug: "app", plugins: [options === undefined ? "@alfayez/svelte-native" : ["@alfayez/svelte-native", options]] } }));
  mkdirSync(project.path("node_modules/@alfayez"), { recursive: true });
  symlinkSync(packageRoot, project.path("node_modules/@alfayez/svelte-native"));
  return project;
}
const stubDirectory = (project: Project, variant: string) => project.path(".svelte-native/stubs", variant);
const stubOf = (project: Project, variant: string, name: string) => join(stubDirectory(project, variant), `${name.replace(/[^A-Za-z0-9_.-]/g, "_")}.js`);

describe("the libraries the app's config turns on", () => {
  test("a library that is on resolves to its copy, by its name and by any path below it, for every importer; the others resolve to a stub", () => {
    using project = app({ libraries: { "expo-image": true, "react-native-maps": { androidGoogleMapsApiKey: "k" } } });
    const config = withSvelteNative(fakeConfig(project.directory), { variant: "qa" });
    const origins = [project.path("src/lib/a.ts"), project.path("node_modules/some-library/index.js"), copy("expo-image", "src/index.ts")];
    for (const origin of origins) {
      expect(resolveFrom(config, origin, "expo-image"), origin).toBe(`/real/${copy("expo-image")} (from ${origin})`);
      expect(resolveFrom(config, origin, "react-native-maps/src/index")).toBe(`/real/${copy("react-native-maps", "src/index")} (from ${origin})`);
      expect(resolveFrom(config, origin, "expo-video")).toBe(stubOf(project, "qa", "expo-video"));
      expect(resolveFrom(config, origin, "expo-video/build/VideoPlayer")).toBe(stubOf(project, "qa", "expo-video"));
      expect(resolveFrom(config, origin, "@react-native-community/datetimepicker")).toBe(stubOf(project, "qa", "@react-native-community/datetimepicker"));
    }
  });

  test("a library another needs is on with it: react-native-pdf brings react-native-blob-util", () => {
    using project = app({ libraries: { "react-native-pdf": true } });
    const config = withSvelteNative(fakeConfig(project.directory), { variant: "qa" });
    const origin = project.path("src/a.ts");
    expect(resolveFrom(config, origin, "react-native-pdf")).toBe(`/real/${copy("react-native-pdf")} (from ${origin})`);
    expect(resolveFrom(config, origin, "react-native-blob-util")).toBe(`/real/${copy("react-native-blob-util")} (from ${origin})`);
    expect(resolveFrom(config, origin, "react-native-webview")).toBe(stubOf(project, "qa", "react-native-webview"));
  });

  test("no `libraries`: every library is a stub, one file each (the stubs of the others are not written for a library that is on)", () => {
    using project = app();
    withSvelteNative(fakeConfig(project.directory), { variant: "qa" });
    expect(readdirSync(stubDirectory(project, "qa")).sort()).toEqual(["_core.js", ...libraryNames.map((name) => `${name.replace(/[^A-Za-z0-9_.-]/g, "_")}.js`)].sort());
    using some = app({ libraries: { "expo-blur": true, "lottie-react-native": true } });
    withSvelteNative(fakeConfig(some.directory), { variant: "qa" });
    expect(readdirSync(stubDirectory(some, "qa"))).toHaveLength(1 + libraryNames.length - 2);
  });

  test("a stub throws how to turn the library on when it is used, called or constructed, and is no ES module", () => {
    using project = app({ libraries: {} });
    withSvelteNative(fakeConfig(project.directory), { variant: "qa" });
    const file = stubOf(project, "qa", "react-native-maps");
    expect(readFileSync(file, "utf8")).toBe(libraryStubSource("react-native-maps"));
    const stub = createRequire(import.meta.url)(file) as Record<string, unknown> & (() => void);
    const message = enableMessage("react-native-maps");
    expect(() => stub.MapView).toThrow(message);
    expect(() => stub()).toThrow(message);
    expect(() => new (stub as unknown as new () => unknown)()).toThrow(message);
    expect(stub.__esModule).toBe(false);
    expect(message).toContain('libraries: { "react-native-maps": true }');
  });

  test("the app's own `libraries` Metro option names them when the config is not to be read, and wins over it", () => {
    using project = app({ libraries: { "expo-image": true } });
    const config = withSvelteNative(fakeConfig(project.directory), { variant: "qa", libraries: ["expo-video"] });
    const origin = project.path("src/a.ts");
    expect(resolveFrom(config, origin, "expo-video")).toBe(`/real/${copy("expo-video")} (from ${origin})`);
    expect(resolveFrom(config, origin, "expo-image")).toBe(stubOf(project, "qa", "expo-image"));
  });

  test("a config that cannot be read, or whose `libraries` the prebuild refuses, keeps every library: the build's own flags decide on the device", () => {
    using unreadable = createProject({}, "metro-libraries-");
    unreadable.write("app.config.js", "throw new Error('broken config');");
    using refused = app({ libraries: { "no-such-library": true } });
    for (const project of [unreadable, refused]) {
      const config = withSvelteNative(fakeConfig(project.directory), { variant: "qa" });
      const origin = project.path("src/a.ts");
      for (const name of libraryNames) expect(resolveFrom(config, origin, name), name).toBe(`/real/${copy(name)} (from ${origin})`);
    }
  });

  test("a library's name and the names that only start with it are told apart; the packages every app has are not touched", () => {
    using project = app({ libraries: {} });
    const config = withSvelteNative(fakeConfig(project.directory), { variant: "qa" });
    const origin = project.path("src/a.ts");
    for (const name of ["expo-image-picker", "expo-video-thumbnails", "react-native-maps-extra", "./expo-image", "#vendor/react-native-mmkv"]) expect(resolveFrom(config, origin, name), name).toBe(`/real/${name} (from ${origin})`);
    expect(resolveFrom(config, origin, "react-native-mmkv")).toBe(`/real/${copy("react-native-mmkv")} (from ${origin})`);
  });

  test("the library's own `#vendor/<name>` import of a library that is off is the stub too", () => {
    using project = app({ libraries: { "expo-image": true } });
    const config = withSvelteNative(fakeConfig(project.directory), { variant: "qa" });
    const origin = join(packageRoot, "src/fabric/foreign-video-player.ts");
    expect(resolveFrom(config, origin, "#vendor/expo-video/build/VideoPlayer")).toBe(stubOf(project, "qa", "expo-video"));
    expect(resolveFrom(config, origin, "#vendor/expo-image")).toBe(`/real/#vendor/expo-image (from ${origin})`);
  });

  test("a plugin entry that is a path to the library is the plugin; a config with no entry for it keeps every library, as a config that cannot be read does", () => {
    const project = (plugins: unknown[]): Project => {
      const made = createProject({}, "metro-libraries-");
      made.write("package.json", JSON.stringify({ name: "app", version: "1.0.0", dependencies: { "@alfayez/svelte-native": "*" } }));
      made.write("app.json", JSON.stringify({ expo: { name: "app", slug: "app", plugins } }));
      mkdirSync(made.path("node_modules/@alfayez"), { recursive: true });
      symlinkSync(packageRoot, made.path("node_modules/@alfayez/svelte-native"));
      return made;
    };
    using byPath = project([["./node_modules/@alfayez/svelte-native/app.plugin.js", { libraries: { "expo-image": true } }]]);
    const config = withSvelteNative(fakeConfig(byPath.directory), { variant: "qa" });
    const origin = byPath.path("src/a.ts");
    expect(resolveFrom(config, origin, "expo-image")).toBe(`/real/${copy("expo-image")} (from ${origin})`);
    expect(resolveFrom(config, origin, "expo-video")).toBe(stubOf(byPath, "qa", "expo-video"));
    using none = project(["expo-font"]);
    const keeps = withSvelteNative(fakeConfig(none.directory), { variant: "qa" });
    for (const name of libraryNames) expect(resolveFrom(keeps, none.path("src/a.ts"), name), name).toBe(`/real/${copy(name)} (from ${none.path("src/a.ts")})`);
  });

  test("Metro's cache is kept apart for another set of libraries: the same file resolves differently", () => {
    using none = app({ libraries: {} });
    using some = app({ libraries: { "expo-image": true } });
    const a = withSvelteNative(fakeConfig(none.directory), { variant: "qa" }).cacheVersion;
    const b = withSvelteNative(fakeConfig(some.directory), { variant: "qa" }).cacheVersion;
    expect(a).not.toBe(b);
    expect(b).toContain("+libraries-expo-image");
  });
});
