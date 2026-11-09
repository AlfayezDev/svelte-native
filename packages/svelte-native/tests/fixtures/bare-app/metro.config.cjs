/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS is the point: this is how Metro loads the library */
// A native-only app's Metro config (tests/node-modules.test.ts): no SvelteKit, no Vite, no variant. The packages are linked from this repository's install, which
// is not under the app's directory, so Metro is told to read it (`SVELTE_NATIVE_TEST_PACKAGES`): a real install has them below the app.
const { getDefaultConfig } = require("expo/metro-config");
const { withSvelteNative } = require("@rasheed/svelte-native/metro");

const config = getDefaultConfig(__dirname);
if (process.env.SVELTE_NATIVE_TEST_PACKAGES) config.watchFolders = [...(config.watchFolders ?? []), process.env.SVELTE_NATIVE_TEST_PACKAGES];
module.exports = withSvelteNative(config);
