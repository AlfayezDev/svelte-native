const { getDefaultConfig } = require("expo/metro-config");
const { withSvelteNative } = require("@rasheed/svelte-native/metro");

// `uniwind`: Tailwind classes through Uniwind, compiled from src/global.css (the Classes screen).
module.exports = withSvelteNative(getDefaultConfig(__dirname), { uniwind: { cssEntryFile: "./src/global.css" } });
