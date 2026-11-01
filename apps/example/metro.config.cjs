const path = require("node:path");
const { getDefaultConfig } = require("expo/metro-config");
const { withSvelteNative } = require("@rasheed/svelte-native/metro");
const { smokeOnlyBundlePackages } = require("./qa/smoke-packages.cjs");

// The libraries of the native module smoke test are in the smoke app only (APP_VARIANT=smoke). The product and the QA app do not link
// them (app.config.ts excludes them from autolinking), so their bundles must not carry their JavaScript either: Metro resolves them to
// a stub that throws when used. The smoke page keeps its static requires and refuses to run outside the smoke app.
// The checks themselves (smoke-checks.ts) go the same way: the page and the runner stay, the 36 checks are the smoke app's.
const variant = process.env.APP_VARIANT || "qa";
const smoke = variant === "smoke";

module.exports = withSvelteNative(getDefaultConfig(__dirname), {
  stubbedPackages: smoke ? [] : smokeOnlyBundlePackages,
  stubbedFiles: smoke ? [] : [path.join(__dirname, "src/lib/native/dev/smoke-checks.ts")],
  variant,
});
