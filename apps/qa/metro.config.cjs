const path = require("node:path");
const { getDefaultConfig } = require("expo/metro-config");
const { withSvelteNative } = require("@alfayez/svelte-native/metro");
const { smokeOnlyBundlePackages } = require("./qa/smoke-packages.cjs");

// The libraries of the native module smoke test are in the smoke app only (APP_VARIANT=smoke), but for the four the library itself requires
// (react-native-quick-crypto, react-native-mmkv, react-native-nitro-modules, react-native-quick-base64: the device's `crypto` and `localStorage`
// are made of them), which every variant links and bundles (qa/smoke-packages.cjs: `shared` in smoke-modules.json). The product and the QA app
// do not link the rest (app.config.ts excludes them from autolinking), so their bundles must not carry their JavaScript either: Metro resolves them to
// a stub that throws when used. The smoke page keeps its static requires and refuses to run outside the smoke app.
// The checks themselves (smoke-checks.ts) go the same way: the page and the runner stay, the 36 checks are the smoke app's.
// The product (APP_VARIANT=production) does not carry the development lab either: `svelte-native sync` leaves the `/__dev` routes out of
// the route table (route discovery, `routeFiles`), and what still imports a lab module (the root layout's hooks, a stale table) gets the
// directory's stub. `withSvelteNative` writes this variant's route table (`.svelte-native/routes.<variant>.ts`) when this file loads and resolves
// `./routes` to it, and keeps the variant's stubs in a directory of their own, so no file is shared with the Metro of another variant (a QA
// development server runs beside a product bundle). `qa/test/bundle.test.ts` lists the product bundle's modules.
const variant = process.env.APP_VARIANT || "qa";
const smoke = variant === "smoke";
const product = variant === "production";

// `css`: the classes of src/global.css (Tailwind's and the lab's own) as React Native styles, for `class`; the checks of the native checks lab read what they became on the device
// (src/lib/native/dev/class-checks.ts). Only the lab uses them, so the product has no class table (Tailwind reads every word of src/ as a candidate: the table would be bytes the product never reads).
module.exports = withSvelteNative(getDefaultConfig(__dirname), {
  css: product ? undefined : "src/global.css",
  stubbedPackages: smoke ? [] : smokeOnlyBundlePackages,
  stubbedFiles: smoke ? [] : [path.join(__dirname, "src/lib/native/dev/smoke-checks.ts")],
  stubbedDirectories: product ? [path.join(__dirname, "src/lib/native/dev"), path.join(__dirname, "src/routes/__dev")] : [],
  variant,
});
