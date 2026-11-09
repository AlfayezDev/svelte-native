// Stands in for SvelteKit's `$app/env` in the client files this package reuses. Only `prerender` reads `version`, to name a browser Cache API
// cache; a native has no Cache API, so nothing depends on the value.
export const version = "native";
