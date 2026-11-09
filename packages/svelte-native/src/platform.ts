/**
 * React Native's JavaScript-only platform modules, typed, for an app that has no React: `Platform`, `Appearance`, `Dimensions`,
 * `Linking`, `Keyboard`, `AppState`, `BackHandler`, `PixelRatio`, `Share`, `Vibration` and `Alert`. They are React Native's own
 * objects (the same instances `react-native` exports, so a library that imports them from the index sees the same state), reached by
 * the paths of `react-native/Libraries/…` because the `react-native` index would load React's components too.
 *
 * Importing this entry loads none of them. Each export is a stand-in that requires its module on the first property read, so a
 * screen that reads `Platform.OS` pays for `Platform` and nothing else (`Keyboard` pulls in `LayoutAnimation` and `UIManager`, which
 * read the constants of every view manager: the library loads it itself once the first frame is out, and an app that never touches
 * it should not pay for it earlier). A function read from a stand-in is bound to the module, so `const { openURL } = Linking` works.
 *
 * The types are `react-native`'s own (`typeof ReactNative.Linking`, …), except `Platform`, which is narrowed to the two systems the
 * library runs on: `Platform.OS === "ios"` narrows `Platform.Version` to a string, and `"android"` to a number.
 */
import type * as ReactNative from "react-native";

/** A stand-in for a module object: every read, write and key listing goes to `read()`, which loads the module the first time. */
function lazyModule<T extends object>(read: () => T): T {
  const bound = new Map<unknown, unknown>();
  return new Proxy({} as T, {
    get(_target, key) {
      const module = read();
      const value = Reflect.get(module, key, module);
      if (typeof value !== "function") return value;
      const known = bound.get(value);
      if (known !== undefined) return known;
      const method = (value as (...args: unknown[]) => unknown).bind(module);
      bound.set(value, method);
      return method;
    },
    set: (_target, key, value) => Reflect.set(read(), key, value),
    has: (_target, key) => key in read(),
    ownKeys: () => Reflect.ownKeys(read()),
    getOwnPropertyDescriptor(_target, key) {
      const descriptor = Reflect.getOwnPropertyDescriptor(read(), key);
      return descriptor && { ...descriptor, configurable: true };
    },
  });
}

/** The operating systems the library runs on. */
export type SupportedPlatform = Extract<typeof ReactNative.Platform, { OS: "android" | "ios" }>;

/** Which system the app runs on, its version, and `select` for values that differ per system. */
// eslint-disable-next-line @typescript-eslint/no-require-imports -- required on first use, not when the entry is imported
export const Platform: SupportedPlatform = lazyModule(() => (require("react-native/Libraries/Utilities/Platform") as { default: SupportedPlatform }).default);

/** The system's colour scheme: `getColorScheme()` (`"light"`, `"dark"` or `null`), `setColorScheme` and `addChangeListener`. */
// eslint-disable-next-line @typescript-eslint/no-require-imports -- required on first use
export const Appearance: typeof ReactNative.Appearance = lazyModule(() => require("react-native/Libraries/Utilities/Appearance") as typeof ReactNative.Appearance);

/** The size of the window and the screen in points (`get("window")`), and the event for when it changes. */
// eslint-disable-next-line @typescript-eslint/no-require-imports -- required on first use
export const Dimensions: typeof ReactNative.Dimensions = lazyModule(() => (require("react-native/Libraries/Utilities/Dimensions") as { default: typeof ReactNative.Dimensions }).default);

/** Links: the one the app was launched with (`getInitialURL`), those that arrive later (`addEventListener("url", …)`), and `openURL`. */
// eslint-disable-next-line @typescript-eslint/no-require-imports -- required on first use
export const Linking: typeof ReactNative.Linking = lazyModule(() => (require("react-native/Libraries/Linking/Linking") as { default: typeof ReactNative.Linking }).default);

/** The software keyboard: `dismiss()`, `isVisible()` and the show and hide events. The `insets` store reports its height. */
// eslint-disable-next-line @typescript-eslint/no-require-imports -- required on first use
export const Keyboard: typeof ReactNative.Keyboard = lazyModule(() => (require("react-native/Libraries/Components/Keyboard/Keyboard") as { default: typeof ReactNative.Keyboard }).default);

/** Whether the app is in the foreground: `currentState` and `addEventListener("change", …)`. */
// eslint-disable-next-line @typescript-eslint/no-require-imports -- required on first use
export const AppState: typeof ReactNative.AppState = lazyModule(() => (require("react-native/Libraries/AppState/AppState") as { default: typeof ReactNative.AppState }).default);

/** Android's back button (`addEventListener("hardwareBackPress", …)`; returning `true` takes it); a no-op on iOS. The router already listens: a screen rarely needs this. */
// eslint-disable-next-line @typescript-eslint/no-require-imports -- required on first use
export const BackHandler: typeof ReactNative.BackHandler = lazyModule(() => (require("react-native/Libraries/Utilities/BackHandler") as { default: typeof ReactNative.BackHandler }).default);

/** Points to pixels and back: `get()`, `getFontScale()`, `getPixelSizeForLayoutSize`, `roundToNearestPixel`. */
// eslint-disable-next-line @typescript-eslint/no-require-imports -- required on first use
export const PixelRatio: typeof ReactNative.PixelRatio = lazyModule(() => (require("react-native/Libraries/Utilities/PixelRatio") as { default: typeof ReactNative.PixelRatio }).default);

/** The system share sheet: `Share.share({ message, url, title })`. */
// eslint-disable-next-line @typescript-eslint/no-require-imports -- required on first use
export const Share: typeof ReactNative.Share = lazyModule(() => (require("react-native/Libraries/Share/Share") as { default: typeof ReactNative.Share }).default);

/** Vibration: `vibrate(pattern?)` and `cancel()`. */
// eslint-disable-next-line @typescript-eslint/no-require-imports -- required on first use
export const Vibration: typeof ReactNative.Vibration = lazyModule(() => (require("react-native/Libraries/Vibration/Vibration") as { default: typeof ReactNative.Vibration }).default);

/** The system's alert dialog: `Alert.alert(title, message, buttons)` (and `prompt` on iOS). */
// eslint-disable-next-line @typescript-eslint/no-require-imports -- required on first use
export const Alert: typeof ReactNative.Alert = lazyModule(() => (require("react-native/Libraries/Alert/Alert") as { default: typeof ReactNative.Alert }).default);
