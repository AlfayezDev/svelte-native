// The packages only the smoke app links. `smoke-modules.json` lists every module the smoke test calls; those the product has too
// (`shared`: secure store, localization, constants, asset, system UI, splash screen) and pure JavaScript ones (`link: "js"`) stay.
// Read by app.config.ts (autolinking excludes and config plugins) and react-native.config.js (React Native community autolinking).
const { modules } = require("./smoke-modules.json");

const smokeOnlyPackages = [...new Set(modules.filter((entry) => !entry.shared && entry.link !== "js").flatMap((entry) => entry.packages))];

module.exports = { modules, smokeOnlyPackages };
