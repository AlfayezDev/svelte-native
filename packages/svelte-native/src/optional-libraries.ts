/**
 * The optional native view libraries the package carries (`vendor/<name>/`, VENDORING.md "Optional libraries"): what an app turns on with the plugin's `libraries` option
 * (`libraries.ts`) and what stays out of the app without it, on iOS even out of the compile (App Store Connect scans a binary for the APIs it uses: react-native-maps references
 * CoreLocation, so every app would owe a location purpose string if it were always linked). They are `vendoredPackages` like the pilot's two, with the `optional` field that says how
 * each one links: a React Native package through the autolinking config (`vendored.ts`: the entry the command would print for the installed package) and an Expo module through
 * Expo's own autolinker, which is given the copy's directory as a search path when the app turns the library on (`libraries.ts`, "Expo modules").
 *
 * Every entry is checked against what Expo's `react-native-config` printed for the installed package on 18 November 2026 (`tests/cli/fixtures/vendored-autolinking/`).
 */
import type { VendoredPackage } from "./vendored.ts";

const react = "react-native" as const;
const expo = "expo" as const;

export const optionalLibraries: readonly VendoredPackage[] = [
  // Expo modules: found by Expo's autolinker through `expo-module.config.json`, which lists the Android class and the Swift module, so they have no `android` or `ios` entry here.
  { name: "expo-blur", version: "57.0.3", optional: { kind: expo } },
  { name: "expo-conic-gradient", version: "0.2.1", optional: { kind: expo } },
  { name: "expo-image", version: "57.0.5", optional: { kind: expo, plugin: "app.plugin.js" } },
  { name: "expo-linear-gradient", version: "57.0.2", optional: { kind: expo } },
  { name: "expo-video", version: "57.0.5", optional: { kind: expo, plugin: "app.plugin.js" } },
  // React Native packages: an entry of the autolinking config for each platform.
  {
    name: "@react-native-community/datetimepicker",
    version: "9.1.0",
    android: { packageImportPath: "import com.reactcommunity.rndatetimepicker.RNDateTimePickerPackage;", packageInstance: "new RNDateTimePickerPackage()" },
    ios: { podspec: "RNDateTimePicker.podspec" },
    optional: { kind: react, plugin: "app.plugin.js" },
  },
  {
    name: "lottie-react-native",
    version: "7.3.8",
    android: { packageImportPath: "import com.airbnb.android.react.lottie.LottiePackage;", packageInstance: "new LottiePackage()", componentDescriptors: ["LottieAnimationViewComponentDescriptor"] },
    ios: { podspec: "lottie-react-native.podspec" },
    optional: { kind: react },
  },
  {
    name: "react-native-animateable-text",
    version: "0.19.3",
    android: {
      packageImportPath: "import com.reactnativereanimatedtext.ReanimatedTextPackage;",
      packageInstance: "new ReanimatedTextPackage()",
      libraryName: "JBAnimatedText",
      componentDescriptors: ["CParagraphComponentDescriptor"],
      cmakeListsPath: "android/src/main/jni/CMakeLists.txt",
    },
    ios: { podspec: "react-native-animateable-text.podspec" },
    optional: { kind: react },
  },
  {
    name: "react-native-blob-util",
    version: "0.24.9",
    android: { packageImportPath: "import com.ReactNativeBlobUtil.ReactNativeBlobUtilPackage;", packageInstance: "new ReactNativeBlobUtilPackage()" },
    ios: { podspec: "react-native-blob-util.podspec" },
    optional: { kind: react },
  },
  {
    // No iOS code: `ShadowedView` is React Native's own `View` there (the layer's shadow), so the library has no podspec.
    name: "react-native-fast-shadow",
    version: "0.1.1",
    android: { packageImportPath: "import com.reactnativefastshadow.FastShadowPackage;", packageInstance: "new FastShadowPackage()" },
    optional: { kind: react },
  },
  {
    name: "react-native-maps",
    version: "1.27.2",
    android: {
      packageImportPath: "import com.rnmaps.maps.MapsPackage;",
      packageInstance: "new MapsPackage()",
      componentDescriptors: [
        "RNMapsCalloutComponentDescriptor",
        "RNMapsCircleComponentDescriptor",
        "RNMapsGoogleMapViewComponentDescriptor",
        "RNMapsGooglePolygonComponentDescriptor",
        "RNMapsMapViewComponentDescriptor",
        "RNMapsMarkerComponentDescriptor",
        "RNMapsOverlayComponentDescriptor",
        "RNMapsPolylineComponentDescriptor",
        "RNMapsUrlTileComponentDescriptor",
        "RNMapsWMSTileComponentDescriptor",
      ],
      cmakeListsPath: "android/src/main/jni/CMakeLists.txt",
    },
    ios: { podspec: "react-native-maps.podspec" },
    optional: { kind: react, plugin: "app.plugin.js" },
  },
  {
    // The PDF view reads its files through react-native-blob-util's native module, so turning it on turns that one on.
    name: "react-native-pdf",
    version: "7.0.3",
    android: { packageImportPath: "import org.wonday.pdf.RNPDFPackage;", packageInstance: "new RNPDFPackage()", componentDescriptors: ["RNPDFPdfViewComponentDescriptor"] },
    ios: { podspec: "react-native-pdf.podspec" },
    optional: { kind: react, requires: ["react-native-blob-util"] },
  },
  {
    name: "react-native-video",
    version: "6.19.3",
    android: { packageImportPath: "import com.brentvatne.react.ReactVideoPackage;", packageInstance: "new ReactVideoPackage()" },
    ios: { podspec: "react-native-video.podspec" },
    optional: { kind: react, plugin: "app.plugin.js" },
  },
  {
    name: "react-native-view-shot",
    version: "5.1.0",
    android: { packageImportPath: "import fr.greweb.reactnativeviewshot.RNViewShotPackage;", packageInstance: "new RNViewShotPackage()" },
    ios: { podspec: "react-native-view-shot.podspec" },
    optional: { kind: react },
  },
  {
    name: "react-native-webview",
    version: "13.16.1",
    android: { packageImportPath: "import com.reactnativecommunity.webview.RNCWebViewPackage;", packageInstance: "new RNCWebViewPackage()", componentDescriptors: ["RNCWebViewComponentDescriptor"] },
    ios: { podspec: "react-native-webview.podspec" },
    optional: { kind: react },
  },
  {
    name: "rive-react-native",
    version: "9.7.1",
    android: { packageImportPath: "import com.rivereactnative.RiveReactNativePackage;", packageInstance: "new RiveReactNativePackage()" },
    ios: { podspec: "rive-react-native.podspec" },
    optional: { kind: react },
  },
];
