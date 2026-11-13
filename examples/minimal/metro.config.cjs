const { getDefaultConfig } = require("expo/metro-config");
const { withSvelteNative } = require("@alfayez/svelte-native/metro");

module.exports = withSvelteNative(getDefaultConfig(__dirname));
