// What the library adds to SvelteKit's `$app/env` (which SvelteKit's own declarations give `browser`, `dev`, `building` and `version`): `mobile`, `true` on the device and `false`
// on the web. A script of `declare module`s, so it merges with SvelteKit's declaration; an app's type check loads it through `expo-svelte/vite` (the `vite.config.ts` that
// `expo-svelte init` writes) and through the router the app's screens import.
declare module "$app/env" {
  /** `true` when the code runs on the device (an Expo Svelte app), `false` in the web build: shared code asks it for what only one of them can do. */
  export const mobile: boolean;
}

// SvelteKit 3 deprecates `$app/environment` for `$app/env` and no longer declares it; both names work on the web and on the device, and both have `mobile`.
declare module "$app/environment" {
  export * from "$app/env";
}
