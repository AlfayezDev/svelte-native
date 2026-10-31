import type { ExpoConfig } from "expo/config";
import { createRequire } from "node:module";

// The native module smoke test (qa/smoke-modules.json; SPEC.md, "Native modules (smoke test)") links the production app's native
// libraries into the QA app only. `qaOnlyPackages` are the ones the product does not have: it excludes them from both autolinkers
// below (and from React Native's in react-native.config.js), and none of the config plugins in `smokePlugins` runs for it.
const { qaOnlyPackages } = createRequire(import.meta.url)("./qa/smoke-packages.cjs") as { qaOnlyPackages: string[] };
const production = process.env.APP_VARIANT === "production";
// A clearly fake Firebase app for `io.rasheed.svelteqa` (no key in it is real); the smoke test only loads Firebase and makes offline calls.
const fakeFirebase = { android: "./qa/firebase-fake/google-services.json", ios: "./qa/firebase-fake/GoogleService-Info.plist" };
const smokePlugins: NonNullable<ExpoConfig["plugins"]> = production ? [] : [
  // The production app's plugins and options (its app.config.ts), minus what needs its secrets: Sentry's plugin only adds the source map
  // upload step, so it is left out; the Huawei plugin needs a real agconnect-services.json (the HMS library is only loaded).
  "@react-native-firebase/app",
  "@react-native-firebase/messaging",
  ["react-native-quick-crypto", { sodiumEnabled: true }],
  ["expo-check-installed-apps", { android: ["com.android.vending", "com.huawei.appmarket"] }],
  ["expo-location", { locationWhenInUsePermission: "The native module smoke test only reads the permission state.", isAndroidForegroundServiceEnabled: false }],
  ["expo-tracking-transparency", { userTrackingPermission: "The native module smoke test only reads the permission state." }],
  // Dummy keys, and no native initialization at launch: the smoke test calls Intercom itself.
  ["@intercom/intercom-react-native", { appId: "smoke0000", androidApiKey: "android_sdk-0000000000000000000000000000000000000000", iosApiKey: "ios_sdk-0000000000000000000000000000000000000000", useManualInit: true }],
  "expo-screen-orientation",
  "expo-sharing",
  "expo-web-browser",
  "expo-notifications",
  "@config-plugins/react-native-adjust",
  ["expo-samsung-pay", { aarPath: "./libs/samsungpay.jar" }],
  ["react-native-live-direction", { locales: ["ar", "en"] }],
  // Firebase's iOS pods build as static frameworks (RNFirebase's requirement; the production app does the same). The HMS library resolves
  // `com.huawei.hms:location` from Huawei's repository, which only the production app's Huawei plugin (not used here) adds to the project.
  ["expo-build-properties", { ios: { useFrameworks: "static" }, android: { extraMavenRepos: [{ url: "https://developer.huawei.com/repo/" }] } }],
];
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
    ...(production ? {} : { googleServicesFile: fakeFirebase.ios }),
    // Let ProMotion iPhones run above 60 Hz; the iPhone SE used for QA is a 60 Hz panel regardless.
    infoPlist: { CADisableMinimumFrameDurationOnPhone: true },
  },
  android: {
    package: production ? "io.rasheed.app" : "io.rasheed.svelteqa",
    predictiveBackGestureEnabled: true,
    ...(production ? {} : { googleServicesFile: fakeFirebase.android }),
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
      autolinkingExclude: production ? qaOnlyPackages : [],
      androidOnDemandViewManagers: {
        "com.rnmaps.maps.MapsPackage": ["RNMapsMapView", "RNMapsMarker", "RNMapsCallout", "RNMapsGooglePolygon", "RNMapsPolyline", "RNMapsCircle", "RNMapsOverlay", "RNMapsUrlTile", "RNMapsWMSTile"],
        "com.reactnativecommunity.webview.RNCWebViewPackage": ["RNCWebView"],
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
    ...smokePlugins,
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
