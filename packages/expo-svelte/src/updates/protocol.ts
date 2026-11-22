/**
 * The client side of the Expo Updates protocol, version 1 (https://docs.expo.dev/technical-specs/expo-updates-1/), as `eas update`
 * publishes it. Pure functions over an injected `fetch`: nothing here touches the device, so every rule is unit-tested.
 * Behaviour mirrors expo-updates (`FileDownloader`, `ResponseHeaderData`, `ExpoUpdatesUpdate`, `UpdateDirective` and the
 * filter-aware selection policies); the cited upstream file is named where a rule is subtle.
 */
import { multipartBoundary, parseMultipart } from "./multipart.ts";
import { parseDictionary, serializeStringDictionary, serializeStringList, type HeaderValue } from "./structured-headers.ts";

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

export type Directive = { type: "noUpdateAvailable" } | { type: "rollBackToEmbedded"; commitTime: number };

export type ResponseHeaders = {
  protocolVersion: number | null;
  /** `expo-manifest-filters`: stored by the client and applied to every later selection until a newer response replaces it. */
  manifestFilters: Record<string, HeaderValue> | null;
  /** `expo-server-defined-headers`: stored and sent with every later manifest request. */
  serverDefinedHeaders: Record<string, HeaderValue> | null;
};

export type UpdateResponse = { headers: ResponseHeaders; manifest: Manifest | null; directive: Directive | null };

/** The slice of `fetch` the client needs; `Response` satisfies it. */
export type FetchResponse = { status: number; ok: boolean; headers: { get(name: string): string | null }; text(): Promise<string> };
export type FetchLike = (url: string, init: { method: "GET"; headers: Record<string, string> }) => Promise<FetchResponse>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** 32 bytes of SHA-256 in base64url without padding. */
const SHA256_BASE64URL = /^[A-Za-z0-9_-]{43}$/;
const ASSET_KEY = /^[A-Za-z0-9._-]{1,128}$/;
const FILE_EXTENSION = /^\.[A-Za-z0-9]{1,16}$/;

export const isSha256Base64Url = (value: unknown): value is string => typeof value === "string" && SHA256_BASE64URL.test(value);

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
export function buildManifestRequest(context: RequestContext): { url: string; headers: Record<string, string> } {
  const headers: Record<string, string> = {};
  const set = (name: string, value: string) => { headers[name.toLowerCase()] = value; };
  for (const [name, value] of Object.entries(context.serverDefinedHeaders ?? {})) set(name, String(value));
  if (context.extraParams && Object.keys(context.extraParams).length > 0) set("expo-extra-params", serializeStringDictionary(context.extraParams));
  if (context.currentUpdateId) set("expo-current-update-id", context.currentUpdateId.toLowerCase());
  if (context.embeddedUpdateId) set("expo-embedded-update-id", context.embeddedUpdateId.toLowerCase());
  if (context.recentFailedUpdateIds.length > 0) set("expo-recent-failed-update-ids", serializeStringList(context.recentFailedUpdateIds));
  set("accept", "multipart/mixed,application/expo+json,application/json");
  set("expo-platform", context.platform);
  set("expo-protocol-version", "1");
  set("expo-api-version", "1");
  set("expo-updates-environment", "BARE");
  set("expo-json-error", "true");
  set("eas-client-id", context.clientId);
  if (context.runtimeVersion) set("expo-runtime-version", context.runtimeVersion);
  for (const [name, value] of Object.entries(context.requestHeaders)) set(name, value);
  return { url: context.updateUrl, headers };
}

/** Headers of an asset request (`FileDownloader.createRequestForAsset`), after the per-asset `assetRequestHeaders`. */
export function buildAssetRequestHeaders(
  asset: Asset,
  context: { platform: Platform; clientId: string; requestHeaders: Record<string, string>; currentUpdateId: string | null; embeddedUpdateId: string | null; requestedUpdateId: string },
): Record<string, string> {
  const headers: Record<string, string> = {};
  const set = (name: string, value: string) => { headers[name.toLowerCase()] = value; };
  for (const [name, value] of Object.entries(asset.headers)) set(name, value);
  if (context.currentUpdateId) set("expo-current-update-id", context.currentUpdateId.toLowerCase());
  if (context.embeddedUpdateId) set("expo-embedded-update-id", context.embeddedUpdateId.toLowerCase());
  set("expo-requested-update-id", context.requestedUpdateId.toLowerCase());
  set("expo-platform", context.platform);
  set("expo-protocol-version", "1");
  set("expo-api-version", "1");
  set("expo-updates-environment", "BARE");
  set("eas-client-id", context.clientId);
  for (const [name, value] of Object.entries(context.requestHeaders)) set(name, value);
  return headers;
}

function object(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`${what} must be an object`);
  return value as Record<string, unknown>;
}

function text(value: unknown, what: string): string {
  if (typeof value !== "string" || value === "") throw new Error(`${what} must be a non-empty string`);
  return value;
}

function parseDate(value: unknown, what: string): number {
  const at = Date.parse(text(value, what));
  if (Number.isNaN(at)) throw new Error(`${what} is not a date`);
  return at;
}

type AssetHeaders = Record<string, Record<string, string>>;

function parseAsset(value: unknown, what: string, requestHeaders: AssetHeaders, launch: boolean): Asset {
  const asset = object(value, what);
  const key = text(asset.key, `${what}.key`);
  if (!ASSET_KEY.test(key)) throw new Error(`${what}.key is not a safe file name`);
  const hash = asset.hash;
  if (!isSha256Base64Url(hash)) throw new Error(`${what}.hash must be a base64url SHA-256`);
  const url = text(asset.url, `${what}.url`);
  if (!/^https?:\/\//i.test(url)) throw new Error(`${what}.url must be an http(s) URL`);
  const extension = asset.fileExtension;
  if (extension !== undefined && extension !== null && (typeof extension !== "string" || !FILE_EXTENSION.test(extension))) throw new Error(`${what}.fileExtension is not a file extension`);
  // Upstream requires an extension on every asset but the launch asset (`ExpoUpdatesUpdate.assetEntityList`).
  if (!launch && typeof extension !== "string") throw new Error(`${what}.fileExtension is missing`);
  return {
    key,
    hash,
    url,
    contentType: typeof asset.contentType === "string" ? asset.contentType : "",
    fileExtension: typeof extension === "string" ? extension : null,
    headers: requestHeaders[key] ?? {},
  };
}

/** `extensions.assetRequestHeaders`: asset key to the headers to send when downloading it. */
function parseAssetHeaders(extensions: unknown): AssetHeaders {
  if (extensions === null || extensions === undefined) return {};
  const declared = object(extensions, "extensions").assetRequestHeaders;
  if (declared === undefined || declared === null) return {};
  const result: AssetHeaders = {};
  for (const [key, headers] of Object.entries(object(declared, "extensions.assetRequestHeaders"))) {
    result[key] = Object.fromEntries(Object.entries(object(headers, `extensions.assetRequestHeaders.${key}`)).map(([name, header]) => [name, String(header)]));
  }
  return result;
}

/** Validates a manifest body (`ExpoUpdatesUpdate.fromExpoUpdatesManifest`) and attaches the response's `extensions`. */
export function parseManifest(body: unknown, extensions: unknown = null): Manifest {
  const raw = object(body, "manifest");
  const id = text(raw.id, "manifest.id");
  if (!UUID.test(id)) throw new Error("manifest.id is not a UUID");
  const headers = parseAssetHeaders(extensions);
  const assetList = raw.assets === undefined ? [] : raw.assets;
  if (!Array.isArray(assetList)) throw new Error("manifest.assets must be an array");
  return {
    id: id.toLowerCase(),
    createdAt: parseDate(raw.createdAt, "manifest.createdAt"),
    runtimeVersion: text(raw.runtimeVersion, "manifest.runtimeVersion"),
    launchAsset: parseAsset(raw.launchAsset, "manifest.launchAsset", headers, true),
    assets: assetList.map((entry, index) => parseAsset(entry, `manifest.assets[${index}]`, headers, false)),
    metadata: raw.metadata === undefined ? {} : object(raw.metadata, "manifest.metadata"),
    raw,
  };
}

/** `UpdateDirective.fromJSONString`. */
export function parseDirective(body: unknown): Directive {
  const directive = object(body, "directive");
  switch (directive.type) {
    case "noUpdateAvailable":
      return { type: "noUpdateAvailable" };
    case "rollBackToEmbedded":
      return { type: "rollBackToEmbedded", commitTime: parseDate(object(directive.parameters, "directive.parameters").commitTime, "directive.parameters.commitTime") };
    default:
      throw new Error(`Invalid directive type: ${String(directive.type)}`);
  }
}

function parseJson(source: string, what: string): unknown {
  try {
    return JSON.parse(source);
  } catch (error) {
    throw new Error(`${what} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
}

/**
 * Reads a manifest response (`FileDownloader.parseRemoteUpdateResponse`): a 204 or empty body means "nothing new" from protocol
 * version 1 on; `multipart/mixed` carries `manifest` and `directive` parts (either may be absent) and an optional `extensions`
 * part; any other content type is a bare JSON manifest. Code signing parts (`certificate_chain`, `expo-signature`) are not used.
 */
export async function parseUpdateResponse(response: FetchResponse): Promise<UpdateResponse> {
  const protocolHeader = response.headers.get("expo-protocol-version");
  const filters = response.headers.get("expo-manifest-filters");
  const serverHeaders = response.headers.get("expo-server-defined-headers");
  const headers: ResponseHeaders = {
    protocolVersion: protocolHeader === null || Number.isNaN(Number.parseInt(protocolHeader, 10)) ? null : Number.parseInt(protocolHeader, 10),
    manifestFilters: filters === null ? null : parseDictionary(filters),
    serverDefinedHeaders: serverHeaders === null ? null : parseDictionary(serverHeaders),
  };
  const body = response.status === 204 ? "" : await response.text();
  if (response.status === 204 || body === "") {
    if (headers.protocolVersion !== null && headers.protocolVersion > 0) return { headers, manifest: null, directive: null };
    throw new Error("Invalid update response: empty body");
  }
  const contentType = response.headers.get("content-type");
  if (multipartBoundary(contentType) === null) return { headers, manifest: parseManifest(parseJson(body, "manifest")), directive: null };
  const parts = parseMultipart(contentType, body);
  const part = (name: string) => parts.find((candidate) => candidate.name === name)?.body ?? null;
  const manifestBody = part("manifest");
  const extensionsBody = part("extensions");
  const directiveBody = part("directive");
  const extensions = extensionsBody === null ? null : parseJson(extensionsBody, "extensions");
  return {
    headers,
    manifest: manifestBody === null ? null : parseManifest(parseJson(manifestBody, "manifest"), extensions),
    directive: directiveBody === null ? null : parseDirective(parseJson(directiveBody, "directive")),
  };
}

/** The manifest request, sent and read. A non-2xx response carries the server's JSON error (`expo-json-error: true`). */
export async function requestUpdate(fetch: FetchLike, context: RequestContext): Promise<UpdateResponse> {
  const request = buildManifestRequest(context);
  const response = await fetch(request.url, { method: "GET", headers: request.headers });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Update request failed with status ${response.status}${detail ? `: ${detail.slice(0, 300)}` : ""}`);
  }
  return parseUpdateResponse(response);
}

// -- selection (`LoaderSelectionPolicyFilterAware`, `SelectionPolicies.matchesFilters`) ----------------------------------

/** A stored or downloaded update, reduced to what selection reads. */
export type Candidate = { createdAt: number; metadata: Record<string, unknown> };

/**
 * An update passes the server's filters unless its `metadata` has a filter's key (case-insensitive) with a different value.
 * Metadata without a filtered key, and an absent filter set, match.
 */
export function matchesFilters(update: Candidate, filters: Record<string, HeaderValue> | null): boolean {
  if (!filters) return true;
  const metadata = new Map(Object.entries(update.metadata).map(([key, value]) => [key.toLowerCase(), value]));
  for (const [key, expected] of Object.entries(filters)) {
    if (metadata.has(key) && metadata.get(key) !== expected) return false;
  }
  return true;
}

/** True when `update` should be downloaded: it passes the filters and is newer than what is running (or what is running does not pass). */
export function shouldLoadNewUpdate(update: Candidate, launched: Candidate | null, filters: Record<string, HeaderValue> | null): boolean {
  if (!matchesFilters(update, filters)) return false;
  if (launched === null) return true;
  if (!matchesFilters(launched, filters)) return true;
  return update.createdAt > launched.createdAt;
}

/** True when a `rollBackToEmbedded` directive should replace what is running: the embedded bundle passes the filters and the directive is newer. */
export function shouldApplyRollBack(commitTime: number, embedded: Candidate, launched: Candidate | null, filters: Record<string, HeaderValue> | null): boolean {
  if (!matchesFilters(embedded, filters)) return false;
  if (launched === null) return true;
  if (!matchesFilters(launched, filters)) return true;
  return commitTime > launched.createdAt;
}

// -- assets -------------------------------------------------------------------------------------------------------------

/** What to download for an update: the launch asset first, then the rest, each key once. */
export function assetsToDownload(manifest: Manifest): Asset[] {
  const seen = new Set<string>();
  return [manifest.launchAsset, ...manifest.assets].filter((asset) => !seen.has(asset.key) && seen.add(asset.key));
}

/** Compares the SHA-256 the device computed for each downloaded file with the manifest's; throws on the first difference or gap. */
export function verifyDownloadedAssets(assets: Asset[], downloaded: { key: string; hash: string }[]): void {
  const byKey = new Map(downloaded.map((entry) => [entry.key, entry.hash]));
  for (const asset of assets) {
    const actual = byKey.get(asset.key);
    if (actual === undefined) throw new Error(`Asset ${asset.key} was not downloaded`);
    if (actual !== asset.hash) throw new Error(`Asset ${asset.key} failed verification: expected SHA-256 ${asset.hash}, got ${actual}`);
  }
}
