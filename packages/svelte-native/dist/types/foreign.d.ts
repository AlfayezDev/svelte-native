/**
 * Views other libraries own, mounted through React Native's own mounting inside the engine's tree (SPEC.md, "Foreign
 * views"). A separate entry, so an app that shows none of them does not evaluate them at boot.
 */
export { default as ForeignView } from "./components/ForeignView.svelte";
export { default as ExpoView } from "./components/ExpoView.svelte";
export { defineExpoView } from "./components/define-expo-view.js";
export { default as WebView } from "./components/WebView.svelte";
export { default as MapView } from "./components/MapView.svelte";
export { default as Marker } from "./components/Marker.svelte";
export { default as VideoView } from "./components/VideoView.svelte";
export { default as ExpoImage } from "./components/ExpoImage.svelte";
export { default as BlurView } from "./components/BlurView.svelte";
export { default as ExpoBlurView } from "./components/ExpoBlurView.svelte";
export { default as BlurTargetView } from "./components/BlurTargetView.svelte";
export { default as LinearGradient } from "./components/LinearGradient.svelte";
export { default as Video } from "./components/Video.svelte";
export { default as DateTimePicker } from "./components/DateTimePicker.svelte";
export { default as LottieView } from "./components/LottieView.svelte";
export { default as Pdf } from "./components/Pdf.svelte";
export { default as ViewShot } from "./components/ViewShot.svelte";
export { default as Rive } from "./components/Rive.svelte";
export { default as ConicGradient } from "./components/ConicGradient.svelte";
export { default as ShadowedView } from "./components/ShadowedView.svelte";
export { default as AnimateableText } from "./components/AnimateableText.svelte";
export { dismissDatePicker, openDatePicker } from "./fabric/foreign-datetime.js";
export { captureRef, captureScreen, releaseCapture } from "./fabric/foreign-capture.js";
export { shadowStyle } from "./fabric/foreign-shadow.js";
export type { ExpoViewProps } from "./components/define-expo-view.js";
export type { ExpoViewHandle, UntypedExpoViewHandle } from "./fabric/foreign-expo-view.js";
export type { Camera, EdgePadding, LatLng, MapHandle, Region, WebViewHandle, WebViewMessage, WebViewRequest, WebViewSource } from "./fabric/foreign.js";
export type { DatePickerOptions, DatePickerProps, DatePickerChange } from "./fabric/foreign-datetime.js";
export type { VideoHandle, VideoSource } from "./fabric/foreign-video.js";
export type { LottieHandle, LottieSource } from "./fabric/foreign-lottie.js";
export type { GradientPoint } from "./fabric/foreign-gradient.js";
export type { BlurTint } from "./fabric/foreign-blur.js";
export type { ExpoImageProps, ImageContentFit, ImageContentPosition, ImageSource, ImageSourceProp, ImageTransition } from "./fabric/foreign-image.js";
export type { PdfHandle, PdfSource } from "./fabric/foreign-pdf.js";
export type { CaptureFormat, CaptureOptions, CaptureResult, CaptureTarget } from "./fabric/foreign-capture.js";
export type { RiveAlignment, RiveDataBinding, RiveDirection, RiveError, RiveFit, RiveHandle, RiveLoopMode, RiveSource } from "./fabric/foreign-rive.js";
export type { CornerRadii, ShadowParams } from "./fabric/foreign-shadow.js";
