import type { Feature } from "./feature.ts";

/** The features that show native views, motion and touch. Add one here and a folder of the same name under `src/routes`. */
export const nativeFeatures: Feature[] = [
  // Native views: the library's wrappers of other native libraries, one screen each (`@example/svelte-native/foreign` and `/svg`).
  { group: "Native views", route: "/native-views/image", title: "Image (expo-image)", summary: "Fit, blurhash placeholder and fade-in" },
  { group: "Native views", route: "/native-views/blur", title: "Blur (expo-blur)", summary: "Blur the content behind a view" },
  { group: "Native views", route: "/native-views/linear-gradient", title: "Linear gradient", summary: "expo-linear-gradient: colours, direction, children" },
  { group: "Native views", route: "/native-views/conic-gradient", title: "Conic gradient", summary: "expo-conic-gradient: a colour wheel with an angle" },
];
