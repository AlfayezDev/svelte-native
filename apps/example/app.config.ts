import type { ExpoConfig } from "expo/config";

const production = process.env.APP_VARIANT === "production";
// The EAS Update channel of this build comes from its build profile (`UPDATES_CHANNEL` in eas.json). `eas update` and local builds
// evaluate this file without it: they publish and run without a channel, and the app does not check for updates.
const channel = process.env.UPDATES_CHANNEL;
export default {
  name: production ? "Rasheed" : "Rasheed Svelte QA",
  owner: "alfayez",
  slug: "rasheed",
  scheme: production ? "rasheed" : "rasheed-svelte",
  version: "0.1.0",
  // Updates apply only to builds with the same native code; the app version stands for it, so bump `version` with any native change.
  runtimeVersion: { policy: "appVersion" },
  orientation: "default",
  userInterfaceStyle: "automatic",
  icon: "./assets/native/images/icon.png",
  ios: {
    bundleIdentifier: production ? "io.rasheed.app" : "io.rasheed.svelteqa",
    supportsTablet: true,
    config: { usesNonExemptEncryption: false },
    // Let ProMotion iPhones run above 60 Hz; the iPhone SE used for QA is a 60 Hz panel regardless.
    infoPlist: { CADisableMinimumFrameDurationOnPhone: true },
  },
  android: {
    package: production ? "io.rasheed.app" : "io.rasheed.svelteqa",
    predictiveBackGestureEnabled: true,
    adaptiveIcon: {
      backgroundColor: "#f6f6f7",
      foregroundImage: "./assets/native/images/adaptive-foreground.png",
      monochromeImage: "./assets/native/images/adaptive-monochrome.png",
    },
  },
  plugins: [
    ["@rasheed/svelte-native/expo", {
      androidProfileable: !production,
      androidFeatureFlags: { disableViewPreallocationAndroid: true, enablePreparedTextLayout: true },
      // Foreign views (SPEC.md, "Foreign views"): the packages' view managers are created when a component is first mounted,
      // not when the host starts. `packages/svelte-native/tests/foreign.test.ts` checks the names against the packages' sources.
      androidOnDemandViewManagers: {
        "com.rnmaps.maps.MapsPackage": ["RNMapsMapView", "RNMapsMarker", "RNMapsCallout", "RNMapsGooglePolygon", "RNMapsPolyline", "RNMapsCircle", "RNMapsOverlay", "RNMapsUrlTile", "RNMapsWMSTile"],
        "com.reactnativecommunity.webview.RNCWebViewPackage": ["RNCWebView"],
        // Gestures (SPEC.md, "Gestures"): the package's module (RNGestureHandlerModule) is served as before; its two view managers
        // are for React Native's own mounting, which the engine does not use.
        "com.swmansion.gesturehandler.RNGestureHandlerPackage": ["RNGestureHandlerRootView", "RNGestureHandlerButton"],
      },
    }],
    "expo-secure-store",
    "expo-image-picker",
    // The Maps SDK throws when the manifest has no key. Production builds take theirs from the environment (an EAS secret); the QA variant
    // falls back to a placeholder, which mounts the map and loads no tiles.
    ["react-native-maps", { androidGoogleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY ?? (production ? undefined : "svelte-qa-placeholder-key") }],
    ["expo-splash-screen", {
      backgroundColor: "#f6f6f7", image: "./assets/native/images/splash-mark.png", imageWidth: 96,
      dark: { backgroundColor: "#0d0d0f", image: "./assets/native/images/splash-mark-dark.png" },
    }],
    ["expo-localization", { supportedLocales: { ios: ["en", "ar"], android: ["en", "ar"] } }],
    ["expo-font", { fonts: [
      "./assets/native/fonts/IBMPlexSansArabic-Regular.ttf",
      "./assets/native/fonts/IBMPlexSansArabic-Medium.ttf",
      "./assets/native/fonts/IBMPlexSansArabic-SemiBold.ttf",
      "./assets/native/fonts/JetBrainsMono-Regular.ttf",
    ] }],
  ],
  ...(production ? { locales: { en: "./locales/en.json", ar: "./locales/ar.json" } } : {}),
  // Read by the `svelte-updates` module from AndroidManifest.xml / Expo.plist; Expo's own config plugin writes them.
  updates: {
    url: "https://u.expo.dev/bb048172-896f-48f1-97c0-c9ec765842c0",
    checkAutomatically: channel ? "ON_LOAD" : "NEVER",
    fallbackToCacheTimeout: 0,
    ...(channel ? { requestHeaders: { "expo-channel-name": channel } } : {}),
  },
  extra: { eas: { projectId: "bb048172-896f-48f1-97c0-c9ec765842c0" } },
} satisfies ExpoConfig;
