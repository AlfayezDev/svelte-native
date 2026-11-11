const { getDefaultConfig } = require("expo/metro-config");
const { withSvelteNative } = require("@rasheed/svelte-native/metro");

// `css`: the classes of src/global.css (Tailwind's and the app's own) as React Native styles, for `class` (the Classes screen).
module.exports = withSvelteNative(getDefaultConfig(__dirname), { css: "src/global.css" });
