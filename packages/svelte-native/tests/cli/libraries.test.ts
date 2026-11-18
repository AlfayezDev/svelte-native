import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { onDemandForLibraries } from "../../src/expo.ts";
import { checkLibraries, enabledLibraries, enableMessage, expoModuleSearchPaths, LibrariesConfigError, libraryLinks, libraryNames } from "../../src/libraries.ts";
import { optionalPackages, vendoredPackage, vendoredRoot, withRequired } from "../../src/vendored.ts";

/**
 * The `libraries` option of the plugin (`src/libraries.ts`): what it accepts, what it refuses and says, and how the libraries it turns on link. The libraries are the package's own
 * optional ones (`src/optional-libraries.ts`).
 */
const refused = (option: unknown): string => {
  try {
    checkLibraries(option);
  } catch (error) {
    expect(error).toBeInstanceOf(LibrariesConfigError);
    return (error as Error).message;
  }
  throw new Error(`${JSON.stringify(option)} was accepted`);
};

describe("the registry of optional libraries", () => {
  test("the sixteen libraries, in the order their names sort, each a package of vendor/ at the version it pins", () => {
    expect([...libraryNames].sort()).toEqual([
      "@react-native-community/datetimepicker",
      "expo-blur",
      "expo-conic-gradient",
      "expo-image",
      "expo-linear-gradient",
      "expo-video",
      "lottie-react-native",
      "react-native-animateable-text",
      "react-native-blob-util",
      "react-native-fast-shadow",
      "react-native-maps",
      "react-native-pdf",
      "react-native-video",
      "react-native-view-shot",
      "react-native-webview",
      "rive-react-native",
    ]);
    expect(libraryNames).toHaveLength(16);
  });

  test("a library with a config plugin has the file the registry names, and one that needs another names a library of the list", () => {
    for (const vendored of optionalPackages) {
      const { plugin, requires } = vendored.optional ?? {};
      if (plugin !== undefined) expect([vendored.name, existsSync(join(vendoredRoot(vendored.name), plugin))]).toEqual([vendored.name, true]);
      for (const required of requires ?? []) expect(libraryNames).toContain(required);
    }
    expect(optionalPackages.filter((vendored) => vendored.optional?.plugin !== undefined).map((vendored) => vendored.name).sort()).toEqual([
      "@react-native-community/datetimepicker",
      "expo-image",
      "expo-video",
      "react-native-maps",
      "react-native-video",
    ]);
  });
});

describe("checkLibraries", () => {
  test("no option is no library; true, false and the options of a library's plugin are what a library takes", () => {
    expect(checkLibraries(undefined)).toEqual({ listed: new Map(), enabled: [] });
    expect(checkLibraries({})).toEqual({ listed: new Map(), enabled: [] });
    const checked = checkLibraries({ "expo-image": true, "react-native-maps": { androidGoogleMapsApiKey: "key" }, "lottie-react-native": false });
    expect([...checked.listed]).toEqual([["expo-image", undefined], ["react-native-maps", { androidGoogleMapsApiKey: "key" }]]);
    // In the registry's order, whatever the order of the app's.
    expect(checked.enabled).toEqual(["expo-image", "react-native-maps"]);
    expect(checkLibraries({ "react-native-maps": true, "expo-blur": true }).enabled).toEqual(["expo-blur", "react-native-maps"]);
  });

  test("a library that needs another turns it on too: react-native-pdf reads its files through react-native-blob-util", () => {
    const checked = checkLibraries({ "react-native-pdf": true });
    expect(checked.enabled).toEqual(["react-native-blob-util", "react-native-pdf"]);
    expect([...checked.listed.keys()]).toEqual(["react-native-pdf"]);
    expect(withRequired(["react-native-pdf"])).toEqual(["react-native-pdf", "react-native-blob-util"]);
    // Listing both changes nothing.
    expect(checkLibraries({ "react-native-pdf": true, "react-native-blob-util": true }).enabled).toEqual(["react-native-blob-util", "react-native-pdf"]);
  });

  test("a name that is not a library is refused with the names that are, and a package every app has says there is nothing to turn on", () => {
    const unknown = refused({ "react-native-camera": true });
    expect(unknown).toContain('`libraries` names "react-native-camera"');
    for (const name of libraryNames) expect(unknown).toContain(name);
    const always = refused({ "react-native-mmkv": true });
    expect(always).toContain("react-native-mmkv is in every app: there is nothing to turn on");
  });

  test("a value that is not true, false or an object is refused, and so is a list or a string in place of the object", () => {
    expect(refused({ "expo-image": "yes" })).toContain('libraries["expo-image"] is `true`, `false` or the options of expo-image\'s config plugin (an object), not "yes"');
    expect(refused({ "expo-image": [] })).toContain("not []");
    expect(refused(["expo-image"])).toContain("`libraries` takes an object of library names");
    expect(refused("expo-image")).toContain("`libraries` takes an object of library names");
  });

  test("a library with no config plugin takes no options: the message says to write true", () => {
    expect(refused({ "react-native-webview": { javaScriptEnabled: true } })).toContain('react-native-webview has no config plugin to give them to: write `libraries: { "react-native-webview": true }`');
    // An empty object is the same as true; a library with a plugin takes whatever its plugin takes (the plugin checks them).
    expect([...checkLibraries({ "react-native-webview": {} }).listed.keys()]).toEqual(["react-native-webview"]);
    expect(checkLibraries({ "expo-video": { supportsPictureInPicture: true } }).listed.get("expo-video")).toEqual({ supportsPictureInPicture: true });
  });

  test("enabledLibraries answers undefined for an option the prebuild refuses, so Metro and the doctor keep every library", () => {
    expect(enabledLibraries({ libraries: { "expo-image": true } })?.enabled).toEqual(["expo-image"]);
    expect(enabledLibraries(undefined)?.enabled).toEqual([]);
    expect(enabledLibraries({ libraries: { nope: true } })).toBeUndefined();
  });

  test("the message that says how to turn a library on names the library and the option", () => {
    expect(enableMessage("react-native-maps")).toBe('react-native-maps is not in this app: turn it on with `libraries: { "react-native-maps": true }` in the @alfayez/svelte-native plugin options (app.json or app.config.*), then prebuild and build the app again');
  });
});

describe("libraryLinks", () => {
  test("the Expo modules and the React Native packages link differently, and the Expo modules that are off are named for Expo's exclude", () => {
    const links = libraryLinks(["expo-image", "react-native-maps", "react-native-pdf"]);
    expect(links.enabled).toEqual(["expo-image", "react-native-blob-util", "react-native-maps", "react-native-pdf"]);
    expect(links.expo).toEqual(["expo-image"]);
    expect(links.reactNative).toEqual(["react-native-blob-util", "react-native-maps", "react-native-pdf"]);
    expect(links.expoOff).toEqual(["expo-blur", "expo-conic-gradient", "expo-linear-gradient", "expo-video"]);
  });

  test("nothing on: nothing to link, and every Expo module is left out", () => {
    const links = libraryLinks([]);
    expect([links.enabled, links.expo, links.reactNative]).toEqual([[], [], []]);
    expect(links.expoOff).toHaveLength(5);
  });

  test("the search path of an Expo module is its directory in the library", () => {
    expect(expoModuleSearchPaths(["expo-image", "expo-video"])).toEqual([vendoredRoot("expo-image"), vendoredRoot("expo-video")]);
    expect(vendoredPackage("expo-image")?.optional?.kind).toBe("expo");
  });
});

describe("androidOnDemandViewManagers", () => {
  const onDemand = { "com.rnmaps.maps.MapsPackage": ["RNMapsMapView"], "com.brentvatne.react.ReactVideoPackage": ["RCTVideo"], "com.horcrux.svg.SvgPackage": ["RNSVGGroup"] };

  test("the entries of a library that is off are dropped (their class is not in the build), the entries of a library that is on and of any other package stay", () => {
    expect(onDemandForLibraries(onDemand, ["react-native-maps"])).toEqual({ "com.rnmaps.maps.MapsPackage": ["RNMapsMapView"], "com.horcrux.svg.SvgPackage": ["RNSVGGroup"] });
    expect(onDemandForLibraries(onDemand, [])).toEqual({ "com.horcrux.svg.SvgPackage": ["RNSVGGroup"] });
    expect(onDemandForLibraries(undefined, ["react-native-maps"])).toBeUndefined();
  });
});
