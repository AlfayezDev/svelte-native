import type { ExpoConfig } from "expo/config";
import { createRequire } from "node:module";
import { productApplicationId, qaApplicationId, smokeApplicationId } from "./src/lib/native/app-ids.ts";

// Three apps come out of this file. The product (`APP_VARIANT=production`, `io.example.sveltenative.qaproduct`); the QA app (no variant, `io.example.svelteqa`),
// which every gate of qa/gates.json measures and so carries exactly the product's native modules; and the smoke app
// (`APP_VARIANT=smoke`, `io.example.svelteqa.smoke`), the QA app plus the production app's native libraries for the native module
// smoke test (qa/smoke-modules.json; SPEC.md, "Native modules (smoke test)"). `smokeOnlyPackages` are the libraries the product does not
// have: the product and the QA app exclude them from both autolinkers (and from React Native's, in react-native.config.js); only the
// smoke app links them, and only it gets the config plugins in `smokePlugins`, the fake Firebase files and the Huawei repository.
// The packages the library carries itself (`packages/expo-svelte/vendor/`: react-native-quick-crypto and react-native-quick-base64, which the device's `crypto` is made of, react-native-mmkv and
// react-native-nitro-modules, and hermes-intl) are not in that list: no app lists them, the library's autolinking links its copies in every app, and the smoke test still checks them (`shared` in
// smoke-modules.json). The production app's `["react-native-quick-crypto", { sodiumEnabled: true }]` is the library plugin's own `sodiumEnabled` option, set in the smoke variant below.
const { smokeOnlyPackages } = createRequire(import.meta.url)("./qa/smoke-packages.cjs") as { smokeOnlyPackages: string[] };
// The library's default variant (no `APP_VARIANT`) is `app`; this app's is `qa`, whose route table the library's plugin writes (`routes.qa.ts`, as Metro's config does).
const variant = process.env.APP_VARIANT || "qa";
const production = process.env.APP_VARIANT === "production";
const smoke = process.env.APP_VARIANT === "smoke";
const applicationId = production ? productApplicationId : smoke ? smokeApplicationId : qaApplicationId;
// A clearly fake Firebase app for `io.example.svelteqa.smoke` (no key in it is real); the smoke test only loads Firebase and makes offline calls.
const fakeFirebase = { android: "./qa/firebase-fake/google-services.json", ios: "./qa/firebase-fake/GoogleService-Info.plist" };
const smokePlugins: NonNullable<ExpoConfig["plugins"]> = !smoke ? [] : [
  // The production app's plugins and options (its app.config.ts), minus what needs its secrets: Sentry's plugin only adds the source map
  // upload step, so it is left out; the Huawei plugin needs a real agconnect-services.json (the HMS library is only loaded).
  "@react-native-firebase/app",
  "@react-native-firebase/messaging",
  ["expo-check-installed-apps", { android: ["com.android.vending", "com.huawei.appmarket"] }],
  ["expo-location", { locationWhenInUsePermission: "The native module smoke test only reads the permission state.", isAndroidForegroundServiceEnabled: false }],
  ["expo-tracking-transparency", { userTrackingPermission: "The native module smoke test only reads the permission state." }],
  // Dummy keys, and no native initialization at launch: the smoke test calls Intercom itself.
  ["@intercom/intercom-react-native", { appId: "smoke0000", androidApiKey: "android_sdk-0000000000000000000000000000000000000000", iosApiKey: "ios_sdk-0000000000000000000000000000000000000000", useManualInit: true }],
  "expo-screen-orientation",
  "expo-sharing",
  "expo-web-browser",
  // Before `expo-notifications` and Adjust (mods run last-listed first): takes out the push entitlement and the StoreKit link they add, which
  // the Personal Team that signs the QA iPhone's builds cannot sign.
  "./qa/smoke-personal-team.cjs",
  "expo-notifications",
  "@config-plugins/react-native-adjust",
  ["react-native-live-direction", { locales: ["ar", "en"] }],
  // Firebase's iOS pods build as static frameworks (RNFirebase's requirement; the production app does the same). The HMS library resolves
  // `com.huawei.hms:location` from Huawei's repository, which only the production app's Huawei plugin (not used here) adds to the project.
  ["expo-build-properties", { ios: { useFrameworks: "static" }, android: { extraMavenRepos: [{ url: "https://developer.huawei.com/repo/" }] } }],
];
// The library's own native modules (the engine, the updates module and the four iOS modules) are not local modules: they come from `node_modules/expo-svelte`, which
// links them with its `expo-module.config.json`, and the product ships all of them. Local Expo modules (directories of `modules/`) that exist for the QA lab and must not ship: the in-app touch injector (Android), the QA
// inspection and gesture trace module (iOS) and the view-creation bench (Android). The product build leaves them out of autolinking
// (the expo-svelte plugin writes the names into settings.gradle and the Podfile), so their classes are not compiled into the app.
// `qa/test/product-modules.test.ts` resolves the module list with this exclusion.
const qaOnlyModules = ["svelte-qa-android", "svelte-qa-ios", "view-bench"];
// What the expo-svelte plugin leaves out of both autolinkers, one list for both reasons: the product has neither the smoke test's libraries
// nor the QA modules; the QA app has the QA modules but not the libraries; the smoke app is the QA app plus the libraries, so it excludes none
// of them (its QA modules stay). `qa/test/product-modules.test.ts` and `qa/test/smoke.test.ts` resolve the module list with this.
const autolinkingExclude = smoke ? [] : production ? [...smokeOnlyPackages, ...qaOnlyModules] : smokeOnlyPackages;
// The EAS Update channel of this build comes from its build profile (`UPDATES_CHANNEL` in eas.json). `eas update` and local builds
// evaluate this file without it: they publish and run without a channel, and the app does not check for updates.
const channel = process.env.UPDATES_CHANNEL;
// The SvelteKit server the app's remote functions (`*.remote.ts`) call, which the runtime reads from the config embedded in the build
// (`extra.expoSvelte.remote`; packages/expo-svelte/README.md, "Remote functions"). The build has none unless the environment names
// one, and then a remote function throws when it is called. The shell or a build profile (eas.json `env`) sets it: the QA app points at a
// development server with `EXPO_SVELTE_REMOTE_ORIGIN=http://localhost:3000` (an Android device reaches the PC through
// `adb reverse tcp:3000 tcp:3000`), and an `http:` origin also lets the build use plain HTTP to that host. The product takes `https:` only.
const remoteOrigin = process.env.EXPO_SVELTE_REMOTE_ORIGIN;
if (production && remoteOrigin && !remoteOrigin.startsWith("https://")) throw new Error(`EXPO_SVELTE_REMOTE_ORIGIN must be an https: origin in the production app, not ${remoteOrigin}`);
const remote = remoteOrigin ? { origin: remoteOrigin, ...(process.env.EXPO_SVELTE_REMOTE_BASE ? { base: process.env.EXPO_SVELTE_REMOTE_BASE } : {}) } : undefined;
export default {
  name: production ? "Svelte QA product" : smoke ? "Svelte smoke" : "Example Svelte QA",
  owner: "alfayez",
  slug: "example",
  scheme: production ? "svelte-qa-product" : smoke ? "example-svelte-smoke" : "example-svelte",
  version: "0.1.0",
  // Updates apply only to builds with the same native code; the app version stands for it, so bump `version` with any native change.
  runtimeVersion: { policy: "appVersion" },
  orientation: "default",
  userInterfaceStyle: "automatic",
  icon: "./assets/native/images/icon.png",
  ios: {
    bundleIdentifier: applicationId,
    supportsTablet: true,
    config: { usesNonExemptEncryption: false },
    ...(smoke ? { googleServicesFile: fakeFirebase.ios } : {}),
    // Let ProMotion iPhones run above 60 Hz; the iPhone SE used for QA is a 60 Hz panel regardless.
    infoPlist: { CADisableMinimumFrameDurationOnPhone: true },
  },
  android: {
    package: applicationId,
    predictiveBackGestureEnabled: true,
    ...(smoke ? { googleServicesFile: fakeFirebase.android } : {}),
    adaptiveIcon: {
      backgroundColor: "#f6f6f7",
      foregroundImage: "./assets/native/images/adaptive-foreground.png",
      monochromeImage: "./assets/native/images/adaptive-monochrome.png",
    },
  },
  plugins: [
    ["expo-svelte", {
      variant,
      androidProfileable: !production,
      // libsodium for `crypto`, as the production app has it (the option quick-crypto's own plugin took; the smoke test's quick-crypto check runs against it).
      ...(smoke ? { sodiumEnabled: true } : {}),
      autolinkingExclude,
      ...(remote ? { remote } : {}),
      androidFeatureFlags: { disableViewPreallocationAndroid: true, enablePreparedTextLayout: true },
      // The optional native view libraries the library carries (packages/expo-svelte/vendor/): the foreign lab exercises every one of them, so the QA app turns them all on (the app's package.json lists none).
      // The Maps SDK throws when the manifest has no key. Production builds take theirs from the environment (an EAS secret); the QA variant falls back to a placeholder, which mounts the map and loads no tiles.
      libraries: {
        "expo-image": true,
        "expo-blur": true,
        "expo-linear-gradient": true,
        "expo-conic-gradient": true,
        "expo-video": true,
        "react-native-video": true,
        "lottie-react-native": true,
        "rive-react-native": true,
        "@react-native-community/datetimepicker": true,
        "react-native-pdf": true,
        "react-native-webview": true,
        "react-native-maps": { androidGoogleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY ?? (production ? undefined : "svelte-qa-placeholder-key") },
        "react-native-view-shot": true,
        "react-native-fast-shadow": true,
        "react-native-animateable-text": true,
      },
      // Foreign views (SPEC.md, "Foreign views"): the packages' view managers are created when a component is first mounted,
      // not when the host starts. `packages/expo-svelte/tests/upstream/foreign-view-configs.test.ts` checks the names against the packages' sources.
      androidOnDemandViewManagers: {
        "com.rnmaps.maps.MapsPackage": ["RNMapsMapView", "RNMapsMarker", "RNMapsCallout", "RNMapsGooglePolygon", "RNMapsPolyline", "RNMapsCircle", "RNMapsOverlay", "RNMapsUrlTile", "RNMapsWMSTile"],
        "com.reactnativecommunity.webview.RNCWebViewPackage": ["RNCWebView"],
        // react-native-video builds its `VideoManager` module with createNativeModules: the wrapper for such packages keeps it.
        "com.brentvatne.react.ReactVideoPackage": ["RCTVideo"],
        "com.airbnb.android.react.lottie.LottiePackage": ["LottieAnimationView"],
        // Four more legacy packages (view managers made with `createViewManagers`; Rive's modules stay with it): the PDF view, Rive, the Android shadow and the animateable text.
        "org.wonday.pdf.RNPDFPackage": ["RNPDFPdfView"],
        "com.rivereactnative.RiveReactNativePackage": ["RiveReactNativeView"],
        "com.reactnativefastshadow.FastShadowPackage": ["FastShadowView"],
        "com.reactnativereanimatedtext.ReanimatedTextPackage": ["JBAnimatedText"],
        // react-native-svg: a `BaseReactPackage` (its TurboModules, `RNSVGRenderableModule` and `RNSVGSvgViewModule`, stay with it) that announces all 29 view managers at start unless wrapped.
        "com.horcrux.svg.SvgPackage": ["RNSVGSvgViewAndroid", "RNSVGGroup", "RNSVGPath", "RNSVGText", "RNSVGTSpan", "RNSVGTextPath", "RNSVGImage", "RNSVGCircle", "RNSVGEllipse", "RNSVGLine", "RNSVGRect", "RNSVGClipPath", "RNSVGDefs", "RNSVGUse", "RNSVGSymbol", "RNSVGPattern", "RNSVGMask", "RNSVGForeignObject", "RNSVGMarker", "RNSVGLinearGradient", "RNSVGRadialGradient", "RNSVGFilter", "RNSVGFeBlend", "RNSVGFeColorMatrix", "RNSVGFeComposite", "RNSVGFeFlood", "RNSVGFeGaussianBlur", "RNSVGFeMerge", "RNSVGFeOffset"],
        // Gestures (SPEC.md, "Gestures"): the package's module (RNGestureHandlerModule) is served as before; its three view managers (the root view, the button
        // and, since 3.x, the detector) are for React Native's own mounting, which the engine does not use.
        "com.swmansion.gesturehandler.RNGestureHandlerPackage": ["RNGestureHandlerRootView", "RNGestureHandlerButton", "RNGestureHandlerDetector"],
      },
    }],
    "expo-secure-store",
    "expo-image-picker",
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
  // Read by the library's `svelte-updates` module from AndroidManifest.xml / Expo.plist; Expo's own config plugin writes them.
  updates: {
    url: "https://u.expo.dev/bb048172-896f-48f1-97c0-c9ec765842c0",
    checkAutomatically: channel ? "ON_LOAD" : "NEVER",
    fallbackToCacheTimeout: 0,
    ...(channel ? { requestHeaders: { "expo-channel-name": channel } } : {}),
  },
  extra: { eas: { projectId: "bb048172-896f-48f1-97c0-c9ec765842c0" } },
} satisfies ExpoConfig;
