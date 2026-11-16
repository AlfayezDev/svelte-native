import { type BundleOptions, baseStubs, load, src } from "./bundle.ts";

/**
 * The bundles of the router tests (navigation, the stand-in app, SvelteKit's modules): a fixture mounted through the Fabric host on the fake binding, with React Native's router-facing
 * modules stood in for by one table whose answers the test chooses through globals, so every router test shares one bundle per fixture:
 *
 * - `__navigationOS` is `Platform.OS` (default `android`); `__navigationInsets` is what the engine's `getInsets` answers (no value: no engine);
 * - `__backHandlers` and `__linkHandlers` collect what `BackHandler` and `Linking` were asked to listen for, as the arrays React Native would call, newest last;
 * - `__initialURL` is what `Linking.getInitialURL` answers and `__initialURLMode` how (`reject`, `throw` at once, `hang` for good, `late` until `__resolveInitialURL` is called), with
 *   `__initialURLReads` counting the reads; `Linking.openURL` pushes onto `__kitOpened`;
 * - `__appState` is `AppState.currentState` (`__appStateHandlers` the listeners); `__kitConstants` is `expo-constants`' `expoConfig`; `__kitUpdates` is the `SvelteUpdates` native module.
 *
 * Globals a test sets are put back by the fake host's restore (`fake-host.ts`).
 */
const listener = (list: string) => `const handlers = (globalThis.${list} ??= []); const listen = (name, handler) => { handlers.push(handler); return { remove() { const at = handlers.indexOf(handler); if (at >= 0) handlers.splice(at, 1); } }; };`;

export const routerStubs: Record<string, string> = {
  ...baseStubs(),
  // What the iOS navigation views register their configs with, and what builds the payload of a view whose configs React Native knows.
  "react-native/Libraries/ReactNative/ReactFabricPublicInstance/ReactNativeAttributePayload": "export const create = (props) => ({ ...props }); export const diff = (prev, next) => { const out = {}; let changed = false; for (const k of new Set([...Object.keys(prev), ...Object.keys(next)])) { if (prev[k] !== next[k]) { out[k] = k in next ? next[k] : null; changed = true; } } return changed ? out : null; };",
  "react-native/Libraries/Renderer/shims/ReactNativeViewConfigRegistry": "export const register = (name) => name; export const get = (name) => ({ uiViewClassName: name, validAttributes: {}, bubblingEventTypes: { topChange: { phasedRegistrationNames: { bubbled: 'onChange', captured: 'onChangeCapture' } } }, directEventTypes: { topLayout: { registrationName: 'onLayout' }, topScroll: { registrationName: 'onScroll' } } });",
  "react-native/Libraries/Utilities/Platform": "export default { get OS() { return globalThis.__navigationOS ?? 'android'; }, Version: 34 };",
  "react-native/Libraries/Utilities/BackHandler": `${listener("__backHandlers")} export default { addEventListener: listen };`,
  "react-native/Libraries/Linking/Linking": `${listener("__linkHandlers")} export default { addEventListener: listen, openURL: (url) => { (globalThis.__kitOpened ??= []).push(url); return Promise.resolve(); }, getInitialURL: () => {
    globalThis.__initialURLReads = (globalThis.__initialURLReads ?? 0) + 1;
    const mode = globalThis.__initialURLMode;
    if (mode === 'throw') throw new Error('the link service threw at once');
    if (mode === 'reject') return Promise.reject(new Error('the link service is down'));
    if (mode === 'hang') return new Promise(() => {});
    if (mode === 'late') return new Promise((resolve) => { globalThis.__resolveInitialURL = resolve; });
    return Promise.resolve(globalThis.__initialURL ?? null);
  } };`,
  "react-native/Libraries/AppState/AppState": `${listener("__appStateHandlers")} export default { get currentState() { return globalThis.__appState ?? 'active'; }, addEventListener: listen };`,
  "react-native/Libraries/Image/resolveAssetSource": "export default (source) => source && typeof source === 'object' && 'uri' in source ? { scale: 1, ...source } : null;",
  "react-native/Libraries/Components/Keyboard/Keyboard": "export default { isVisible: () => false, dismiss() {} };",
  "react-native/Libraries/NativeComponent/ViewConfig": "export const createViewConfig = (partial) => partial;",
  "expo-constants": "export default { get expoConfig() { return globalThis.__kitConstants ?? null; } };",
  "expo-modules-core": `export const EventEmitter = class {};
    export const requireOptionalNativeModule = (name) => {
      if (name === 'SvelteEngine' && globalThis.__navigationInsets) return { install: () => false, getInsets: () => globalThis.__navigationInsets, addListener: () => ({ remove() {} }) };
      if (name === 'SvelteUpdates') return globalThis.__kitUpdates ?? null;
      return null;
    };`,
};

export type RouterBundleOptions = Omit<BundleOptions, "entry" | "stubs" | "viewConfigs" | "converters"> & { stubs?: Record<string, string> };

/** Bundles `entry` for a router test (the host passes every prop through, no React Native style converters) and evaluates it afresh. */
export function loadRouter<T = Record<string, unknown>>(entry: string, options: RouterBundleOptions = {}): Promise<T> {
  return load<T>({ ...options, entry, stubs: { ...routerStubs, ...options.stubs }, viewConfigs: "pass-through", converters: false });
}

/** What `loadRouterApp` exports: the host's entry points and the fixture, as the router tests drive them. */
export type RouterApp = {
  startSurface: typeof import("../../src/fabric/host.ts").startSurface;
  flush: typeof import("../../src/fabric/host.ts").flush;
  fabricStats: typeof import("../../src/fabric/host.ts").fabricStats;
  openLaunchURL: typeof import("../../src/router.svelte.ts").openLaunchURL;
  tick: () => Promise<void>;
  Fixture: Parameters<typeof import("../../src/fabric/host.ts").startSurface>[1];
};

/** The fixture at `fixture` (an absolute path) mounted through the Fabric host. */
export function loadRouterApp(fixture: string, options: RouterBundleOptions = {}): Promise<RouterApp> {
  return loadRouter<RouterApp>(`import Fixture from ${JSON.stringify(fixture)};
    import { startSurface, flush, fabricStats } from ${JSON.stringify(src("fabric/host.ts"))};
    import { openLaunchURL } from ${JSON.stringify(src("router.svelte.ts"))};
    import { tick } from 'svelte';
    export { startSurface, flush, fabricStats, openLaunchURL, tick, Fixture };`, options);
}
