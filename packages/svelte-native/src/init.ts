/**
 * Pre-main setup for the React-free Fabric entry, run instead of React Native's `InitializeCore`.
 *
 * Imports are deep paths only (never the `react-native` index) and every one is needed at startup or by the
 * SpacetimeDB SDK. Deliberately skipped: DOM/IntersectionObserver/MutationObserver setup, the `Performance` class
 * (a `performance.now` shim stands in), Promise and regenerator polyfills (Hermes has both), `setUpAlert`, the
 * segment fetcher, LogBox, React DevTools, React Refresh, Systrace and the legacy performance-logger module.
 * `AppRegistry` is our own small callable module: React Native's drags in `renderApplication`, React and LogBox.
 */
import { mark } from "./boot-marks.ts";
import "react-native/Libraries/Core/setUpGlobals";
import { polyfillGlobal } from "react-native/Libraries/Utilities/PolyfillFunctions";
import ErrorUtils from "react-native/Libraries/vendor/core/ErrorUtils";
import parseErrorStack from "react-native/Libraries/Core/Devtools/parseErrorStack";
import NativeExceptionsManager from "react-native/Libraries/Core/NativeExceptionsManager";
import NativeMicrotasks from "react-native/src/private/webapis/microtasks/specs/NativeMicrotasks";
import NativeIdleCallbacks from "react-native/src/private/webapis/idlecallbacks/specs/NativeIdleCallbacks";
import { setImmediate, clearImmediate } from "react-native/Libraries/Core/Timers/immediateShim";
import RCTDeviceEventEmitter from "react-native/Libraries/EventEmitter/RCTDeviceEventEmitter";
import RCTNativeAppEventEmitter from "react-native/Libraries/EventEmitter/RCTNativeAppEventEmitter";
import RCTLog from "react-native/Libraries/Utilities/RCTLog";
import HMRClientProdShim from "react-native/Libraries/Utilities/HMRClientProdShim";
import "react-native/Libraries/Core/setUpXHR";
import { AppRegistry } from "./fabric/app-registry.ts";

type Globals = {
  RN$Bridgeless?: boolean;
  RN$registerCallableModule?: (name: string, factory: () => object) => void;
  RN$AppRegistry?: unknown;
  RN$stopSurface?: (rootTag: number) => void;
  RN$enableMicrotasksInReact?: boolean;
  RN$notifyOfFatalException?: () => void;
  RN$hasHandledFatalException?: () => boolean;
  nativePerformanceNow?: () => number;
  performance?: { now?: () => number };
  navigator?: { product?: string };
  __fbDisableExceptionsManager?: boolean;
};
const globals = globalThis as unknown as Globals;
if (globals.RN$Bridgeless !== true || !globals.RN$registerCallableModule) throw new Error("svelte-native init requires React Native bridgeless mode");

// Timers are native in bridgeless mode; these are the polyfills React Native layers on top.
globals.RN$enableMicrotasksInReact = true;
polyfillGlobal("queueMicrotask", () => NativeMicrotasks.queueMicrotask);
// Web globals referenced by name at run time (Svelte's `$state.snapshot` clone checks `instanceof EventTarget`,
// Reanimated and Svelte test for `DOMRect`); React Native's `setUpDOM` installs these lazily and so do we.
/* eslint-disable @typescript-eslint/no-require-imports */
polyfillGlobal("Event", () => require("react-native/src/private/webapis/dom/events/Event").default);
polyfillGlobal("EventTarget", () => require("react-native/src/private/webapis/dom/events/EventTarget").default);
polyfillGlobal("CustomEvent", () => require("react-native/src/private/webapis/dom/events/CustomEvent").default);
polyfillGlobal("DOMRectReadOnly", () => require("react-native/src/private/webapis/geometry/DOMRectReadOnly").default);
polyfillGlobal("DOMRect", () => require("react-native/src/private/webapis/geometry/DOMRect").default);
/* eslint-enable @typescript-eslint/no-require-imports */
polyfillGlobal("setImmediate", () => setImmediate);
polyfillGlobal("clearImmediate", () => clearImmediate);
polyfillGlobal("requestIdleCallback", () => NativeIdleCallbacks.requestIdleCallback);
polyfillGlobal("cancelIdleCallback", () => NativeIdleCallbacks.cancelIdleCallback);

if (!globals.performance?.now) {
  const now = () => globals.nativePerformanceNow?.() ?? Date.now();
  globals.performance = Object.assign(globals.performance ?? {}, { now });
}
globals.navigator ??= { product: "ReactNative" };

// Uncaught errors go to the native exception manager (red box in development, crash report in release).
let exceptionId = 0;
if (!globals.__fbDisableExceptionsManager) {
  ErrorUtils.setGlobalHandler((error: unknown, isFatal?: boolean) => {
    const e = (error instanceof Error ? error : new Error(String(error))) as Error & { jsEngine?: string };
    const name = e.name || null;
    const original = e.message || "";
    const message = name && !original.startsWith(`${name}: `) ? `${name}: ${original}` : original;
    // In development a fatal error is drawn on the surface and reported as non-fatal: the native fatal path kills the process, and with it the screen and the Reload button.
    let shown = false;
    if (__DEV__ && isFatal) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        shown = (require("./fabric/hmr.ts") as typeof import("./fabric/hmr.ts")).showError(e);
      } catch (inner) { console.error("Svelte Native could not show the error screen", inner); }
    }
    // The updates host (`updates/launch.ts`) does not confirm a launch that saw a fatal error.
    if (isFatal) (globalThis as { __svelteFatalSeen?: boolean }).__svelteFatalSeen = true;
    if (isFatal && !shown) {
      if (globals.RN$hasHandledFatalException?.()) return;
      globals.RN$notifyOfFatalException?.();
    }
    NativeExceptionsManager?.reportException({
      message,
      originalMessage: message === original ? null : original,
      name,
      componentStack: null,
      stack: parseErrorStack(e.stack),
      id: ++exceptionId,
      isFatal: !!isFatal && !shown,
      extraData: { jsEngine: e.jsEngine, rawStack: e.stack },
    });
  });
}

// In development `console.error` also reaches the native exception manager as a soft exception, so it shows in the logs and Metro's terminal.
const reportSoft = NativeExceptionsManager?.reportSoftException?.bind(NativeExceptionsManager);
if (__DEV__ && reportSoft) {
  const original = console.error.bind(console);
  let reporting = false;
  const format = (value: unknown): string => {
    if (typeof value === "string") return value;
    if (value instanceof Error) return `${value.name}: ${value.message}`;
    try { return JSON.stringify(value) ?? String(value); } catch { return String(value); }
  };
  console.error = (...args: unknown[]) => {
    original(...args);
    if (reporting) return;
    reporting = true;
    try {
      const error = args.find((arg): arg is Error => arg instanceof Error);
      reportSoft(args.map(format).join(" "), parseErrorStack(error?.stack ?? new Error().stack), ++exceptionId);
    } catch { /* reporting must never throw out of console.error */ } finally { reporting = false; }
  };
}

// Modules the native side calls by name. `callableModules_.emplace` keeps the first registration of a name.
const register = (name: string, module: object) => globals.RN$registerCallableModule?.(name, () => module);
register("RCTLog", RCTLog);
register("RCTDeviceEventEmitter", RCTDeviceEventEmitter);
register("RCTNativeAppEventEmitter", RCTNativeAppEventEmitter);
// Metro drops the development branch from release bundles, so HMRClient stays out of them.
// eslint-disable-next-line @typescript-eslint/no-require-imports
register("HMRClient", __DEV__ ? require("react-native/Libraries/Utilities/HMRClient").default : HMRClientProdShim);
register("AppRegistry", AppRegistry);
globals.RN$AppRegistry = AppRegistry;
// `AppRegistryBinding::stopSurface` (surface teardown, host reload) calls this global; React Native installs it from its renderer shim.
globals.RN$stopSurface = (rootTag: number) => { (globalThis as { __svelteFabricStop?: (rootTag: number) => void }).__svelteFabricStop?.(rootTag); };
mark("init");
