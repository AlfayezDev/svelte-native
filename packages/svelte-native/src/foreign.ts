/**
 * Views other libraries own, mounted through React Native's own mounting inside the engine's tree (SPEC.md, "Foreign
 * views"). A separate entry, so an app that shows none of them does not evaluate them at boot.
 */
export { default as ForeignView } from "./components/ForeignView.svelte";
export { default as WebView } from "./components/WebView.svelte";
export { default as MapView } from "./components/MapView.svelte";
export { default as Marker } from "./components/Marker.svelte";
export { default as VideoView } from "./components/VideoView.svelte";
export { default as ExpoImage } from "./components/ExpoImage.svelte";
export { default as BlurView } from "./components/BlurView.svelte";
export { default as BlurTargetView } from "./components/BlurTargetView.svelte";
export { default as LinearGradient } from "./components/LinearGradient.svelte";
export { default as Video } from "./components/Video.svelte";
export { default as DateTimePicker } from "./components/DateTimePicker.svelte";
export { default as LottieView } from "./components/LottieView.svelte";
export { dismissDatePicker, openDatePicker } from "./fabric/foreign-datetime.ts";
export type { Camera, EdgePadding, LatLng, MapHandle, Region, WebViewHandle, WebViewMessage, WebViewRequest, WebViewSource } from "./fabric/foreign.ts";
export type { DatePickerOptions, DatePickerProps, DatePickerChange } from "./fabric/foreign-datetime.ts";
export type { VideoHandle, VideoSource } from "./fabric/foreign-video.ts";
export type { LottieHandle, LottieSource } from "./fabric/foreign-lottie.ts";
export type { GradientPoint } from "./fabric/foreign-gradient.ts";
export type { ExpoImageProps, ImageContentFit, ImageContentPosition, ImageSource, ImageSourceProp, ImageTransition } from "./fabric/foreign-image.ts";
