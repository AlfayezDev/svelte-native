const { getDefaultConfig } = require("expo/metro-config");
const { withExpoSvelte } = require("expo-svelte/metro");

// `css`: the classes of src/global.css (Tailwind's and the app's own) as React Native styles, for `class` (the Classes screen).
module.exports = withExpoSvelte(getDefaultConfig(__dirname), { css: "src/global.css" });
