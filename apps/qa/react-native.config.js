// React Native community autolinking, per variant. Every app but the smoke app (`APP_VARIANT=smoke`, `dev.alfayez.exposvelte.qa.smoke`) leaves
// out every package of the native module smoke test (qa/smoke-modules.json) that is not the product's, and not one the library requires or carries
// (the vendored react-native-quick-crypto, react-native-quick-base64, react-native-mmkv and react-native-nitro-modules: linked by every app): the product (`dev.alfayez.exposvelte.qaproduct`) and the QA app
// (`dev.alfayez.exposvelte.qa`) have the product's native modules and no more. Expo's autolinking gets the same names from the Svelte native
// plugin's `autolinkingExclude` (app.config.ts), which also writes them into settings.gradle and the Podfile.
// An ES module, like the rest of this package ("type": "module"); Expo's autolinking and the community CLI both load it.
import { createRequire } from "node:module";

/** @type {{ smokeOnlyPackages: string[] }} */
const { smokeOnlyPackages } = createRequire(import.meta.url)("./qa/smoke-packages.cjs");

const smoke = process.env.APP_VARIANT === "smoke";

export default {
	dependencies: smoke ? {} : Object.fromEntries(smokeOnlyPackages.map((name) => [name, { platforms: { android: null, ios: null } }])),
};
