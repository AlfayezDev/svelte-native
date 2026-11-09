import type { ExpoConfig } from "expo/config";

export default {
  name: "Svelte Native",
  slug: "svelte-native-example",
  scheme: "svelte-native",
  version: "1.0.0",
  orientation: "portrait",
  userInterfaceStyle: "automatic",
  icon: "./assets/images/icon.png",
  ios: {
    bundleIdentifier: "io.example.sveltenative.example",
    supportsTablet: false,
    config: { usesNonExemptEncryption: false },
  },
  android: {
    package: "io.example.sveltenative.example",
    predictiveBackGestureEnabled: true,
    adaptiveIcon: {
      backgroundColor: "#e5372b",
      foregroundImage: "./assets/images/adaptive-foreground.png",
    },
  },
  plugins: [
    // The library's Expo plugin: autolinks its native modules and wires the Android and iOS hosts.
    "@example/svelte-native/expo",
    // The Map screen: Android's Maps SDK needs a key in the manifest. Set GOOGLE_MAPS_API_KEY for a build that draws tiles; the placeholder only mounts the map.
    ["react-native-maps", { androidGoogleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY ?? "svelte-native-example-placeholder-key" }],
    // Embeds the font files in the app, so `fontFamily: "JetBrainsMono-Regular"` works without loading code (the text screen).
    ["expo-font", { fonts: ["./assets/fonts/JetBrainsMono-Regular.ttf"] }],
  ],
} satisfies ExpoConfig;
