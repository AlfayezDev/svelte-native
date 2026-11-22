// The vendored packages (`vendor/`, VENDORING.md) name each other as npm packages: react-native-mmkv's declarations import `HybridObject` from react-native-nitro-modules, which an app
// does not install. These ambient modules answer to those names with the copies' declarations (the library's `imports` map, `#vendor/<name>`), for an app's type check and this
// repository's alike. A declaration of the library that names a vendored type carries a reference to this file (`/// <reference path>`, `publicAmbient` in scripts/build-types.ts).
declare module "react-native-nitro-modules" {
  export * from "#vendor/react-native-nitro-modules";
}
