import type { ExpoConfig } from "expo/config";

// The SvelteKit server the Remote functions screen calls: the library reads it at run time from `extra.expoSvelte.remote`, which the plugin's
// `remote` option writes. A build with none still runs; the screen then says there is no host. An `http:` origin is for a development server.
const remoteOrigin = process.env.EXPO_SVELTE_REMOTE_ORIGIN;

export default {
  name: "Expo Svelte",
  slug: "expo-svelte-example",
  scheme: "expo-svelte",
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
    // The library's Expo plugin: autolinks its native modules and wires the Android and iOS hosts. The location capability is `navigator.geolocation`, which the Web APIs
    // screen's device checks use: the library's own native code does the work, so nothing is installed for it; the text is what iOS shows when it asks.
    ["expo-svelte", {
      ...(remoteOrigin ? { remote: { origin: remoteOrigin } } : {}),
      capabilities: { location: "Expo Svelte reads your location for the Web APIs screen's geolocation check." },
      // The native view libraries the Native views screens use. The library carries them, and an app links only the ones it lists here: nothing is installed, and a library that is not listed
      // is not in the build at all (expo-blur and expo-video, which no screen here uses, are not). Each is `true`, or the options of the library's own config plugin.
      libraries: {
        "expo-image": true,
        "expo-linear-gradient": true,
        "expo-conic-gradient": true,
        "react-native-video": true,
        "lottie-react-native": true,
        // The PDF screen; react-native-blob-util, which it reads its files with, comes with it.
        "react-native-pdf": true,
        "rive-react-native": true,
        "react-native-fast-shadow": true,
        "react-native-animateable-text": true,
        "react-native-view-shot": true,
        "@react-native-community/datetimepicker": true,
        "react-native-webview": true,
        // The Map screen: Android's Maps SDK needs a key in the manifest. Set GOOGLE_MAPS_API_KEY for a build that draws tiles; the placeholder only mounts the map.
        "react-native-maps": { androidGoogleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY ?? "expo-svelte-example-placeholder-key" },
      },
    }],
    // Embeds the font files in the app, so `fontFamily: "JetBrainsMono-Regular"` works without loading code (the text screen).
    ["expo-font", { fonts: ["./assets/fonts/JetBrainsMono-Regular.ttf"] }],
    // The Any Expo view screen shows expo-camera's preview and takes a picture: the camera permission and its prompt text. It records no video, so no microphone.
    ["expo-camera", { cameraPermission: "Expo Svelte shows the camera preview on the Any Expo view screen.", microphonePermission: false, recordAudioAndroid: false }],
  ],
} satisfies ExpoConfig;
