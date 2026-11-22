import type { ClassProps } from "../classes.js";
import { type WebViewHandle, type WebViewMessage, type WebViewRequest, type WebViewSource } from "../fabric/foreign.js";
import type { ViewProps } from "react-native";
type Event<Native = Record<string, unknown>> = {
    nativeEvent: Native;
};
type $$ComponentProps = Omit<ViewProps, "children"> & {
    source?: WebViewSource;
    /** Receives the commands (`injectJavaScript`, `reload`, `postMessage`, ...) or null on unmount. */
    ref?: (handle: (WebViewHandle & {
        host: unknown;
    }) | null) => void;
    originWhitelist?: readonly string[];
    injectedJavaScriptObject?: object;
    onMessage?: (event: Event<WebViewMessage>) => void;
    onLoadStart?: (event: Event) => void;
    onLoad?: (event: Event) => void;
    onLoadEnd?: (event: Event) => void;
    onError?: (event: Event) => void;
    onHttpError?: (event: Event) => void;
    onLoadProgress?: (event: Event<{
        progress: number;
    }>) => void;
    onLoadSubResourceError?: (event: Event) => void;
    onNavigationStateChange?: (navigation: Record<string, unknown>) => void;
    /** Return false to cancel a navigation; the page keeps loading when this is not given. */
    onShouldStartLoadWithRequest?: (request: WebViewRequest) => boolean;
    onOpenWindow?: (event: Event) => void;
    onRenderProcessGone?: (event: Event) => void;
    onScroll?: (event: Event) => void;
    [prop: string]: unknown;
} & ClassProps;
declare const WebView: import("svelte").Component<$$ComponentProps, {}, "">;
type WebView = ReturnType<typeof WebView>;
export default WebView;
