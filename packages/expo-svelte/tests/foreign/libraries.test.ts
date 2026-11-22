import { describe, expect, test } from "bun:test";
import { enableMessage as nodeMessage, libraryNames } from "../../src/libraries.ts";
import { enableMessage, libraryOfComponent, libraryOfExpoModule } from "../../src/fabric/foreign-libraries.ts";
import { createHarness, find } from "./support/harness.ts";

/**
 * The foreign components of an optional library (`src/fabric/foreign-libraries.ts`) say how to turn the library on when the build does not have it: the plugin writes the names that are
 * on to `extra.expoSvelte.libraries`, which the build embeds, and a component made for a library that is not in the list throws instead of failing in the native mounting. A build
 * with no list (prebuilt before the option, a host test) mounts whatever it is asked to.
 */
const embedded = (libraries?: string[]) => ({ stubs: { "expo-constants": `export default { expoConfig: { extra: { expoSvelte: ${JSON.stringify(libraries === undefined ? {} : { libraries })} } } };` } });

describe("which library a component belongs to", () => {
  test("every library the wrappers name is one of the package's optional libraries, and the message is the one Metro's stub throws", () => {
    for (const name of ["react-native-webview", "react-native-maps", "react-native-video", "@react-native-community/datetimepicker", "lottie-react-native", "react-native-pdf", "rive-react-native", "react-native-fast-shadow", "react-native-animateable-text"]) {
      expect(libraryNames).toContain(name);
    }
    for (const module of ["ExpoImage", "ExpoBlur", "ExpoLinearGradient", "ConicGradient", "ExpoVideo"]) expect(libraryNames).toContain(libraryOfExpoModule(module) ?? "");
    for (const name of libraryNames) expect(enableMessage(name)).toBe(nodeMessage(name));
  });

  test("a Fabric component or an Expo module is a library's by name; the library's own views and other libraries' are nobody's", () => {
    expect([libraryOfComponent("RNMapsMapView"), libraryOfComponent("RNMapsGoogleMapView"), libraryOfComponent("RCTVideo"), libraryOfComponent("RNCWebView")]).toEqual(["react-native-maps", "react-native-maps", "react-native-video", "react-native-webview"]);
    expect([libraryOfComponent("RCTView"), libraryOfComponent("RNSVGPath"), libraryOfComponent("RNCSlider"), libraryOfComponent("RNMapsLike")]).toEqual([undefined, undefined, undefined, "react-native-maps"]);
    expect([libraryOfExpoModule("ExpoImage"), libraryOfExpoModule("SvelteBlur"), libraryOfExpoModule("ExpoCamera")]).toEqual(["expo-image", undefined, undefined]);
  });
});

describe("a component whose library is not in the build", () => {
  test("a foreign view throws how to turn the library on, and mounts when it is on", async () => {
    const off = createHarness("android", embedded(["expo-image"]));
    const loadedOff = await off.load("video-fixture.svelte");
    expect(() => loadedOff.startSurface(71, loadedOff.Fixture, {})).toThrow(enableMessage("react-native-video"));
    off.restore();

    const on = createHarness("android", { ...embedded(["react-native-video"]), natives: { modules: { VideoManager: {} } } });
    const loadedOn = await on.load("video-fixture.svelte");
    loadedOn.startSurface(72, loadedOn.Fixture, {});
    expect(find(on.roots()[72] ?? [], "RCTVideo")).toHaveLength(1);
    on.restore();
  });

  test("an Expo view of a library says the same, where a module of another library keeps the message about installing it", async () => {
    const harness = createHarness("android", { ...embedded([]), expo: { Thing: { "": { validAttributes: {}, directEventTypes: null } } } });
    const loaded = await harness.load("expo-view-missing-fixture.svelte");
    expect(() => loaded.foreign.expoViewName("ExpoImage")).toThrow(enableMessage("expo-image"));
    expect(() => loaded.foreign.expoViewName("ExpoVideo", "SurfaceVideoView")).toThrow(enableMessage("expo-video"));
    expect(() => loaded.foreign.expoViewName("Missing")).toThrow(/Expo module Missing has no view: .*Install the library/);
    // The library's own blur is not an optional library.
    expect(() => loaded.foreign.expoViewName("SvelteBlur", "SvelteBlurView")).toThrow(/Expo module SvelteBlur has no view/);
    harness.restore();
  });

  test("a build that has no list of libraries mounts what it is asked to", async () => {
    const harness = createHarness("android", { ...embedded(undefined), natives: { modules: { VideoManager: {} } } });
    const loaded = await harness.load("video-fixture.svelte");
    loaded.startSurface(73, loaded.Fixture, {});
    expect(find(harness.roots()[73] ?? [], "RCTVideo")).toHaveLength(1);
    harness.restore();
  });
});
