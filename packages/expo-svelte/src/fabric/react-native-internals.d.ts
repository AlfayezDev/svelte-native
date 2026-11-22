// React Native's Fabric binding and prop-payload helpers are internal, Flow-typed modules; typed here only as far as the Svelte host uses them.
declare module "react-native/Libraries/ReactNative/ReactFabricPublicInstance/ReactNativeAttributePayload" {
  export function create(props: object, validAttributes: object): object | null;
  export function diff(previous: object, next: object, validAttributes: object): object | null;
}
declare module "react-native/Libraries/Renderer/shims/ReactNativeViewConfigRegistry" {
  export function get(name: string): {
    uiViewClassName: string;
    validAttributes: Record<string, unknown>;
    bubblingEventTypes?: Record<string, { phasedRegistrationNames?: { bubbled?: string } }>;
    directEventTypes?: Record<string, { registrationName?: string }>;
  };
}
declare module "react-native/Libraries/Core/registerCallableModule" {
  const registerCallableModule: (name: string, module: object | (() => object)) => void;
  export default registerCallableModule;
}
declare module "react-native/Libraries/Image/resolveAssetSource" {
  const resolveAssetSource: (source: unknown) => { uri: string; width?: number; height?: number; scale: number } | null | undefined;
  export default resolveAssetSource;
}
declare module "react-native/Libraries/Utilities/Platform" {
  import type { Platform as ReactNativePlatform } from "react-native";
  const Platform: Extract<typeof ReactNativePlatform, { OS: "android" | "ios" }>;
  export default Platform;
}
declare module "react-native/Libraries/BatchedBridge/NativeModules" { const NativeModules: Record<string, unknown>; export default NativeModules; }
declare module "react-native/Libraries/EventEmitter/NativeEventEmitter" { const NativeEventEmitter: unknown; export default NativeEventEmitter; }
declare module "react-native/Libraries/AppState/AppState" {
  import type { AppState as ReactNativeAppState } from "react-native";
  const AppState: typeof ReactNativeAppState;
  export default AppState;
}
declare module "react-native/Libraries/Utilities/Dimensions" {
  import type { Dimensions as ReactNativeDimensions } from "react-native";
  const Dimensions: typeof ReactNativeDimensions;
  export default Dimensions;
}
declare module "react-native/Libraries/TurboModule/TurboModuleRegistry" { export function get<T>(name: string): T | null; export function getEnforcing<T>(name: string): T; }
declare module "react-native/Libraries/Components/Keyboard/Keyboard" {
  import type { Keyboard as ReactNativeKeyboard } from "react-native";
  const Keyboard: typeof ReactNativeKeyboard;
  export default Keyboard;
}
declare module "react-native/Libraries/vendor/emitter/EventEmitter" { export interface EventSubscription { remove(): void } }
declare module "react-native/Libraries/Core/setUpGlobals" {}
declare module "react-native/Libraries/Core/setUpXHR" {}
declare module "react-native/Libraries/Utilities/PolyfillFunctions" { export function polyfillGlobal<T>(name: string, getValue: () => T): void; }
declare module "react-native/Libraries/vendor/core/ErrorUtils" { const ErrorUtils: { setGlobalHandler(handler: (error: unknown, isFatal?: boolean) => void): void }; export default ErrorUtils; }
declare module "react-native/Libraries/Core/Devtools/parseErrorStack" { export default function parseErrorStack(stack?: string): Array<Record<string, unknown>>; }
declare module "react-native/Libraries/Core/NativeExceptionsManager" { const NativeExceptionsManager: { reportException(data: Record<string, unknown>): void; reportSoftException?(message: string, stack: unknown, id: number): void } | null; export default NativeExceptionsManager; }
declare module "react-native/src/private/webapis/microtasks/specs/NativeMicrotasks" { const Spec: { queueMicrotask: (callback: () => void) => void }; export default Spec; }
declare module "react-native/src/private/webapis/idlecallbacks/specs/NativeIdleCallbacks" { const Spec: { requestIdleCallback: unknown; cancelIdleCallback: unknown }; export default Spec; }
declare module "react-native/Libraries/Core/Timers/immediateShim" { export function setImmediate(callback: () => void): number; export function clearImmediate(handle: number): void; }
declare module "react-native/Libraries/EventEmitter/RCTDeviceEventEmitter" { const emitter: object; export default emitter; }
declare module "react-native/Libraries/EventEmitter/RCTNativeAppEventEmitter" { const emitter: object; export default emitter; }
declare module "react-native/Libraries/Utilities/RCTLog" { const RCTLog: object; export default RCTLog; }
declare module "react-native/Libraries/Utilities/HMRClientProdShim" { const shim: object; export default shim; }
declare module "react-native/Libraries/Utilities/HMRClient" { const client: object; export default client; }
declare const __DEV__: boolean;
declare module "react-native/Libraries/StyleSheet/StyleSheet" { const StyleSheet: object; export default StyleSheet; }
declare module "react-native/Libraries/Utilities/codegenNativeComponent" { const codegenNativeComponent: (name: string, options?: object) => unknown; export default codegenNativeComponent; }
declare module "react-native/Libraries/Renderer/shims/ReactNativeViewConfigRegistry" { export function register(name: string, callback: () => object): string; }

declare module "react-native/Libraries/ReactNative/I18nManager" { const I18nManager: { getConstants(): { isRTL: boolean; doLeftAndRightSwapInRTL: boolean; localeIdentifier?: string }; isRTL: boolean }; export default I18nManager; }

declare module "react-native/Libraries/StyleSheet/processColor" { const processColor: (color: unknown) => number | null | undefined; export default processColor; }
declare module "react-native/Libraries/Utilities/BackHandler" {
  import type { BackHandler as ReactNativeBackHandler } from "react-native";
  const BackHandler: typeof ReactNativeBackHandler;
  export default BackHandler;
}
declare module "react-native/Libraries/Linking/Linking" {
  import type { Linking as ReactNativeLinking } from "react-native";
  const Linking: typeof ReactNativeLinking;
  export default Linking;
}
declare module "react-native/Libraries/Utilities/PixelRatio" {
  import type { PixelRatio as ReactNativePixelRatio } from "react-native";
  const PixelRatio: typeof ReactNativePixelRatio;
  export default PixelRatio;
}
declare module "react-native/Libraries/Utilities/Appearance" {
  import type { Appearance as ReactNativeAppearance } from "react-native";
  export const getColorScheme: typeof ReactNativeAppearance.getColorScheme;
  export const setColorScheme: typeof ReactNativeAppearance.setColorScheme;
  export const addChangeListener: typeof ReactNativeAppearance.addChangeListener;
}
declare module "react-native/Libraries/Share/Share" {
  import type { Share as ReactNativeShare } from "react-native";
  const Share: typeof ReactNativeShare;
  export default Share;
}
declare module "react-native/Libraries/Vibration/Vibration" {
  import type { Vibration as ReactNativeVibration } from "react-native";
  const Vibration: typeof ReactNativeVibration;
  export default Vibration;
}
declare module "react-native/Libraries/Alert/Alert" {
  import type { Alert as ReactNativeAlert } from "react-native";
  const Alert: typeof ReactNativeAlert;
  export default Alert;
}
declare module "react-native/Libraries/Utilities/useColorScheme" { const useColorScheme: () => "light" | "dark" | null | undefined; export default useColorScheme; }
declare module "react-native/Libraries/Components/StatusBar/StatusBar" { const StatusBar: object; export default StatusBar; }
declare module "react-native/Libraries/Network/RCTNetworking" { const Networking: object; export default Networking; }
