/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS is the point: this is how Metro loads the library */
// A native-only app's Metro config (tests/package/node-modules.test.ts): no SvelteKit, no Vite, no variant. The packages are linked from this repository's install, which
// is not under the app's directory, so Metro is told to read it (`EXPO_SVELTE_TEST_PACKAGES`): a real install has them below the app.
const { getDefaultConfig } = require("expo/metro-config");
const { withExpoSvelte } = require("expo-svelte/metro");

const config = getDefaultConfig(__dirname);
if (process.env.EXPO_SVELTE_TEST_PACKAGES) config.watchFolders = [...(config.watchFolders ?? []), process.env.EXPO_SVELTE_TEST_PACKAGES];
module.exports = withExpoSvelte(config);
