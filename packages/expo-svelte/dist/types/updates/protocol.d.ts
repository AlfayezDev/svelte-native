import { type HeaderValue } from "./structured-headers.js";
export type Platform = "android" | "ios";
export type Asset = {
    /** Content hash chosen by the exporter (MD5 for EAS); it names the file in the store and keys `localAssets`. */
    key: string;
    /** SHA-256 of the file, base64url without padding. The manifest is rejected when an asset has no well-formed hash. */
    hash: string;
    contentType: string;
    url: string;
    /** With the leading dot (`.png`); EAS omits it for the launch asset. */
    fileExtension: string | null;
    /** From the response's `extensions.assetRequestHeaders`, keyed by asset key. */
    headers: Record<string, string>;
};
export type Manifest = {
    id: string;
    /** Epoch milliseconds from `createdAt`; the only ordering between updates. */
    createdAt: number;
    runtimeVersion: string;
    launchAsset: Asset;
    assets: Asset[];
    metadata: Record<string, unknown>;
    /** The manifest as received, for callers that read `extra.expoClient` and the like. */
    raw: Record<string, unknown>;
};
export type Directive = {
    type: "noUpdateAvailable";
} | {
    type: "rollBackToEmbedded";
    commitTime: number;
};
export type ResponseHeaders = {
    protocolVersion: number | null;
    /** `expo-manifest-filters`: stored by the client and applied to every later selection until a newer response replaces it. */
    manifestFilters: Record<string, HeaderValue> | null;
    /** `expo-server-defined-headers`: stored and sent with every later manifest request. */
    serverDefinedHeaders: Record<string, HeaderValue> | null;
};
export type UpdateResponse = {
    headers: ResponseHeaders;
    manifest: Manifest | null;
    directive: Directive | null;
};
/** The slice of `fetch` the client needs; `Response` satisfies it. */
export type FetchResponse = {
    status: number;
    ok: boolean;
    headers: {
        get(name: string): string | null;
    };
    text(): Promise<string>;
};
export type FetchLike = (url: string, init: {
    method: "GET";
    headers: Record<string, string>;
}) => Promise<FetchResponse>;
export declare const isSha256Base64Url: (value: unknown) => value is string;
export type RequestContext = {
    updateUrl: string;
    platform: Platform;
    runtimeVersion: string;
    /** Build-time headers; `expo-channel-name` selects the EAS Update channel. They win over everything else, as upstream's. */
    requestHeaders: Record<string, string>;
    /** Persistent per-install id (`eas-client-id`), which EAS uses to bucket rollouts. */
    clientId: string;
    currentUpdateId: string | null;
    embeddedUpdateId: string | null;
    recentFailedUpdateIds: string[];
    serverDefinedHeaders: Record<string, HeaderValue> | null;
    extraParams?: Record<string, string> | null;
};
/**
 * Header set of a manifest request. Later groups replace earlier ones case-insensitively, in upstream's order
 * (`FileDownloader.createRequestForRemoteUpdate`): server-defined headers and ids, protocol headers, build-time headers.
 */
export declare function buildManifestRequest(context: RequestContext): {
    url: string;
    headers: Record<string, string>;
};
/** Headers of an asset request (`FileDownloader.createRequestForAsset`), after the per-asset `assetRequestHeaders`. */
export declare function buildAssetRequestHeaders(asset: Asset, context: {
    platform: Platform;
    clientId: string;
    requestHeaders: Record<string, string>;
    currentUpdateId: string | null;
    embeddedUpdateId: string | null;
    requestedUpdateId: string;
}): Record<string, string>;
/** Validates a manifest body (`ExpoUpdatesUpdate.fromExpoUpdatesManifest`) and attaches the response's `extensions`. */
export declare function parseManifest(body: unknown, extensions?: unknown): Manifest;
/** `UpdateDirective.fromJSONString`. */
export declare function parseDirective(body: unknown): Directive;
/**
 * Reads a manifest response (`FileDownloader.parseRemoteUpdateResponse`): a 204 or empty body means "nothing new" from protocol
 * version 1 on; `multipart/mixed` carries `manifest` and `directive` parts (either may be absent) and an optional `extensions`
 * part; any other content type is a bare JSON manifest. Code signing parts (`certificate_chain`, `expo-signature`) are not used.
 */
export declare function parseUpdateResponse(response: FetchResponse): Promise<UpdateResponse>;
/** The manifest request, sent and read. A non-2xx response carries the server's JSON error (`expo-json-error: true`). */
export declare function requestUpdate(fetch: FetchLike, context: RequestContext): Promise<UpdateResponse>;
/** A stored or downloaded update, reduced to what selection reads. */
export type Candidate = {
    createdAt: number;
    metadata: Record<string, unknown>;
};
/**
 * An update passes the server's filters unless its `metadata` has a filter's key (case-insensitive) with a different value.
 * Metadata without a filtered key, and an absent filter set, match.
 */
export declare function matchesFilters(update: Candidate, filters: Record<string, HeaderValue> | null): boolean;
/** True when `update` should be downloaded: it passes the filters and is newer than what is running (or what is running does not pass). */
export declare function shouldLoadNewUpdate(update: Candidate, launched: Candidate | null, filters: Record<string, HeaderValue> | null): boolean;
/** True when a `rollBackToEmbedded` directive should replace what is running: the embedded bundle passes the filters and the directive is newer. */
export declare function shouldApplyRollBack(commitTime: number, embedded: Candidate, launched: Candidate | null, filters: Record<string, HeaderValue> | null): boolean;
/** What to download for an update: the launch asset first, then the rest, each key once. */
export declare function assetsToDownload(manifest: Manifest): Asset[];
/** Compares the SHA-256 the device computed for each downloaded file with the manifest's; throws on the first difference or gap. */
export declare function verifyDownloadedAssets(assets: Asset[], downloaded: {
    key: string;
    hash: string;
}[]): void;
