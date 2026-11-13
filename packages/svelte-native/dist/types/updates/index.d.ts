export type { NotAvailableReason, UpdateCheckResult, UpdateFetchResult } from "./client.js";
/** Whether this build checks for and launches updates. False in development builds. */
export declare const isEnabled: boolean;
/** The id of the running OTA update, lowercase; null when the bundle embedded in the app is running. */
export declare const updateId: string | null;
/** The EAS Update channel this build was made for, from the `expo-channel-name` request header. */
export declare const channel: string | null;
export declare const runtimeVersion: string | null;
/** Asks the server whether a newer update exists, without downloading it. */
export declare const checkForUpdateAsync: () => Promise<import("./client.js").UpdateCheckResult>;
/** Downloads the newest update. It launches on the next start, or immediately after `reloadAsync`. */
export declare const fetchUpdateAsync: () => Promise<import("./client.js").UpdateFetchResult>;
/** Restarts the app on the newest downloaded update. */
export declare const reloadAsync: () => Promise<void>;
/** Used by the launch hook after the first commit. */
export declare const checkOnLaunch: () => Promise<void>;
