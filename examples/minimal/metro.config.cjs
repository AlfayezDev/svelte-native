const { getDefaultConfig } = require("expo/metro-config");
const { withSvelteNative } = require("@rasheed/svelte-native/metro");

module.exports = withSvelteNative(getDefaultConfig(__dirname));
