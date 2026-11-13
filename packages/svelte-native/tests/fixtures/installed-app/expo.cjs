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
  return { mods: Object.keys(config.mods ?? {}).sort(), remote: config.extra?.svelteNative?.remote, pluginFile: resolved.pluginFile, isPluginFile: resolved.isPluginFile, kind: typeof resolved.plugin };
};
const names = { path: "@alfayez/svelte-native/expo", bare: "@alfayez/svelte-native", appPlugin: "@alfayez/svelte-native/app.plugin" };
const result = Object.fromEntries(Object.entries(names).map(([key, name]) => [key, summary(name)]));
// What the bare name resolves to is the same plugin function as the path's.
result.same = resolveConfigPluginFunctionWithInfo(process.cwd(), names.bare).plugin === resolveConfigPluginFunctionWithInfo(process.cwd(), names.path).plugin;
result.sameAppPlugin = resolveConfigPluginFunctionWithInfo(process.cwd(), names.bare).plugin === resolveConfigPluginFunctionWithInfo(process.cwd(), names.appPlugin).plugin;
console.log(JSON.stringify(result));
