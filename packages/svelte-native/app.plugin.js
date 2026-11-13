// The config plugin under the package's own name, so `plugins: ["@alfayez/svelte-native"]` works as it does for every other Expo library: Expo looks
// for `app.plugin.js` in the package root before it looks at the package's `main`. `@alfayez/svelte-native/app.plugin` (the `exports` entry) is this file;
// `@alfayez/svelte-native/expo`, the same plugin, is a deprecated alias that goes away in 0.4.0-rc.7.
// (The package is an ES module, so this is one too; Node loads it from `require` as well.)
import plugin from "./dist/node/expo.cjs";

export default plugin.default;
