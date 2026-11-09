/**
 * SvelteKit remote functions in a native app. A `*.remote.ts` module is imported as in the browser; Metro replaces it with client stubs that
 * call the SvelteKit server named in the app config. This entry is the configuration and the helpers around that.
 */
export { configureRemote, currentHost as remoteHost, resetRemoteConfig } from "./config.ts";
export type { RemoteOptions, Transport } from "./config.ts";
export { normalizeOrigin, RemoteConfigError } from "./host.ts";
export type { RemoteHostConfig } from "./host.ts";
export { refreshAll } from "./shims/client.ts";
export { native } from "./types.ts";
export type { NativeForm, NativeFieldProps, NativeFormFields } from "./types.ts";
