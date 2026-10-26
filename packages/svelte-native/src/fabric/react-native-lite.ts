/**
 * Stands in for the `react-native` index when third-party native-module packages (hermes-intl, expo-modules-core,
 * expo-file-system) are bundled for the Fabric entry. The real index statically requires every component, which
 * is the React layer the Fabric entry exists to avoid; these packages only use the non-visual APIs re-exported here.
 */

/* eslint-disable @typescript-eslint/no-require-imports -- the lazy exports below require their module on first use */
/**
 * React Native modules that only some libraries reach, and only when they run, are required on first use instead of when
 * the shim loads. `codegenNativeComponent` alone drags in the view-config registry and the style attribute processors
 * (more than 100 ms of evaluation on the emulator) and only Reanimated's `SharedTransitionBoundary` calls it; the status
 * bar, colour-scheme and networking modules are reached from functions. Each export forwards to its module once loaded.
 */
function once<T>(load: () => T): () => T {
  let value: T | undefined;
  let loaded = false;
  return () => {
    if (!loaded) {
      value = load();
      loaded = true;
    }
    return value as T;
  };
}
function lazyObject<T extends object>(load: () => T): T {
  const target = once(load);
  return new Proxy({} as T, {
    get: (_unused, key) => Reflect.get(target(), key),
    set: (_unused, key, value) => Reflect.set(target(), key, value),
    has: (_unused, key) => Reflect.has(target(), key),
  });
}
function lazyFunction<F extends (...args: never[]) => unknown>(load: () => F): F {
  const target = once(load);
  return ((...args: Parameters<F>) => target()(...args)) as F;
}

export { default as Platform } from "react-native/Libraries/Utilities/Platform";
export { default as NativeModules } from "react-native/Libraries/BatchedBridge/NativeModules";
export { default as NativeEventEmitter } from "react-native/Libraries/EventEmitter/NativeEventEmitter";
export { default as AppState } from "react-native/Libraries/AppState/AppState";
export { default as Dimensions } from "react-native/Libraries/Utilities/Dimensions";
export { default as I18nManager } from "react-native/Libraries/ReactNative/I18nManager";
import * as TurboModuleRegistry from "react-native/Libraries/TurboModule/TurboModuleRegistry";
export { TurboModuleRegistry };
// Expo's `Expo.fx` registers a placeholder "main" component through `AppRegistry` in development.
export { AppRegistry } from "./app-registry.ts";
export const StyleSheet = lazyObject<Record<string, unknown>>(() => require("react-native/Libraries/StyleSheet/StyleSheet").default);
export const codegenNativeComponent = lazyFunction<(name: string, options?: object) => unknown>(() => require("react-native/Libraries/Utilities/codegenNativeComponent").default);
/**
 * Reanimated wraps these at import time (`createAnimatedComponent(View)` and so on) for its React API. The Fabric
 * entry renders no React, so placeholders are enough; rendering one through React is a programming error.
 */
const unsupported = () => null;
export const View = unsupported;
export const Text = unsupported;
export const TextInput = unsupported;
export const ScrollView = unsupported;
export const Image = unsupported;
export const FlatList = unsupported;
export const SectionList = unsupported;
/** Without React there is no component-to-node-handle mapping. */
export const findNodeHandle = (): null => null;

// Names the shimmed packages import at load time but never render through: cheap stubs and the small real modules.
export const processColor = lazyFunction<(color: unknown) => unknown>(() => require("react-native/Libraries/StyleSheet/processColor").default);
/** Reanimated reads `Animated.View` and friends at import time to wrap them; nothing renders through them on the Svelte host. */
export const Animated = {
  View, Text, Image, ScrollView, FlatList, SectionList,
  Value: function AnimatedValue(this: { _value: unknown }, value: unknown) { this._value = value; },
  event: () => () => undefined,
  createAnimatedComponent: <T,>(component: T): T => component,
};
/** expo-modules-core checks `instanceof ReactNativeElement` for DOM-style refs; no host instance is one here. */
export class ReactNativeElement {}
export type HostComponent<Props> = (props: Props) => null;

// Used by `expo` (Expo.fx, async-require), expo-asset and expo-status-bar. Small, React-free or React-hook-only modules.
export const PixelRatio = lazyObject<{ get(): number }>(() => require("react-native/Libraries/Utilities/PixelRatio").default);
export const Appearance = lazyObject<Record<string, unknown>>(() => require("react-native/Libraries/Utilities/Appearance"));
export const useColorScheme = lazyFunction<() => unknown>(() => require("react-native/Libraries/Utilities/useColorScheme").default);
export const StatusBar = lazyObject<Record<string, unknown>>(() => require("react-native/Libraries/Components/StatusBar/StatusBar").default);
export const Networking = lazyObject<Record<string, unknown>>(() => require("react-native/Libraries/Network/RCTNetworking").default);
