import { expect, test } from "bun:test";
import { load as loadBundle, src } from "../support/bundle.ts";
import { routerStubs } from "../support/router.ts";
import { svgLibraryStubs } from "../support/svg-library-stubs.ts";
import { animation, gestures, nativeModules, svg, svgRenamed } from "./support/removed-entries.ts";

/**
 * The main entry and `/platform`, bundled together and evaluated (React Native's modules are stubs, as in the other bundle tests): they export every name the entries
 * 0.4.0-rc.7 removed (`/animation`, `/gestures`, `/svg`, `/native-modules`) exported, as values of the same kind.
 */
type Entry = Record<string, unknown>;
const load = () => loadBundle<{ main: Entry; platform: Entry }>({
  entry: `import * as main from ${JSON.stringify(src("index.ts"))};
    import * as platform from ${JSON.stringify(src("platform.ts"))};
    export { main, platform };`,
  stubs: { ...routerStubs, ...svgLibraryStubs },
  converters: false,
});

test("the main entry has the SVG components, the animation, the gestures and BlurView, and `/platform` the two native module lookups: every name the removed entries exported", async () => {
  const { main, platform } = await load();
  // Names: reading the key list reads nothing lazy.
  for (const name of ["Svg", "Path", "SvgText", "SvgImage", "SvgLinearGradient", "SvgMarker", "SvgXml", "withSpring", "withTiming", "createSharedValue", "AnimatedView", "Easing", "Gesture", "GestureDetector", "gesture", "State", "runOnJS", "BlurView", "View", "Text", "Image"]) {
    expect([name, name in main]).toEqual([name, true]);
  }
  expect(Object.keys(main)).not.toContain("default");

  // `/svg`: the main entry has its elements under react-native-svg's names, but the four that clash with the views' and `/foreign`'s, which are `SvgText`, `SvgImage`, `SvgLinearGradient` and `SvgMarker`
  // (the main entry's Text and Image are the views). Its default export was `Svg`.
  for (const name of svg.values) expect([name, name in main]).toEqual([name, true]);
  for (const [old, name] of Object.entries(svgRenamed)) expect([old, name, name in main]).toEqual([old, name, true]);
  expect(["LinearGradient", "Marker"].filter((name) => name in main)).toEqual([]);
  expect([main.SvgText === main.Text, main.SvgImage === main.Image]).toEqual([false, false]);

  // `/animation` and `/gestures`: the functions, objects and components are the main entry's (the gestures' `runOnJS` and `scheduleOnRN` are the animation's).
  for (const name of [...animation.values, ...gestures.values]) expect([name, name in main]).toEqual([name, true]);
  expect([typeof main.withSpring, typeof main.AnimatedView, typeof main.createSharedValue]).toEqual(["function", "function", "function"]);

  // `/native-modules` is `/platform`.
  for (const name of nativeModules.values) expect([name, typeof platform[name]]).toEqual([name, "function"]);
}, 60_000);
