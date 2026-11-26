/**
 * React Native's JavaScript-only platform modules, typed, for an app that has no React: `Platform`, `Appearance`, `Dimensions`,
 * `Linking`, `Keyboard`, `KeyboardController`, `AppState`, `BackHandler`, `PixelRatio`, `Share`, `Vibration` and `Alert`. They are React Native's own
 * objects (the same instances `react-native` exports, so a library that imports them from the index sees the same state), reached by
 * the paths of `react-native/Libraries/…` because the `react-native` index would load React's components too. The entry also exports the
 * two lookups of native modules, `turboModule` and `nativeModule` (`native-modules.ts`), which load React Native's registry on their first call.
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
export { nativeModule, turboModule } from "./native-modules.js";
/** The operating systems the library runs on. */
export type SupportedPlatform = Extract<typeof ReactNative.Platform, {
    OS: "android" | "ios";
}>;
/** Which system the app runs on, its version, and `select` for values that differ per system. */
export declare const Platform: SupportedPlatform;
/** The system's colour scheme: `getColorScheme()` (`"light"`, `"dark"` or `null`), `setColorScheme` and `addChangeListener`. */
export declare const Appearance: typeof ReactNative.Appearance;
/** The size of the window and the screen in points (`get("window")`), and the event for when it changes. */
export declare const Dimensions: typeof ReactNative.Dimensions;
/** Links: the one the app was launched with (`getInitialURL`), those that arrive later (`addEventListener("url", …)`), and `openURL`. */
export declare const Linking: typeof ReactNative.Linking;
/** The software keyboard: `dismiss()`, `isVisible()` and the show and hide events. The `insets` store reports its height. */
export declare const Keyboard: typeof ReactNative.Keyboard;
/**
 * The calls of react-native-keyboard-controller's `KeyboardController` an app uses: `dismiss()` and `isVisible()` are `Keyboard`'s, and `setFocusTo("next" | "prev" | "current")`
 * moves the focus to the input after or before the focused one (the order of the view tree), or gives the focused one the keyboard again. `setFocusTo` is Android's (the engine).
 */
export declare const KeyboardController: {
    dismiss(): void;
    isVisible(): boolean;
    setFocusTo(direction: "current" | "next" | "prev"): void;
};
/** Whether the app is in the foreground: `currentState` and `addEventListener("change", …)`. */
export declare const AppState: typeof ReactNative.AppState;
/** Android's back button (`addEventListener("hardwareBackPress", …)`; returning `true` takes it); a no-op on iOS. The router already listens: a screen rarely needs this. */
export declare const BackHandler: typeof ReactNative.BackHandler;
/** Points to pixels and back: `get()`, `getFontScale()`, `getPixelSizeForLayoutSize`, `roundToNearestPixel`. */
export declare const PixelRatio: typeof ReactNative.PixelRatio;
/** The system share sheet: `Share.share({ message, url, title })`. */
export declare const Share: typeof ReactNative.Share;
/** Vibration: `vibrate(pattern?)` and `cancel()`. */
export declare const Vibration: typeof ReactNative.Vibration;
/** The system's alert dialog: `Alert.alert(title, message, buttons)` (and `prompt` on iOS). */
export declare const Alert: typeof ReactNative.Alert;
