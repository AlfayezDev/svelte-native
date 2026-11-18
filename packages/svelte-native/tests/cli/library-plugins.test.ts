import { afterAll, describe, expect, test } from "bun:test";
import { withPlugins } from "@expo/config-plugins";
import expoPlugin, { assertNoVendoredOriginals, withLibraries } from "../../src/expo.ts";
import { checkLibraries, LibrariesConfigError, libraryPlugin } from "../../src/libraries.ts";
import { collisionMessage, optionalPackages, vendoredPackage } from "../../src/vendored.ts";
import { createProject } from "../support/project.ts";

/**
 * A library's own config plugin runs from its copy in vendor/, with the options the app gave it under `libraries` (`src/libraries.ts`, `withLibraries` in `src/expo.ts`), and the names that
 * are on go to the manifest the build embeds. Run through Expo's own `withPlugins` and the mods the plugins register, as a prebuild does.
 */
type Mods = Record<string, Record<string, (config: object) => Promise<{ modResults: Record<string, unknown> }>>>;
const base = { name: "a", slug: "a", android: { package: "io.e.a" }, ios: { bundleIdentifier: "io.e.a" } };

/** The config the plugin leaves, with the options the app gave it. */
function applied(options: object | undefined, extra: object = {}) {
  // A config of its own each time: Expo's run-once plugins keep their history in `_internal`.
  return withPlugins({ ...base, ...extra, _internal: { projectRoot: "/nowhere" } } as never, [[expoPlugin, options]]) as unknown as { extra?: Record<string, unknown>; mods: Mods };
}

/** Runs the mod of a platform's file the plugins registered on `results`, as the prebuild does, and returns what it wrote. */
async function runMod(config: { mods: Mods }, platform: "android" | "ios", mod: string, results: Record<string, unknown>): Promise<Record<string, unknown>> {
  const run = config.mods[platform]?.[mod];
  if (!run) throw new Error(`no ${platform} ${mod} mod`);
  const done = await run({ ...config, modRequest: { projectRoot: "/nowhere", platformProjectRoot: `/nowhere/${platform}`, platform, modName: mod, introspect: false }, modResults: results });
  return done.modResults;
}

const application = () => ({ manifest: { $: {}, application: [{ $: { "android:name": ".MainApplication" }, "meta-data": [], activity: [{ $: { "android:name": ".MainActivity" }, "intent-filter": [{ action: [{ $: { "android:name": "android.intent.action.MAIN" } }], category: [{ $: { "android:name": "android.intent.category.LAUNCHER" } }] }] }] }] } });

describe("the options reach the library's own plugin", () => {
  test("react-native-maps: androidGoogleMapsApiKey is the manifest's Maps key, as if the app listed the library's plugin", async () => {
    const config = applied({ libraries: { "react-native-maps": { androidGoogleMapsApiKey: "THE-KEY" } } });
    const manifest = (await runMod(config, "android", "manifest", application())) as ReturnType<typeof application>;
    const metaData = manifest.manifest.application[0]?.["meta-data"] as { $: Record<string, string> }[];
    expect(metaData.find((item) => item.$["android:name"] === "com.google.android.geo.API_KEY")?.$["android:value"]).toBe("THE-KEY");
  });

  test("a library listed with `true` runs its plugin with no options; an unlisted one's plugin does not run at all", async () => {
    const without = applied({ libraries: { "expo-blur": true } });
    const manifest = (await runMod(without, "android", "manifest", application())) as ReturnType<typeof application>;
    expect(JSON.stringify(manifest)).not.toContain("API_KEY");
    // The plugin of react-native-maps ran for neither: the Maps key is only written by it.
    const withMaps = applied({ libraries: { "react-native-maps": true } });
    expect(JSON.stringify(await runMod(withMaps, "android", "manifest", application()))).not.toContain("API_KEY");
  });

  test("expo-image: disableLibdav1d is the Podfile property its plugin writes, and the plugin runs for `true` too", async () => {
    const on = await runMod(applied({ libraries: { "expo-image": { disableLibdav1d: true } } }), "ios", "podfileProperties", {});
    expect(on["expo-image.disable-libdav1d"]).toBe("true");
    const defaults = await runMod(applied({ libraries: { "expo-image": true } }), "ios", "podfileProperties", {});
    expect(defaults["expo-image.disable-libdav1d"]).toBe("false");
    // Not listed: the property is not written.
    expect(applied({ libraries: { "expo-blur": true } }).mods.ios?.podfileProperties).toBeUndefined();
  });

  test("expo-video: the Picture in Picture option is Info.plist's audio background mode and the activity's attribute", async () => {
    const config = applied({ libraries: { "expo-video": { supportsPictureInPicture: true } } });
    expect((await runMod(config, "ios", "infoPlist", {})).UIBackgroundModes).toEqual(["audio"]);
    const manifest = (await runMod(config, "android", "manifest", application())) as ReturnType<typeof application>;
    expect(manifest.manifest.application[0]?.activity[0]?.$["android:supportsPictureInPicture"]).toBe("true");
  });

  test("react-native-video: its own options (background audio) reach its plugin", async () => {
    const config = applied({ libraries: { "react-native-video": { enableBackgroundAudio: true } } });
    expect((await runMod(config, "ios", "infoPlist", {})).UIBackgroundModes).toContain("audio");
  });

  test("@react-native-community/datetimepicker: its Android styles plugin is registered when the library is on", () => {
    expect(applied({ libraries: { "@react-native-community/datetimepicker": { android: { dialog: { colorAccent: { color: "#ff0000" } } } } } }).mods.android?.styles).toBeDefined();
    expect(applied({ libraries: { "expo-blur": true } }).mods.android?.styles).toBeUndefined();
  });

  test("a library without a plugin (react-native-webview) has none to run, and every library with a plugin loads one from its copy", () => {
    for (const vendored of optionalPackages) {
      const plugin = libraryPlugin(vendored);
      expect([vendored.name, typeof plugin]).toEqual([vendored.name, vendored.optional?.plugin === undefined ? "undefined" : "function"]);
    }
    expect(vendoredPackage("react-native-webview")?.optional?.plugin).toBeUndefined();
  });
});

describe("with the crypto batch's option", () => {
  const podfile = "target 'App' do\n  use_expo_modules!\n  config_command = ['node', 'react-native-config']\n\n  config = use_native_modules!(config_command)\nend\n";

  test("`sodiumEnabled` and `libraries` are both options of the one plugin: the Podfile gets the sodium line and the Expo search paths and --link arguments, gradle.properties the sodium property", async () => {
    const config = applied({ sodiumEnabled: true, libraries: { "expo-image": true, "react-native-maps": true } });
    const contents = (await runMod(config, "ios", "podfile", { contents: podfile, language: "rb" })).contents as string;
    expect(contents).toStartWith("# Svelte native: libsodium for react-native-quick-crypto");
    expect(contents).toContain("ENV['SODIUM_ENABLED'] = '1'");
    expect(contents).toContain("use_expo_modules!(exclude: svelte_native_exclude, searchPaths: svelte_native_expo_modules.map");
    expect(contents).toContain("'ios-autolinking', '--link', 'react-native-maps']");
    const properties = (await runMod(config, "android", "gradleProperties", [])) as unknown as { type: string; key: string; value: string }[];
    expect(properties).toContainEqual({ type: "property", key: "sodiumEnabled", value: "true" });
    // Without sodium the line and the property are not written; the libraries are all the same.
    const without = applied({ libraries: { "expo-image": true } });
    expect(((await runMod(without, "ios", "podfile", { contents: podfile, language: "rb" })).contents as string)).not.toContain("SODIUM_ENABLED");
    expect(await runMod(without, "android", "gradleProperties", [])).toEqual([]);
  });

  test("the app's extra carries the libraries beside whatever else is there", () => {
    expect(applied({ sodiumEnabled: true, libraries: { "expo-blur": true } }).extra).toEqual({ svelteNative: { libraries: ["expo-blur"] } });
  });
});

describe("what the build embeds", () => {
  test("extra.svelteNative.libraries lists the libraries that are on, with what they need, and keeps the rest of `extra`", () => {
    expect(applied({ libraries: { "react-native-pdf": true, "expo-image": true } }, { extra: { eas: { projectId: "x" }, svelteNative: { remote: { origin: "https://example.com" } } } }).extra).toEqual({
      eas: { projectId: "x" },
      svelteNative: { remote: { origin: "https://example.com" }, libraries: ["expo-image", "react-native-blob-util", "react-native-pdf"] },
    });
    expect(applied(undefined).extra).toEqual({ svelteNative: { libraries: [] } });
  });

  test("an option the plugin cannot make sense of stops the prebuild with what to write", () => {
    expect(() => applied({ libraries: { "react-native-camera": true } })).toThrow('`libraries` names "react-native-camera"');
    expect(() => applied({ libraries: { "react-native-webview": { javaScriptEnabled: true } } })).toThrow("has no config plugin to give them to");
  });
});

describe("collisions", () => {
  const projects: { remove(): void }[] = [];
  afterAll(() => { for (const project of projects) project.remove(); });
  const app = (dependencies: Record<string, string>) => {
    const project = createProject({ "package.json": JSON.stringify({ name: "app", dependencies }) }, "library-collision-");
    projects.push(project);
    return project.directory;
  };

  test("an app that lists a library's own plugin in `plugins` is refused: the package is not installed, and its options are the library's under `libraries`", () => {
    for (const listed of ["react-native-maps", ["react-native-maps", { androidGoogleMapsApiKey: "k" }], "expo-image"] as const) {
      let refused: unknown;
      try { withLibraries({ ...base, plugins: [listed] } as never, checkLibraries({})); } catch (error) { refused = error; }
      expect(refused).toBeInstanceOf(LibrariesConfigError);
      expect((refused as Error).message).toContain(`\`plugins\` lists ${Array.isArray(listed) ? listed[0] : listed}`);
      expect((refused as Error).message).toContain("under `libraries`");
    }
    // Another package's plugin is not the library's business.
    expect(() => withLibraries({ ...base, plugins: ["expo-font", ["expo-camera", {}]] } as never, checkLibraries({}))).not.toThrow();
  });

  test("an app whose package.json lists a library is refused before anything is written, whether the library is on or not", () => {
    expect(() => assertNoVendoredOriginals(app({ "react-native-maps": "1.27.2" }))).toThrow(collisionMessage(["react-native-maps"]));
    expect(() => assertNoVendoredOriginals(app({ "expo-image": "~57.0.5", "lottie-react-native": "~7.3.8" }))).toThrow("includes expo-image 57.0.5 and lottie-react-native 7.3.8; remove them from");
    expect(() => assertNoVendoredOriginals(app({ "expo-camera": "~57.0.6" }))).not.toThrow();
  });
});
