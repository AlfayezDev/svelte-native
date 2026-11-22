/**
 * Over-the-air JavaScript updates, compatible with `eas update`. Same surface as the core of `expo-updates`:
 * `import { checkForUpdateAsync, fetchUpdateAsync, reloadAsync } from "expo-svelte/updates"`.
 * Without the `SvelteUpdates` native module, or in a build where updates are off (development builds), every call resolves
 * without doing anything and `isEnabled` is false.
 */
import { updates } from "./instance.ts";

export type { NotAvailableReason, UpdateCheckResult, UpdateFetchResult } from "./client.ts";

/** Whether this build checks for and launches updates. False in development builds. */
export const isEnabled: boolean = updates.isEnabled;
/** The id of the running OTA update, lowercase; null when the bundle embedded in the app is running. */
export const updateId: string | null = updates.updateId;
/** The EAS Update channel this build was made for, from the `expo-channel-name` request header. */
export const channel: string | null = updates.channel;
export const runtimeVersion: string | null = updates.runtimeVersion;
/** Asks the server whether a newer update exists, without downloading it. */
export const checkForUpdateAsync = updates.checkForUpdateAsync;
/** Downloads the newest update. It launches on the next start, or immediately after `reloadAsync`. */
export const fetchUpdateAsync = updates.fetchUpdateAsync;
/** Restarts the app on the newest downloaded update. */
export const reloadAsync = updates.reloadAsync;
/** Used by the launch hook after the first commit. */
export const checkOnLaunch = updates.checkOnLaunch;
