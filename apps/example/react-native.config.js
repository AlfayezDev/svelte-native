// React Native community autolinking, per variant. The product (`APP_VARIANT=production`, `io.rasheed.app`) leaves out every
// package of the native module smoke test (qa/smoke-modules.json); Expo's autolinking gets the same names from the Svelte native
// plugin's `autolinkingExclude` (app.config.ts), which also writes them into settings.gradle and the Podfile.
// An ES module, like the rest of this package ("type": "module"); Expo's autolinking and the community CLI both load it.
import { createRequire } from "node:module";

/** @type {{ qaOnlyPackages: string[] }} */
const { qaOnlyPackages } = createRequire(import.meta.url)("./qa/smoke-packages.cjs");

const production = process.env.APP_VARIANT === "production";

export default {
	dependencies: production ? Object.fromEntries(qaOnlyPackages.map((name) => [name, { platforms: { android: null, ios: null } }])) : {},
};
