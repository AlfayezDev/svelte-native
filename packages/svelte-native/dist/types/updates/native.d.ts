/**
 * The `SvelteUpdates` native module (`native/svelte-updates`), as the JavaScript side sees it. The module is the
 * store and the launcher: it keeps the downloaded updates on disk, picks the bundle the next start launches, and downloads
 * and hashes files. Everything the protocol decides (what to ask for, what counts as newer) happens here, in JavaScript.
 */
import type { FetchLike } from "./protocol.js";
export type CheckOnLaunch = "ALWAYS" | "NEVER" | "WIFI_ONLY" | "ERROR_RECOVERY_ONLY";
export type AssetDownload = {
    updateId: string;
    key: string;
    url: string;
    headers: Record<string, string>;
    /** With the leading dot, or empty. */
    extension: string;
    /** The launch asset becomes the update's bundle file; every other asset joins the shared asset directory. */
    launch: boolean;
    /** Base64url SHA-256 from the manifest; the file is kept only when it matches. */
    hash: string;
};
export type SvelteUpdatesNative = {
    /** False in debuggable builds and when the build has no update URL or runtime version. */
    isEnabled: boolean;
    platform: "android" | "ios";
    /** The OTA update this process launched, null for the bundle embedded in the app. */
    updateId: string | null;
    runtimeVersion: string | null;
    updateUrl: string | null;
    /** Build-time request headers; `expo-channel-name` carries the channel. */
    requestHeaders: Record<string, string>;
    checkOnLaunch: CheckOnLaunch;
    /** Read from the build configuration. Only 0 is honored: the check runs after the first commit, never before it. */
    launchWaitMs: number;
    hasEmbeddedUpdate: boolean;
    isEmbeddedLaunch: boolean;
    /** Epoch milliseconds: the launched update's `createdAt`, or the embedded bundle's build time. */
    createdAt: number;
    /** Asset key to `file://` URI for the launched update; empty for an embedded launch. */
    localAssets: Record<string, string>;
    /** Persistent per-install id sent as `eas-client-id`. */
    clientId: string;
    request(url: string, headers: Record<string, string>): Promise<{
        status: number;
        headers: Record<string, string>;
        body: string;
    }>;
    downloadAsset(download: AssetDownload): Promise<{
        key: string;
        hash: string;
    }>;
    /** Records a fully downloaded update as launchable. The argument is `CommittedUpdate` as JSON. */
    commitUpdate(updateJson: string): Promise<void>;
    /** Stores the server's manifest filters and server-defined headers (`StoredMetadata` as JSON); a null field keeps the stored value. */
    saveMetadata(metadataJson: string): Promise<void>;
    /** The store index as JSON (`StoreSnapshot`). */
    readStore(): Promise<string>;
    /** Makes the embedded bundle win over every update created before `commitTime` (epoch milliseconds). */
    rollBackToEmbedded(commitTime: number): Promise<void>;
    /** The host reached its first commit; clears the launch-failure marker. */
    markLaunched(): Promise<void>;
    /** Re-selects the launch bundle and reloads the React host with it. */
    reload(): Promise<void>;
};
export type CommittedUpdate = {
    id: string;
    createdAt: number;
    runtimeVersion: string;
    metadata: Record<string, unknown>;
    launchAssetKey: string;
    assets: {
        key: string;
        extension: string;
    }[];
};
export type StoredMetadata = {
    serverDefinedHeaders: Record<string, string | number | boolean> | null;
    manifestFilters: Record<string, string | number | boolean> | null;
};
export type StoreSnapshot = {
    /** Effective commit time of the embedded bundle: its build time, or the newest `rollBackToEmbedded` directive applied to it. */
    embeddedCreatedAt: number;
    updates: Record<string, {
        id: string;
        createdAt: number;
        runtimeVersion: string;
        status: "ready" | "failed";
        metadata: Record<string, unknown>;
    }>;
    /** Ids whose launch never reached the first commit, newest last. */
    failedIds: string[];
    metadata: StoredMetadata;
};
/** Presents the native request as a `fetch`, so the protocol client runs the same code on a device and in tests. */
export declare function nativeFetch(native: Pick<SvelteUpdatesNative, "request">): FetchLike;
