// The config plugin under the package's own name, so `plugins: ["expo-svelte"]` works as it does for every other Expo library: Expo looks
// for `app.plugin.js` in the package root before it looks at the package's `main`. `expo-svelte/app.plugin` (the `exports` entry) is this file.
// (The package is an ES module, so this is one too; Node loads it from `require` as well.)
import plugin from "./dist/node/expo.cjs";

export default plugin.default;
