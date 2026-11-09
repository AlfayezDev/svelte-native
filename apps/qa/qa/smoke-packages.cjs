// The packages only the smoke app links. `smoke-modules.json` lists every module the smoke test calls; those the product has too
// (`shared`: secure store, localization, constants, asset, system UI, splash screen) and pure JavaScript ones (`link: "js"`) stay.
// Read by app.config.ts (autolinking excludes and config plugins) and react-native.config.js (React Native community autolinking).
const { modules } = require("./smoke-modules.json");

const smokeOnlyPackages = [...new Set(modules.filter((entry) => !entry.shared && entry.link !== "js").flatMap((entry) => entry.packages))];

/**
 * The packages the product and the QA app's JavaScript bundles must not carry: the ones above, and the JavaScript-only ones (Statsig:
 * no native code to leave out of autolinking, but 87 modules of its own and the whole `react-native` index its imports reach).
 * Metro resolves them to a stub (metro.config.cjs).
 */
const smokeOnlyBundlePackages = [...new Set(modules.filter((entry) => !entry.shared).flatMap((entry) => entry.packages))];

module.exports = { modules, smokeOnlyPackages, smokeOnlyBundlePackages };
