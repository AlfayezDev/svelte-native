/**
 * Checking, fetching and applying updates over the native store. `createUpdates` takes its native module and `fetch` as
 * arguments (the device wiring is in `index.ts`), so the same code runs against fakes in the unit tests.
 * Flow and result shapes follow expo-updates' `CheckForUpdateProcedure` and `FetchUpdateProcedure`.
 */
import type { SvelteUpdatesNative } from "./native.js";
import { type FetchLike } from "./protocol.js";
export type NotAvailableReason = "noUpdateAvailableOnServer" | "updateRejectedBySelectionPolicy" | "updatePreviouslyFailed" | "rollbackRejectedBySelectionPolicy" | "rollbackNoEmbeddedConfiguration"
/** Not an upstream reason: this build has updates switched off (development builds, or no update URL). */
 | "updatesDisabled";
export type UpdateCheckResult = {
    isAvailable: true;
    manifest: Record<string, unknown>;
    isRollBackToEmbedded: false;
    reason: undefined;
} | {
    isAvailable: false;
    manifest: undefined;
    isRollBackToEmbedded: true;
    reason: undefined;
} | {
    isAvailable: false;
    manifest: undefined;
    isRollBackToEmbedded: false;
    reason: NotAvailableReason;
};
export type UpdateFetchResult = {
    isNew: true;
    manifest: Record<string, unknown>;
    isRollBackToEmbedded: false;
} | {
    isNew: false;
    manifest: undefined;
    isRollBackToEmbedded: boolean;
};
export type UpdatesDeps = {
    native: SvelteUpdatesNative | null;
    fetch: FetchLike;
    log?: (message: string, error?: unknown) => void;
    /** Concurrent asset downloads. */
    concurrency?: number;
};
export declare function createUpdates({ native, fetch, log, concurrency }: UpdatesDeps): {
    isEnabled: boolean;
    updateId: string | null;
    channel: string | null;
    runtimeVersion: string | null;
    checkForUpdateAsync: () => Promise<UpdateCheckResult>;
    fetchUpdateAsync: () => Promise<UpdateFetchResult>;
    reloadAsync: () => Promise<void>;
    checkOnLaunch: () => Promise<void>;
    /** Whether an update is waiting for the next start: a check found one, a fetch downloaded one, or the server asked for a rollback to the embedded bundle. Always false when updates are off. */
    readonly pending: boolean;
    /** Calls `listener` whenever `pending` changes; returns what stops it. */
    onPending(listener: () => void): () => void;
};
export type Updates = ReturnType<typeof createUpdates>;
