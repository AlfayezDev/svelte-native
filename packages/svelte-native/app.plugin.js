// The config plugin under the package's own name, so `plugins: ["@alfayez/svelte-native"]` works as it does for every other Expo library: Expo looks
// for `app.plugin.js` in the package root before it looks at the package's `main`. It is the same plugin as `@alfayez/svelte-native/expo`, which keeps working.
// (The package is an ES module, so this is one too; Node loads it from `require` as well.)
import plugin from "./dist/node/expo.cjs";

export default plugin.default;
