/**
 * Views other libraries own, mounted through React Native's own mounting inside the engine's tree (SPEC.md, "Foreign
 * views"). A separate entry, so an app that shows none of them does not evaluate them at boot.
 */
export { default as ForeignView } from "./components/ForeignView.svelte";
export { default as WebView } from "./components/WebView.svelte";
export { default as MapView } from "./components/MapView.svelte";
export { default as Marker } from "./components/Marker.svelte";
export { default as VideoView } from "./components/VideoView.svelte";
export type { Camera, EdgePadding, LatLng, MapHandle, Region, WebViewHandle, WebViewMessage, WebViewRequest, WebViewSource } from "./fabric/foreign.ts";
