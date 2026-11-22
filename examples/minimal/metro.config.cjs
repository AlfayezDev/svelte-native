const { getDefaultConfig } = require("expo/metro-config");
const { withExpoSvelte } = require("expo-svelte/metro");

module.exports = withExpoSvelte(getDefaultConfig(__dirname));
