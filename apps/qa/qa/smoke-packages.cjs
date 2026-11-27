// The packages only the smoke app links. `smoke-modules.json` lists every module the smoke test calls; those the product has too
// (`shared`: secure store, localization, constants, asset, system UI, splash screen, and the four the library carries itself, react-native-quick-crypto, react-native-quick-base64,
// react-native-mmkv and react-native-nitro-modules, which are in no package.json; every app links and bundles them, the smoke test still checks them) and pure JavaScript ones
// (`link: "js"`) stay.
// Read by app.config.ts (autolinking excludes and config plugins) and react-native.config.js (React Native community autolinking).
const { modules } = require("./smoke-modules.json");

const smokeOnlyPackages = [...new Set(modules.filter((entry) => !entry.shared && entry.link !== "js").flatMap((entry) => entry.packages))];

/**
 * The packages the product and the QA app's JavaScript bundles must not carry: the ones above, and the JavaScript-only ones (Statsig:
 * no native code to leave out of autolinking, but 87 modules of its own and the whole `react-native` index its imports reach).
 * Metro resolves them to a stub (metro.config.cjs).
 */
const smokeOnlyBundlePackages = [...new Set(modules.filter((entry) => !entry.shared).flatMap((entry) => entry.packages))];

/**
 * The packages the library carries itself (`packages/expo-svelte/vendor/`, VENDORING.md): the Nitro runtime and MMKV (`localStorage`), react-native-quick-crypto and the base64 module it
 * asks for (`crypto`), and gesture handler, Worklets, Reanimated and svg (the gestures, the animation and the SVG components). They are no dependency of any app here (the smoke app installs a real app's libraries as stand-ins, and these are not among them any more: the vendored copy
 * is what the smoke test calls), so the module table lists them without a package. Every app links and bundles them, the smoke test still checks them.
 */
const libraryVendoredPackages = ["react-native-mmkv", "react-native-nitro-modules", "react-native-quick-crypto", "react-native-quick-base64", "react-native-gesture-handler", "react-native-worklets", "react-native-reanimated", "react-native-svg"];

module.exports = { modules, smokeOnlyPackages, smokeOnlyBundlePackages, libraryVendoredPackages };
