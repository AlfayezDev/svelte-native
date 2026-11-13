// Run by platform.test.ts in a process of its own: `mock.module` is global to a Bun test process, and other tests load React Native's `Keyboard` and `AppState` themselves.
// Replaces React Native's modules by recording fakes, uses `src/platform.ts` and prints what happened as JSON.
import { mock } from "bun:test";

const loads: string[] = [];
class Counter {
  taps = 0;
  tap(): number {
    return ++this.taps;
  }
}
const modules: Record<string, Record<string, unknown>> = {
  "react-native/Libraries/Utilities/Platform": { default: { OS: "android", Version: 34, select: (spec: Record<string, unknown>) => spec.android ?? spec.default } },
  "react-native/Libraries/Utilities/Appearance": { getColorScheme: () => "dark", addChangeListener: () => ({ remove() {} }) },
  "react-native/Libraries/Utilities/Dimensions": { default: { get: (name: string) => ({ width: name === "window" ? 400 : 420, height: 800, scale: 2, fontScale: 1 }) } },
  "react-native/Libraries/Linking/Linking": { default: new Counter() },
  "react-native/Libraries/Components/Keyboard/Keyboard": { default: { isVisible: () => false, dismiss() {} } },
  "react-native/Libraries/AppState/AppState": { default: { currentState: "active", addEventListener: () => ({ remove() {} }) } },
  "react-native/Libraries/Utilities/BackHandler": { default: { addEventListener: () => ({ remove() {} }) } },
  "react-native/Libraries/Utilities/PixelRatio": { default: { get: () => 2 } },
  "react-native/Libraries/Share/Share": { default: { share: () => Promise.resolve({ action: "sharedAction" }) } },
  "react-native/Libraries/Vibration/Vibration": { default: { vibrate() {}, cancel() {} } },
  "react-native/Libraries/Alert/Alert": { default: { alert() {} } },
  "react-native/Libraries/TurboModule/TurboModuleRegistry": { getEnforcing: (name: string) => { if (name === "Missing") throw new Error("no module Missing"); return { turbo: name }; } },
  "react-native/Libraries/BatchedBridge/NativeModules": { default: { Legacy: { ping: true } } },
};
for (const [path, module] of Object.entries(modules)) {
  mock.module(path, () => {
    loads.push(path);
    return module;
  });
}

const platform = await import("./../src/platform.ts");
const result: Record<string, unknown> = {};
result.exports = Object.keys(platform).sort();
result.afterImport = [...loads];

result.os = platform.Platform.OS;
result.version = platform.Platform.Version;
result.platformAgain = platform.Platform.OS;
result.afterPlatform = [...loads];

result.scheme = platform.Appearance.getColorScheme();
result.window = platform.Dimensions.get("window").width;
result.screen = platform.Dimensions.get("screen").width;
const linking = platform.Linking as unknown as Counter;
result.taps = linking.taps;
result.keyboard = platform.Keyboard.isVisible();
result.appState = platform.AppState.currentState;
result.backHandler = typeof platform.BackHandler.addEventListener;
result.pixelRatio = platform.PixelRatio.get();
result.share = typeof platform.Share.share;
result.vibration = typeof platform.Vibration.vibrate;
result.alert = typeof platform.Alert.alert;
result.afterAll = [...loads];

const { select } = platform.Platform;
result.select = select({ android: "a", ios: "i" });
const { tap } = linking;
result.tapped = [tap(), tap()];
result.taps2 = linking.taps;
const linkingAgain: unknown = platform.Linking;
result.sameLinking = platform.Linking === linkingAgain;
result.sameMethod = (platform.Linking as unknown as Counter).tap === tap;

const appState = platform.AppState as unknown as { currentState: string };
appState.currentState = "background";
result.written = ((modules["react-native/Libraries/AppState/AppState"] as { default: { currentState: string } }).default).currentState;
result.has = ["currentState" in platform.AppState, "missing" in platform.AppState];
result.keys = Object.keys(platform.AppState).sort();
result.finalLoads = loads.length;

// `turboModule` and `nativeModule` (native-modules.ts) are exports of the entry too: each requires React Native's registry on its first call, not before.
result.loadsBeforeModules = loads.length;
result.turbo = platform.turboModule<{ turbo: string }>("Blob");
result.turboMissing = (() => { try { platform.turboModule("Missing"); return "returned"; } catch (error) { return (error as Error).message; } })();
result.legacy = platform.nativeModule<{ ping: boolean }>("Legacy");
result.legacyMissing = platform.nativeModule("Nothing") ?? null;
result.afterModules = loads.slice(result.loadsBeforeModules as number);
console.log(JSON.stringify(result));
