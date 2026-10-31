/**
 * The JavaScript half of foreign views that is not the host's (SPEC.md, "Foreign views"): the callable module
 * react-native-webview's Android code reports messages and navigation requests to, and the names and view configs of
 * Expo modules' views. No React: the components that use these (`WebView.svelte`, `VideoView.svelte`) mount the Fabric
 * component by name, and the native side is the library's own.
 */
import { turboModule } from "../native-modules.ts";
import { defineViewKind } from "./view-configs.ts";

type Globals = {
  RN$registerCallableModule?: (name: string, factory: () => object) => void;
  expo?: {
    __expo_app_identifier__?: string;
    getViewConfig?: (moduleName: string, viewName?: string) => { validAttributes: Record<string, unknown>; directEventTypes?: Record<string, { registrationName: string }> | null } | null;
  };
};

/** `RN$registerCallableModule`: native code calls the module's functions by name (`ReactContext.getJSModule`). */
export function registerCallableModule(name: string, module: object): void {
  const register = (globalThis as Globals).RN$registerCallableModule;
  if (!register) throw new Error(`Cannot register ${name}: React Native's bridgeless runtime is not present`);
  register(name, () => module);
}

/** What the native WebView sends: the event the page's script or navigation produced, and the instance it belongs to. */
export type WebViewNativeEvent = Readonly<{ url: string; loading: boolean; title: string; canGoBack: boolean; canGoForward: boolean; lockIdentifier: number }>;
export type WebViewMessage = WebViewNativeEvent & Readonly<{ data: string }>;
export type WebViewRequest = WebViewNativeEvent & Readonly<{ navigationType: string; mainDocumentURL?: string; isTopFrame: boolean }>;

/** One WebView instance's end of the messaging module: the page's `postMessage` calls and the requests to approve. */
export type WebViewSink = {
  message(event: { nativeEvent: WebViewMessage }): void;
  request(event: { nativeEvent: WebViewRequest }): void;
};
type MessagingEvent<Native> = { nativeEvent: Native; messagingModuleName: string };

const sinks = new Map<string, WebViewSink>();
let instances = 0;
let registered = false;

/** A name that tells one WebView's messages from another's; the native view echoes it in every message. */
export function nextWebViewName(): string {
  instances += 1;
  return `WebViewMessageHandler${instances}`;
}

/**
 * Routes the native WebView's messages for [name] to [sink] until the returned function is called. The Android WebView
 * reports `postMessage` calls and navigation requests through the JavaScript module `RNCWebViewMessagingModule` (not
 * through Fabric events), with the instance's `messagingModuleName` next to the native event.
 */
export function listenToWebView(name: string, sink: WebViewSink): () => void {
  if (!registered) {
    registered = true;
    registerCallableModule("RNCWebViewMessagingModule", {
      onMessage: (event: MessagingEvent<WebViewMessage>) => sinks.get(event.messagingModuleName)?.message({ nativeEvent: event.nativeEvent }),
      onShouldStartLoadWithRequest: (event: MessagingEvent<WebViewRequest>) => sinks.get(event.messagingModuleName)?.request({ nativeEvent: event.nativeEvent }),
    });
  }
  sinks.set(name, sink);
  return () => { if (sinks.get(name) === sink) sinks.delete(name); };
}

type WebViewModule = { shouldStartLoadWithLockIdentifier(shouldStart: boolean, lockIdentifier: number): void };
let webViewModule: WebViewModule | undefined;

/** Answers a navigation request: the native WebView holds the navigation (up to 250 ms) until JavaScript says whether it may go on. */
export function answerRequest(shouldStart: boolean, lockIdentifier: number): void {
  webViewModule ??= turboModule<WebViewModule>("RNCWebViewModule");
  webViewModule.shouldStartLoadWithLockIdentifier(shouldStart, lockIdentifier);
}

const defined = new Set<string>();

/**
 * The Fabric component name of an Expo module's view, with its view config defined from what the native module reports
 * (`expo.getViewConfig`: the props and the events the view declares). `NativeViewManagerAdapter` registers the same
 * configuration with React Native's registry for the React components; the host reads its own tables.
 */
export function expoViewName(moduleName: string, viewName: string): string {
  const expo = (globalThis as Globals).expo;
  const name = `ViewManagerAdapter_${moduleName}_${viewName}${expo?.__expo_app_identifier__ ? `_${expo.__expo_app_identifier__}` : ""}`;
  if (defined.has(name)) return name;
  const config = expo?.getViewConfig?.(moduleName, viewName);
  if (!config) throw new Error(`Expo module ${moduleName} has no view ${viewName}`);
  defineViewKind(name, { plain: Object.keys(config.validAttributes).join(" "), events: Object.keys(config.directEventTypes ?? {}).join(" ") });
  defined.add(name);
  return name;
}

/** An `expo-video` player (or any Expo shared object) as the view's prop takes it: the registry id the native side resolves. */
export function sharedObjectId(value: unknown): number | null {
  if (typeof value === "number") return value;
  if (value !== null && typeof value === "object") {
    const id = (value as { __expo_shared_object_id__?: unknown }).__expo_shared_object_id__;
    if (typeof id === "number") return id;
  }
  return null;
}

/** The part of the host's element handle (`HostHandle` in `host.ts`) the command wrappers below need. */
export type Commandable = { readonly tag: number; dispatchCommand(name: string, args?: unknown[]): void };

export type WebViewSource = number | { uri?: string; method?: string; body?: string; headers?: Record<string, string>; html?: string; baseUrl?: string };

/**
 * The `newSource` prop of the native WebView (react-native-webview's own conversion): the source with its headers as
 * a list of `{ name, value }`; a source given as an asset number is resolved first.
 */
export function nativeWebViewSource(source: WebViewSource | undefined, resolve: (source: number) => object | null | undefined): object | undefined {
  if (source === undefined) return undefined;
  const resolved = typeof source === "number" ? resolve(source) : source;
  if (resolved === null || resolved === undefined) return undefined;
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(resolved)) {
    result[key] = key === "headers" && value && typeof value === "object" ? Object.entries(value as Record<string, string>).map(([name, headerValue]) => ({ name, value: headerValue })) : value;
  }
  return result;
}

const extractOrigin = (url: string): string => /^[A-Za-z][A-Za-z0-9+\-.]+:(\/\/)?[^/]*/.exec(url)?.[0] ?? "";
const escapeRegExp = (text: string): string => text.replace(/[|\\{}()[\]^$+*?.]/g, "\\$&").replace(/-/g, "\\x2d");

/** Whether the origin of [url] matches one of the patterns (`https://*`); `about:blank` always does. */
export function passesOriginWhitelist(originWhitelist: readonly string[], url: string): boolean {
  const origin = extractOrigin(url);
  return ["about:blank", ...originWhitelist].some((pattern) => new RegExp(`^${escapeRegExp(pattern).replace(/\\\*/g, ".*")}`).test(origin));
}

/** The commands of the native WebView (`RNCWebViewNativeComponent`), as the methods of its React component. */
export type WebViewHandle = {
  goBack(): void;
  goForward(): void;
  reload(): void;
  stopLoading(): void;
  postMessage(data: string): void;
  injectJavaScript(script: string): void;
  requestFocus(): void;
  loadUrl(url: string): void;
  clearFormData(): void;
  clearCache(includeDiskFiles: boolean): void;
  clearHistory(): void;
};
export function webViewHandle(host: Commandable): WebViewHandle {
  return {
    goBack: () => host.dispatchCommand("goBack"),
    goForward: () => host.dispatchCommand("goForward"),
    reload: () => host.dispatchCommand("reload"),
    stopLoading: () => host.dispatchCommand("stopLoading"),
    postMessage: (data) => host.dispatchCommand("postMessage", [data]),
    injectJavaScript: (script) => host.dispatchCommand("injectJavaScript", [script]),
    requestFocus: () => host.dispatchCommand("requestFocus"),
    loadUrl: (url) => host.dispatchCommand("loadUrl", [url]),
    clearFormData: () => host.dispatchCommand("clearFormData"),
    clearCache: (includeDiskFiles) => host.dispatchCommand("clearCache", [includeDiskFiles]),
    clearHistory: () => host.dispatchCommand("clearHistory"),
  };
}

export type Region = { latitude: number; longitude: number; latitudeDelta: number; longitudeDelta: number };
export type LatLng = { latitude: number; longitude: number };
export type EdgePadding = { top: number; right: number; bottom: number; left: number };
export type Camera = { center: LatLng; pitch: number; heading: number; altitude?: number; zoom?: number };

/** The commands of the native map (`NativeComponentMapView`); the Fabric commands take JSON strings for objects, as react-native-maps' own handle sends them. */
export type MapHandle = {
  animateToRegion(region: Region, duration?: number): void;
  setCamera(camera: Partial<Camera>): void;
  animateCamera(camera: Partial<Camera>, duration?: number): void;
  fitToElements(edgePadding?: Partial<EdgePadding>, animated?: boolean): void;
  fitToSuppliedMarkers(markers: string[], edgePadding?: Partial<EdgePadding>, animated?: boolean): void;
  fitToCoordinates(coordinates: LatLng[], edgePadding?: Partial<EdgePadding>, animated?: boolean): void;
  setIndoorActiveLevelIndex(index: number): void;
  /** The camera the native map shows now, through react-native-maps' TurboModule (`RNMapsAirModule`). */
  getCamera(): Promise<Camera>;
};
type MapModule = { getCamera(tag: number): Promise<Camera> };
let mapModule: MapModule | undefined;
const noPadding: EdgePadding = { top: 0, right: 0, bottom: 0, left: 0 };
export function mapHandle(host: Commandable): MapHandle {
  const padding = (edgePadding?: Partial<EdgePadding>): string => JSON.stringify({ ...noPadding, ...edgePadding });
  return {
    animateToRegion: (region, duration = 500) => host.dispatchCommand("animateToRegion", [JSON.stringify(region), duration]),
    setCamera: (camera) => host.dispatchCommand("setCamera", [JSON.stringify(camera)]),
    animateCamera: (camera, duration = 500) => host.dispatchCommand("animateCamera", [JSON.stringify(camera), duration]),
    fitToElements: (edgePadding, animated = true) => host.dispatchCommand("fitToElements", [padding(edgePadding), animated]),
    fitToSuppliedMarkers: (markers, edgePadding, animated = true) => host.dispatchCommand("fitToSuppliedMarkers", [JSON.stringify(markers), padding(edgePadding), animated]),
    fitToCoordinates: (coordinates, edgePadding, animated = true) => host.dispatchCommand("fitToCoordinates", [JSON.stringify(coordinates), padding(edgePadding), animated]),
    setIndoorActiveLevelIndex: (index) => host.dispatchCommand("setIndoorActiveLevelIndex", [index]),
    getCamera: () => {
      mapModule ??= turboModule<MapModule>("RNMapsAirModule");
      return mapModule.getCamera(host.tag);
    },
  };
}
