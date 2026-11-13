/**
 * The JavaScript half of foreign views that is not the host's (SPEC.md, "Foreign views"): the callable module
 * react-native-webview's Android code reports messages and navigation requests to, and the names and view configs of
 * Expo modules' views. No React: the components that use these (`WebView.svelte`, `VideoView.svelte`) mount the Fabric
 * component by name, and the native side is the library's own.
 */
import { turboModule } from "../native-modules.js";
import { type Kind } from "./view-configs.js";
export { turboModule };
/** `RN$registerCallableModule`: native code calls the module's functions by name (`ReactContext.getJSModule`). */
export declare function registerCallableModule(name: string, module: object): void;
/** What the native WebView sends: the event the page's script or navigation produced, and the instance it belongs to. */
export type WebViewNativeEvent = Readonly<{
    url: string;
    loading: boolean;
    title: string;
    canGoBack: boolean;
    canGoForward: boolean;
    lockIdentifier: number;
}>;
export type WebViewMessage = WebViewNativeEvent & Readonly<{
    data: string;
}>;
export type WebViewRequest = WebViewNativeEvent & Readonly<{
    navigationType: string;
    mainDocumentURL?: string;
    isTopFrame: boolean;
}>;
/** One WebView instance's end of the messaging module: the page's `postMessage` calls and the requests to approve. */
export type WebViewSink = {
    message(event: {
        nativeEvent: WebViewMessage;
    }): void;
    request(event: {
        nativeEvent: WebViewRequest;
    }): void;
};
/** A name that tells one WebView's messages from another's; the native view echoes it in every message. */
export declare function nextWebViewName(): string;
/**
 * Routes the native WebView's messages for [name] to [sink] until the returned function is called. The Android WebView
 * reports `postMessage` calls and navigation requests through the JavaScript module `RNCWebViewMessagingModule` (not
 * through Fabric events), with the instance's `messagingModuleName` next to the native event.
 */
export declare function listenToWebView(name: string, sink: WebViewSink): () => void;
/** Answers a navigation request: the native WebView holds the navigation (up to 250 ms) until JavaScript says whether it may go on. */
export declare function answerRequest(shouldStart: boolean, lockIdentifier: number): void;
/** What a caller knows about an Expo view's props that the module's own config does not say: which are colours, lists of colours or images. */
export type ExpoViewKind = Pick<Kind, "colors" | "colorLists" | "assetSources">;
/**
 * The Fabric component name of an Expo module's view, with its view config defined from what the native module reports
 * (`expo.getViewConfig`: the props and the events the view declares). `NativeViewManagerAdapter` registers the same
 * configuration with React Native's registry for the React components; the host reads its own tables. A module's only
 * view has no view name (`ViewManagerAdapter_ExpoImage`); the props that take colours or images are named in [kind], which
 * the module's config does not distinguish from plain props (the React wrappers convert them before they reach the view).
 */
export declare function expoViewName(moduleName: string, viewName?: string, kind?: ExpoViewKind): string;
/** An `expo-video` player (or any Expo shared object) as the view's prop takes it: the registry id the native side resolves. */
export declare function sharedObjectId(value: unknown): number | null;
/** `StyleSheet.flatten`: a style given as nested arrays with falsy entries, as one object (a later entry wins). */
export declare function flattenStyle(style: unknown): Record<string, unknown>;
/** The part of the host's element handle (`HostHandle` in `host.ts`) the command wrappers below need. */
export type Commandable = {
    readonly tag: number;
    dispatchCommand(name: string, args?: unknown[]): void;
};
export type WebViewSource = number | {
    uri?: string;
    method?: string;
    body?: string;
    headers?: Record<string, string>;
    html?: string;
    baseUrl?: string;
};
/**
 * The `newSource` prop of the native WebView (react-native-webview's own conversion): the source with its headers as
 * a list of `{ name, value }`; a source given as an asset number is resolved first.
 */
export declare function nativeWebViewSource(source: WebViewSource | undefined, resolve: (source: number) => object | null | undefined): object | undefined;
/** Whether the origin of [url] matches one of the patterns (`https://*`); `about:blank` always does. */
export declare function passesOriginWhitelist(originWhitelist: readonly string[], url: string): boolean;
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
export declare function webViewHandle(host: Commandable): WebViewHandle;
export type Region = {
    latitude: number;
    longitude: number;
    latitudeDelta: number;
    longitudeDelta: number;
};
export type LatLng = {
    latitude: number;
    longitude: number;
};
export type EdgePadding = {
    top: number;
    right: number;
    bottom: number;
    left: number;
};
export type Camera = {
    center: LatLng;
    pitch: number;
    heading: number;
    altitude?: number;
    zoom?: number;
};
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
export declare function mapHandle(host: Commandable): MapHandle;
