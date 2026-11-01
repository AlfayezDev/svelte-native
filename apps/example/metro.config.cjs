const path = require("node:path");
const { getDefaultConfig } = require("expo/metro-config");
const { withSvelteNative } = require("@rasheed/svelte-native/metro");
const { smokeOnlyBundlePackages } = require("./qa/smoke-packages.cjs");

// The libraries of the native module smoke test are in the smoke app only (APP_VARIANT=smoke). The product and the QA app do not link
// them (app.config.ts excludes them from autolinking), so their bundles must not carry their JavaScript either: Metro resolves them to
// a stub that throws when used. The smoke page keeps its static requires and refuses to run outside the smoke app.
// The checks themselves (smoke-checks.ts) go the same way: the page and the runner stay, the 36 checks are the smoke app's.
// The product (APP_VARIANT=production) does not carry the development lab either: `svelte-native sync` leaves the `/__dev` routes out of
// the route table (route discovery, `routeFiles`), and what still imports a lab module (the root layout's two hooks, a stale table) gets the
// directory's stub. `withSvelteNative` writes the route table for this variant when this file loads and refuses a table synced for another.
// `qa/test/bundle.test.ts` lists the product bundle's modules.
const variant = process.env.APP_VARIANT || "qa";
const smoke = variant === "smoke";
const product = variant === "production";

module.exports = withSvelteNative(getDefaultConfig(__dirname), {
  stubbedPackages: smoke ? [] : smokeOnlyBundlePackages,
  stubbedFiles: smoke ? [] : [path.join(__dirname, "src/lib/native/dev/smoke-checks.ts")],
  stubbedDirectories: product ? [path.join(__dirname, "src/lib/native/dev"), path.join(__dirname, "src/routes/__dev")] : [],
  variant,
});
