import type { Feature } from "./feature.ts";

/** The features that show native views, motion and touch. Add one here and a folder of the same name under `src/routes`. */
export const nativeFeatures: Feature[] = [
  // Native views: the library's wrappers of other native libraries, one screen each (`expo-svelte/foreign`, and the SVG components of `expo-svelte`), and `ExpoView` for an Expo library with none.
  { group: "Native views", route: "/native-views/image", title: "Image (expo-image)", summary: "Fit, blurhash placeholder and fade-in" },
  { group: "Native views", route: "/native-views/blur", title: "Blur", summary: "The built-in BlurView: blur whatever is behind a view" },
  { group: "Native views", route: "/native-views/linear-gradient", title: "Linear gradient", summary: "expo-linear-gradient: colours, direction, children" },
  { group: "Native views", route: "/native-views/conic-gradient", title: "Conic gradient", summary: "expo-conic-gradient: a colour wheel with an angle" },
  { group: "Native views", route: "/native-views/video", title: "Video (react-native-video)", summary: "Play, pause and seek a bundled clip" },
  { group: "Native views", route: "/native-views/lottie", title: "Lottie", summary: "Play an animation from a JSON file" },
  { group: "Native views", route: "/native-views/pdf", title: "PDF (react-native-pdf)", summary: "Show a document and turn its pages" },
  { group: "Native views", route: "/native-views/svg", title: "SVG (react-native-svg)", summary: "Shapes, gradients, text, an animated circle" },
  { group: "Native views", route: "/native-views/rive", title: "Rive", summary: "Play a Rive file from the network" },
  { group: "Native views", route: "/native-views/shadow", title: "Shadow (fast-shadow)", summary: "The same soft shadow on both platforms" },
  { group: "Native views", route: "/native-views/animateable-text", title: "Animateable text", summary: "A number that counts on the UI thread" },
  { group: "Native views", route: "/native-views/view-shot", title: "View capture (view-shot)", summary: "Turn a view into a picture" },
  { group: "Native views", route: "/native-views/date-time-picker", title: "Date and time picker", summary: "A native view on iOS, a dialog on Android" },
  { group: "Native views", route: "/native-views/web-view", title: "WebView", summary: "A web page with messages both ways" },
  { group: "Native views", route: "/native-views/map", title: "Map (react-native-maps)", summary: "A map, markers and camera moves" },
  { group: "Native views", route: "/native-views/any-expo-view", title: "Any Expo view", summary: "An Expo library with no wrapper, by name" },

  // Motion and touch
  { group: "Motion and touch", route: "/animation", title: "Animation", summary: "Fade, spring, loop and state-driven motion on the UI thread" },
  { group: "Motion and touch", route: "/animation/transitions", title: "Transitions", summary: "Svelte's in:, out:, transition: and animate:flip, on the UI thread" },
  { group: "Motion and touch", route: "/gestures", title: "Gestures", summary: "Drag, pinch and rotate, swipe a row, long press" },

  // Platform
  { group: "Platform", route: "/remote", title: "Remote functions", summary: "Call SvelteKit query, command and form from a screen" },
  { group: "Platform", route: "/updates", title: "Updates", summary: "What bundle is running, and checking for a new one" },
];
