// eslint-disable-next-line @typescript-eslint/triple-slash-reference -- a script of `declare module`s and `__DEV__`: it cannot be imported, only referenced
/// <reference path="../fabric/react-native-internals.d.ts" />
import Constants from "expo-constants";
import type * as Kit from "$app/env";

/**
 * `$app/env` on the device, and `$app/environment`, the name SvelteKit 3 deprecates it under (Metro resolves both imports here, `withSvelteNative`). The values SvelteKit's
 * `$app/env` has (`browser`, `dev`, `building`, `version`), and `mobile`, which the library adds: `true` on the device, `false` on the web (the Vite plugin adds that side).
 */

/** Always `false`: the device is not a browser. (Svelte's runtime reads `esm-env`, which says it runs in one; that is not this.) */
export const browser: typeof Kit.browser = false;
/** Whether this is a development build (`__DEV__`: Metro serves the bundle and Fast Refresh is on). */
export const dev: typeof Kit.dev = __DEV__;
/** Always `false`: nothing is analysed at build time, the app is bundled by Metro. */
export const building: typeof Kit.building = false;
/** The `version` of the app's Expo config (`app.json`, `app.config.ts`), as `expo-constants` reads it from the config embedded in the build; the empty string when the build has none. */
export const version: typeof Kit.version = Constants.expoConfig?.version ?? "";
/** Always `true` on the device, `false` in the web build: shared code asks `mobile` for what only one of them can do. */
export const mobile = true;
