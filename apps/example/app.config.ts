import type { ExpoConfig } from "expo/config";

const production = process.env.APP_VARIANT === "production";
export default {
  name: production ? "Rasheed" : "Rasheed Svelte QA",
  owner: "alfayez",
  slug: "rasheed",
  scheme: production ? "rasheed" : "rasheed-svelte",
  version: "0.1.0",
  orientation: "default",
  userInterfaceStyle: "automatic",
  icon: "./assets/native/images/icon.png",
  ios: {
    bundleIdentifier: production ? "io.rasheed.app" : "io.rasheed.svelteqa",
    supportsTablet: true,
    config: { usesNonExemptEncryption: false },
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
  ],
  ...(production ? { locales: { en: "./locales/en.json", ar: "./locales/ar.json" } } : {}),
  extra: { eas: { projectId: "bb048172-896f-48f1-97c0-c9ec765842c0" } },
} satisfies ExpoConfig;
