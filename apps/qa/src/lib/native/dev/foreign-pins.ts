/**
 * The native view each library must mount, named the way the platform names it (`foreign-libraries-checks.ts`, `mounts`): no React Native import, so the harness's tests load
 * it and hold every pin against the view trees a device printed (`qa/test/ios-foreign-pins.test.ts`).
 *
 * Android's classes are the libraries' own Kotlin and Java, read by `SvelteEngine.inspect`. iOS's are what UIKit holds for the section (`SvelteQA.inspect`, `SvelteQAViews.swift`), and
 * the two spellings it uses are not the same:
 * - the section's view is named by `NSStringFromClass`, so a Swift class carries its module (`ExpoImage.ImageView`) and a class with an `@objc(Name)` its Objective-C name;
 * - every view below it is named by `String(describing: type(of:))`, which is the Swift name without the module (`ContainerView`, for the class Lottie exports to Objective-C as
 *   `LottieContainerView`) and spells a generic class with its arguments (`HostingView<ConicGradientProps, ConicGradientView>`).
 * A pin that spells the one with the other's rules never matches, which is how four of them read as failures on the first iPhone run while the libraries' views were all there.
 */

/** The pin of one platform: [host] is the full class name of the view the section's handle names, [inside] the name of a view in the tree below it (a library whose native view sits behind children is reached through the section's box, and its size is that of this view). */
export type Pin = { host?: string; inside?: string };

/** What a device says it built for a handle: the class of its view and the views below it, indented by depth, each with its size. */
export type Mounted = { class: string; views: readonly string[] };

/** Android's pin names one of the two; iOS's names either or both (React Native's own view holding the library's, or the library's view alone). */
export type Pinned = ({ host: string } | { inside: string }) & { ios: ({ host: string } | { inside: string }) & Pin };

/**
 * Whether [mounted] is the library's view as [pinned] names it for the platform, with the name to print and the entry of the tree that [Pin.inside] matched (its size is the view's
 * own). An entry matches when it starts with the name and a space (the size follows): `RCTViewComponentView` never matches `RCTViewComponentViewFoo`.
 */
export function resolvePin(android: boolean, pinned: Pinned, mounted: Mounted): { name: string; there: boolean; entry: string | undefined } {
  const pin: Pin = android ? ("inside" in pinned ? { inside: pinned.inside } : { host: pinned.host }) : pinned.ios;
  const entry = pin.inside === undefined ? undefined : mounted.views.find((view) => view.trim().startsWith(`${pin.inside} `));
  const name = android ? ("inside" in pinned ? pinned.inside : pinned.host) : [pin.host, pin.inside === undefined ? undefined : `${pin.inside} inside`].filter(Boolean).join(", ");
  const there = (pin.host === undefined || mounted.class === pin.host) && (pin.inside === undefined || entry !== undefined);
  return { name, there, entry };
}

/**
 * Each library's view. Where a library's view is not the section's own, the comment says what the first iPhone run (3 Nov, `foreign-E74A5608-...-20261103T122249Z.json`) showed and the
 * source that makes it so.
 */
export const pins = {
  image: { host: "expo.modules.image.ExpoImageViewWrapper", ios: { host: "ExpoImage.ImageView" } },
  // `ExpoBlurView` (the component) is a container `View` (it takes children) holding the library's `ExpoBlurView` (an `ExpoView`, whose `BlurEffectView` is a `UIVisualEffectView`): the section's handle names
  // the container, and the library's view is below it, read by its Swift name (the module-qualified `ExpoBlur.ExpoBlurView` is what `NSStringFromClass` would say of a handle's own view).
  blur: { inside: "ExpoBlurView", ios: { inside: "ExpoBlurView" } },
  // The library's own blur: `BlurView` is a container `View` (the handle) with `SvelteBlurView` behind its children (Android: `expo.modules.svelteblur.SvelteBlurView`, an `ExpoView`; iOS: the Swift class
  // `SvelteBlurView`, an `ExpoView` whose first subview is the `UIVisualEffectView`), read below the container by its simple name. The iOS spelling is from the Swift source (`String(describing:)` has no
  // module), not from a phone's tree yet: `qa/test/ios-foreign-pins.test.ts` lists the library as unrecorded until the first iPhone run puts its tree into `samples/ios-foreign-trees.json`.
  svelteblur: { inside: "SvelteBlurView", ios: { inside: "SvelteBlurView" } },
  gradient: { inside: "LinearGradientView", ios: { inside: "LinearGradientView" } },
  // A Paper view manager: React Native's interop component view holds `RCTVideo`.
  video: { host: "com.brentvatne.exoplayer.ReactExoplayerView", ios: { host: "RCTLegacyViewManagerInteropComponentView", inside: "RCTVideo" } },
  // The Android picker is a dialog, so nothing is mounted there and `mounts` runs on iOS only; the Fabric component view holds a `UIDatePicker` (`RNDateTimePicker`).
  datetime: { host: "", ios: { host: "RNDateTimePickerComponentView" } },
  // A Fabric component view (`LottieAnimationViewComponentView`) holding lottie-ios's container, which the Swift source names `ContainerView` and exports as `LottieContainerView`.
  lottie: { host: "com.airbnb.lottie.LottieAnimationView", ios: { host: "LottieAnimationViewComponentView", inside: "ContainerView" } },
  // A Fabric component view of its own (`RNPDFPdfView : RCTViewComponentView`, not the interop view) holding PDFKit's `PDFView`.
  pdf: { host: "org.wonday.pdf.PdfView", ios: { host: "RNPDFPdfView", inside: "PDFView" } },
  // react-native-view-shot has no view: `ViewShot` is a React Native `View`, and the library's iOS code is a module that draws one.
  capture: { host: "expo.modules.svelteengine.views.EngineView", ios: { host: "RCTViewComponentView" } },
  rive: { host: "com.rivereactnative.RiveReactNativeView", ios: { host: "RCTLegacyViewManagerInteropComponentView", inside: "RiveReactNativeView" } },
  // `ConicGradientView` is a SwiftUI struct, not a `UIView`: expo-modules-core mounts it in `ExpoSwiftUI.HostingView<Props, ContentView>`, named with its arguments.
  conic: { inside: "ConicGradientView", ios: { inside: "HostingView<ConicGradientProps, ConicGradientView>" } },
  // react-native-fast-shadow has no iOS code: `ShadowedView` is React Native's `View` and `shadowStyle` writes the layer's own shadow props. The view is the card, the first
  // `RCTViewComponentView` below the section's box (the box itself is the section's frame and has a border of its own).
  shadow: { inside: "FastShadowView", ios: { inside: "RCTViewComponentView" } },
  text: { host: "com.facebook.react.views.text.ReactTextView", ios: { host: "JBAnimatedTextComponentView" } },
  svg: { host: "com.horcrux.svg.SvgView", ios: { host: "RNSVGSvgView" } },
} as const satisfies Record<string, Pinned>;
