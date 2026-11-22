/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS is the point: this is how Metro and Expo load the library */
// Loaded by plain `node` the way `@expo/config` loads a plugin named in `app.json` / `app.config`: `withPlugins` resolves the reference with
// `resolveConfigPluginFunction` (the package's `app.plugin.js` for a bare package name, the module's `exports` through Node's CommonJS resolution for a path
// into it) and requires the file.
const { withPlugins } = require("@expo/config-plugins");
// The resolver itself, to say which file each name came to (it is not in the package's index).
const { resolveConfigPluginFunctionWithInfo } = require("@expo/config-plugins/build/utils/plugin-resolver");

const base = { name: "app", slug: "app", android: { package: "io.example.app" }, ios: { bundleIdentifier: "io.example.app" }, _internal: { projectRoot: process.cwd() } };
const options = { androidProfileable: true, remote: { origin: "https://app.example.com" } };
const summary = (name) => {
  const config = withPlugins({ ...base }, [[name, options]]);
  const resolved = resolveConfigPluginFunctionWithInfo(process.cwd(), name);
  return { mods: Object.keys(config.mods ?? {}).sort(), remote: config.extra?.expoSvelte?.remote, pluginFile: resolved.pluginFile, isPluginFile: resolved.isPluginFile, kind: typeof resolved.plugin };
};
const names = { bare: "expo-svelte", appPlugin: "expo-svelte/app.plugin" };
const result = Object.fromEntries(Object.entries(names).map(([key, name]) => [key, summary(name)]));
// What the bare name resolves to is the same plugin function as the path's.
result.sameAppPlugin = resolveConfigPluginFunctionWithInfo(process.cwd(), names.bare).plugin === resolveConfigPluginFunctionWithInfo(process.cwd(), names.appPlugin).plugin;
// `expo-svelte/expo` was a third name up to 0.4.0-rc.6: the package's `exports` map no longer has it, and `@expo/config-plugins` says what it makes of it.
try {
  resolveConfigPluginFunctionWithInfo(process.cwd(), "expo-svelte/expo");
  result.removed = "resolved";
} catch (error) {
  result.removed = error.code ?? error.message;
}
console.log(JSON.stringify(result));
