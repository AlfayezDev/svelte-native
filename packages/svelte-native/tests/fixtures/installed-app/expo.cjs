/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS is the point: this is how Metro and Expo load the library */
// Loaded by plain `node` the way `@expo/config` loads a plugin named in `app.json` / `app.config`: `withPlugins` resolves the reference with
// `resolveConfigPluginFunction` (the module's `exports` through Node's CommonJS resolution) and requires the file.
const { withPlugins } = require("@expo/config-plugins");

const config = withPlugins(
  { name: "app", slug: "app", android: { package: "io.example.app" }, ios: { bundleIdentifier: "io.example.app" }, _internal: { projectRoot: process.cwd() } },
  [["@example/svelte-native/expo", { androidProfileable: true, remote: { origin: "https://app.example.com" } }]],
);
console.log(JSON.stringify({ mods: Object.keys(config.mods ?? {}).sort(), remote: config.extra?.svelteNative?.remote }));
