const { getDefaultConfig } = require("expo/metro-config");
const { withSvelteNative } = require("@example/svelte-native/metro");

module.exports = withSvelteNative(getDefaultConfig(__dirname));
