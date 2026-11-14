/**
 * SvelteKit remote functions in a native app. A `*.remote.ts` module is imported as in the browser; Metro replaces it with client stubs that
 * call the SvelteKit server named in the app config. This entry is the configuration and the helpers around that.
 */
export { configureRemote, currentHost as remoteHost, resetRemoteConfig } from "./config.js";
export type { RemoteOptions, Transport } from "./config.js";
export { normalizeOrigin, RemoteConfigError } from "./host.js";
export type { RemoteHostConfig } from "./host.js";
export { refreshAll } from "./shims/client.js";
export { native } from "./types.js";
export type { NativeForm, NativeFieldProps, NativeFileProps, NativeFormFields } from "./types.js";
