import type { Feature } from "./feature.ts";

/** The features that show native views, motion and touch. Add one here and a folder of the same name under `src/routes`. */
export const nativeFeatures: Feature[] = [
  // Native views: the library's wrappers of other native libraries, one screen each (`@rasheed/svelte-native/foreign` and `/svg`).
  { group: "Native views", route: "/native-views/image", title: "Image (expo-image)", summary: "Fit, blurhash placeholder and fade-in" },
  { group: "Native views", route: "/native-views/blur", title: "Blur (expo-blur)", summary: "Blur the content behind a view" },
  { group: "Native views", route: "/native-views/linear-gradient", title: "Linear gradient", summary: "expo-linear-gradient: colours, direction, children" },
  { group: "Native views", route: "/native-views/conic-gradient", title: "Conic gradient", summary: "expo-conic-gradient: a colour wheel with an angle" },
  { group: "Native views", route: "/native-views/video", title: "Video (react-native-video)", summary: "Play, pause and seek a bundled clip" },
  { group: "Native views", route: "/native-views/lottie", title: "Lottie", summary: "Play an animation from a JSON file" },
  { group: "Native views", route: "/native-views/pdf", title: "PDF (react-native-pdf)", summary: "Show a document and turn its pages" },
];
