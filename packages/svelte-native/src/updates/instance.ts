import { createUpdates } from "./client.ts";
import { loadNative } from "./device.ts";
import { nativeFetch } from "./native.ts";

const native = loadNative();

/** The app's updates client: the one `@alfayez/svelte-native/updates` exports the functions of, and `updated` of `$app/state` reads. */
export const updates = createUpdates({
  native,
  fetch: native ? nativeFetch(native) : () => Promise.reject(new Error("SvelteUpdates is not installed")),
  log: (message, error) => (error === undefined ? console.log(`[Svelte updates] ${message}`) : console.warn(`[Svelte updates] ${message}`, error)),
});
