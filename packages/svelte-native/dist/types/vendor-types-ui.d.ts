// The vendored UI packages (`vendor/`, VENDORING.md: gesture handler, Reanimated, Worklets and svg) name each other, and are named by libraries of the app, as npm packages: Reanimated's declarations import the
// Worklets types and svg's, which an app does not install. These ambient modules answer to those names with the copies' declarations (the library's `imports` map, `#vendor/<name>`), for an
// app's type check and this repository's alike. They are in a file of their own, apart from `vendor-types.d.ts`, because loading it loads the declarations of all four (hundreds of files):
// only what already names Reanimated, Worklets or svg references it (`animation.ts`, `svg.ts`), and the primitives alone (`/core`) do not (`publicAmbient` in scripts/build-types.ts).
declare module "react-native-worklets" {
  export * from "#vendor/react-native-worklets";
}
declare module "react-native-reanimated" {
  export * from "#vendor/react-native-reanimated";
  export { default } from "#vendor/react-native-reanimated";
}
declare module "react-native-svg" {
  export * from "#vendor/react-native-svg";
  export { default } from "#vendor/react-native-svg";
}
declare module "react-native-gesture-handler" {
  export * from "#vendor/react-native-gesture-handler";
}
