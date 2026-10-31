<script lang="ts">
  import { forwardRef } from "./forward-ref.ts";
  import { onDestroy } from "svelte";
  import type {} from "../elements.d.ts";
  import { createNativeProps } from "../native-props.ts";
  import { resolveAssetSource } from "../fabric/deps-rn.ts";
  import {
    answerRequest, listenToWebView, nativeWebViewSource, nextWebViewName, passesOriginWhitelist, webViewHandle,
    type Commandable, type WebViewHandle, type WebViewMessage, type WebViewRequest, type WebViewSource,
  } from "../fabric/foreign.ts";
  import type { ViewProps } from "react-native";

  type Event<Native = Record<string, unknown>> = { nativeEvent: Native };
  /**
   * The native WebView (react-native-webview) as a Svelte component, with the props and events of that package's
   * Android component. Not ported: `renderLoading`, `renderError`, `startInLoadingState` (the React component's loading
   * and error views) and `nativeConfig`. Every prop not named here is a prop of the native view (`RNCWebView`).
   */
  let {
    source, style, ref, originWhitelist = ["http://*", "https://*"], injectedJavaScriptObject,
    onMessage, onLoadStart, onLoad, onLoadEnd, onError, onHttpError, onLoadProgress, onLoadSubResourceError,
    onNavigationStateChange, onShouldStartLoadWithRequest, onOpenWindow, onRenderProcessGone, onScroll,
    ...attributes
  }: Omit<ViewProps, "children"> & {
    source?: WebViewSource;
    /** Receives the commands (`injectJavaScript`, `reload`, `postMessage`, ...) or null on unmount. */
    ref?: (handle: (WebViewHandle & { host: unknown }) | null) => void;
    originWhitelist?: readonly string[];
    injectedJavaScriptObject?: object;
    onMessage?: (event: Event<WebViewMessage>) => void;
    onLoadStart?: (event: Event) => void;
    onLoad?: (event: Event) => void;
    onLoadEnd?: (event: Event) => void;
    onError?: (event: Event) => void;
    onHttpError?: (event: Event) => void;
    onLoadProgress?: (event: Event<{ progress: number }>) => void;
    onLoadSubResourceError?: (event: Event) => void;
    onNavigationStateChange?: (navigation: Record<string, unknown>) => void;
    /** Return false to cancel a navigation; the page keeps loading when this is not given. */
    onShouldStartLoadWithRequest?: (request: WebViewRequest) => boolean;
    onOpenWindow?: (event: Event) => void;
    onRenderProcessGone?: (event: Event) => void;
    onScroll?: (event: Event) => void;
    [prop: string]: unknown;
  } = $props();

  const messagingModuleName = nextWebViewName();
  const resolveProps = createNativeProps();
  let host: Commandable | null = null;
  const stopListening = listenToWebView(messagingModuleName, {
    message: (event) => onMessage?.(event),
    request: (event) => {
      const { url, lockIdentifier } = event.nativeEvent;
      // The native view holds the navigation until it is answered: an origin outside the whitelist goes to the system.
      let shouldStart = passesOriginWhitelist(originWhitelist, url);
      if (!shouldStart) openExternally(url);
      else if (onShouldStartLoadWithRequest) shouldStart = onShouldStartLoadWithRequest(event.nativeEvent);
      if (lockIdentifier) answerRequest(shouldStart, lockIdentifier);
      else if (shouldStart) host?.dispatchCommand("loadUrl", [url]);
    },
  });
  onDestroy(stopListening);

  function openExternally(url: string): void {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { default: Linking } = require("react-native/Libraries/Linking/Linking") as { default: { openURL(url: string): Promise<unknown> } };
    Linking.openURL(url).catch((error: unknown) => console.warn("WebView could not open", url, error));
  }

  const hostRef = $derived(forwardRef(ref, (given: Commandable) => ({ ...webViewHandle(given), host: given }), (given) => { host = given; }));
  const navigation = (event: Event) => onNavigationStateChange?.(event.nativeEvent);
  const handlers = {
    onLoadingStart: (event: Event) => { onLoadStart?.(event); navigation(event); },
    onLoadingFinish: (event: Event) => { onLoad?.(event); onLoadEnd?.(event); navigation(event); },
    onLoadingError: (event: Event) => {
      if (onError) onError(event);
      else console.warn("Encountered an error loading page", event.nativeEvent);
      onLoadEnd?.(event);
    },
    onLoadingProgress: (event: Event<{ progress: number }>) => onLoadProgress?.(event),
    onLoadingSubResourceError: (event: Event) => onLoadSubResourceError?.(event),
    onHttpError: (event: Event) => onHttpError?.(event),
    onRenderProcessGone: (event: Event) => onRenderProcessGone?.(event),
    onOpenWindow: (event: Event) => onOpenWindow?.(event),
  };
  const newSource = $derived(nativeWebViewSource(source, (asset) => resolveAssetSource(asset as never)));
</script>
<native-foreign component="RNCWebView" nativeProps={resolveProps({
  overScrollMode: "always", javaScriptEnabled: true, thirdPartyCookiesEnabled: true, scalesPageToFit: true,
  allowsFullscreenVideo: false, allowFileAccess: false, saveFormDataDisabled: false, cacheEnabled: true,
  androidLayerType: "none", setSupportMultipleWindows: true, setBuiltInZoomControls: true, setDisplayZoomControls: false,
  nestedScrollEnabled: false,
  ...attributes,
  messagingEnabled: typeof onMessage === "function",
  messagingModuleName,
  hasOnScroll: typeof onScroll === "function",
  hasOnOpenWindowEvent: typeof onOpenWindow === "function",
  injectedJavaScriptObject: JSON.stringify(injectedJavaScriptObject),
  newSource,
  ...handlers,
  onScroll,
  onShouldStartLoadWithRequest: true,
  style: [{ flex: 1, overflow: "hidden", backgroundColor: "#ffffff" }, style],
  ref: hostRef,
})}></native-foreign>
