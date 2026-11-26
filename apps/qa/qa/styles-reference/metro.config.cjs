// A plain React Native app's Metro config (Expo's defaults), for the reference of the box styles lab: `apps/qa/metro.config.cjs` is the Svelte app's (`withExpoSvelte`).
const { getDefaultConfig } = require("expo/metro-config");

module.exports = getDefaultConfig(__dirname);
