// React Native community autolinking, per variant. Every app but the smoke app (`APP_VARIANT=smoke`, `io.rasheed.svelteqa.smoke`) leaves
// out every package of the native module smoke test (qa/smoke-modules.json): the product (`io.rasheed.sveltenative.qaproduct`) and the QA app
// (`io.rasheed.svelteqa`) have the product's native modules and no more. Expo's autolinking gets the same names from the Svelte native
// plugin's `autolinkingExclude` (app.config.ts), which also writes them into settings.gradle and the Podfile.
// An ES module, like the rest of this package ("type": "module"); Expo's autolinking and the community CLI both load it.
import { createRequire } from "node:module";

/** @type {{ smokeOnlyPackages: string[] }} */
const { smokeOnlyPackages } = createRequire(import.meta.url)("./qa/smoke-packages.cjs");

const smoke = process.env.APP_VARIANT === "smoke";

export default {
	dependencies: smoke ? {} : Object.fromEntries(smokeOnlyPackages.map((name) => [name, { platforms: { android: null, ios: null } }])),
};
