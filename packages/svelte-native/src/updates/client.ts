/**
 * Checking, fetching and applying updates over the native store. `createUpdates` takes its native module and `fetch` as
 * arguments (the device wiring is in `index.ts`), so the same code runs against fakes in the unit tests.
 * Flow and result shapes follow expo-updates' `CheckForUpdateProcedure` and `FetchUpdateProcedure`.
 */
import type { CommittedUpdate, StoredMetadata, StoreSnapshot, SvelteUpdatesNative } from "./native.ts";
import {
  assetsToDownload,
  buildAssetRequestHeaders,
  requestUpdate,
  shouldApplyRollBack,
  shouldLoadNewUpdate,
  verifyDownloadedAssets,
  type Candidate,
  type FetchLike,
  type Manifest,
  type RequestContext,
  type UpdateResponse,
} from "./protocol.ts";

export type NotAvailableReason =
  | "noUpdateAvailableOnServer"
  | "updateRejectedBySelectionPolicy"
  | "updatePreviouslyFailed"
  | "rollbackRejectedBySelectionPolicy"
  | "rollbackNoEmbeddedConfiguration"
  /** Not an upstream reason: this build has updates switched off (development builds, or no update URL). */
  | "updatesDisabled";

export type UpdateCheckResult =
  | { isAvailable: true; manifest: Record<string, unknown>; isRollBackToEmbedded: false; reason: undefined }
  | { isAvailable: false; manifest: undefined; isRollBackToEmbedded: true; reason: undefined }
  | { isAvailable: false; manifest: undefined; isRollBackToEmbedded: false; reason: NotAvailableReason };

export type UpdateFetchResult =
  | { isNew: true; manifest: Record<string, unknown>; isRollBackToEmbedded: false }
  | { isNew: false; manifest: undefined; isRollBackToEmbedded: boolean };

export type UpdatesDeps = {
  native: SvelteUpdatesNative | null;
  fetch: FetchLike;
  log?: (message: string, error?: unknown) => void;
  /** Concurrent asset downloads. */
  concurrency?: number;
};

type Evaluation =
  | { kind: "update"; manifest: Manifest; downloaded: boolean }
  | { kind: "rollback"; commitTime: number }
  | { kind: "none"; reason: NotAvailableReason };

const DEFAULT_CONCURRENCY = 4;

export function createUpdates({ native, fetch, log = () => undefined, concurrency = DEFAULT_CONCURRENCY }: UpdatesDeps) {
  const enabled = native?.isEnabled === true ? native : null;
  const channel = enabled?.requestHeaders["expo-channel-name"] ?? null;

  /** One request, one decision. Rejects when the request or the response is invalid. */
  async function evaluate(active: SvelteUpdatesNative): Promise<{ evaluation: Evaluation; response: UpdateResponse; store: StoreSnapshot }> {
    const store = JSON.parse(await active.readStore()) as StoreSnapshot;
    const context: RequestContext = {
      updateUrl: active.updateUrl ?? "",
      platform: active.platform,
      runtimeVersion: active.runtimeVersion ?? "",
      requestHeaders: active.requestHeaders,
      clientId: active.clientId,
      currentUpdateId: active.updateId,
      embeddedUpdateId: null,
      recentFailedUpdateIds: store.failedIds,
      serverDefinedHeaders: store.metadata.serverDefinedHeaders,
    };
    const response = await requestUpdate(fetch, context);
    const filters = response.headers.manifestFilters;
    const embedded: Candidate = { createdAt: store.embeddedCreatedAt, metadata: {} };
    const stored = active.updateId ? store.updates[active.updateId] : undefined;
    const launched: Candidate = active.updateId === null ? embedded : { createdAt: stored?.createdAt ?? active.createdAt, metadata: stored?.metadata ?? {} };
    const none = (reason: NotAvailableReason): Evaluation => ({ kind: "none", reason });

    if (response.directive?.type === "noUpdateAvailable") return { evaluation: none("noUpdateAvailableOnServer"), response, store };
    if (response.directive?.type === "rollBackToEmbedded") {
      if (!active.hasEmbeddedUpdate) return { evaluation: none("rollbackNoEmbeddedConfiguration"), response, store };
      if (!shouldApplyRollBack(response.directive.commitTime, embedded, launched, filters)) return { evaluation: none("rollbackRejectedBySelectionPolicy"), response, store };
      return { evaluation: { kind: "rollback", commitTime: response.directive.commitTime }, response, store };
    }
    const manifest = response.manifest;
    if (manifest === null) return { evaluation: none("noUpdateAvailableOnServer"), response, store };
    // An update for another runtime version cannot launch, so it is never downloaded.
    if (manifest.runtimeVersion !== active.runtimeVersion || !shouldLoadNewUpdate(manifest, launched, filters)) return { evaluation: none("updateRejectedBySelectionPolicy"), response, store };
    // A newer update that already failed to launch here would otherwise be fetched again on every start.
    const known = store.updates[manifest.id];
    if (known?.status === "failed" || store.failedIds.includes(manifest.id)) return { evaluation: none("updatePreviouslyFailed"), response, store };
    return { evaluation: { kind: "update", manifest, downloaded: known?.status === "ready" }, response, store };
  }

  async function checkForUpdateAsync(): Promise<UpdateCheckResult> {
    if (!enabled) return { isAvailable: false, manifest: undefined, isRollBackToEmbedded: false, reason: "updatesDisabled" };
    const { evaluation } = await evaluate(enabled);
    switch (evaluation.kind) {
      case "update": return { isAvailable: true, manifest: evaluation.manifest.raw, isRollBackToEmbedded: false, reason: undefined };
      case "rollback": return { isAvailable: false, manifest: undefined, isRollBackToEmbedded: true, reason: undefined };
      case "none": return { isAvailable: false, manifest: undefined, isRollBackToEmbedded: false, reason: evaluation.reason };
    }
  }

  /** Runs `work` over `items` with at most `concurrency` in flight; stops starting new items after a failure and rethrows it. */
  async function forEachLimited<T>(items: T[], work: (item: T) => Promise<void>): Promise<void> {
    const queue = [...items];
    let failure: unknown;
    let failed = false;
    const worker = async () => {
      for (let item = queue.shift(); item !== undefined && !failed; item = queue.shift()) {
        try { await work(item); } catch (error) { failed = true; failure = error; }
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
    if (failed) throw failure;
  }

  async function download(active: SvelteUpdatesNative, manifest: Manifest): Promise<void> {
    const assets = assetsToDownload(manifest);
    const headers = { platform: active.platform, clientId: active.clientId, requestHeaders: active.requestHeaders, currentUpdateId: active.updateId, embeddedUpdateId: null, requestedUpdateId: manifest.id };
    const downloaded: { key: string; hash: string }[] = [];
    await forEachLimited(assets, async (asset) => {
      downloaded.push(await active.downloadAsset({
        updateId: manifest.id,
        key: asset.key,
        url: asset.url,
        headers: buildAssetRequestHeaders(asset, headers),
        extension: asset.fileExtension ?? "",
        launch: asset.key === manifest.launchAsset.key,
        hash: asset.hash,
      }));
    });
    // The device hashed each file as it wrote it; the update becomes launchable only if every hash is the manifest's.
    verifyDownloadedAssets(assets, downloaded);
    const committed: CommittedUpdate = {
      id: manifest.id,
      createdAt: manifest.createdAt,
      runtimeVersion: manifest.runtimeVersion,
      metadata: manifest.metadata,
      launchAssetKey: manifest.launchAsset.key,
      assets: assets.map((asset) => ({ key: asset.key, extension: asset.fileExtension ?? "" })),
    };
    await active.commitUpdate(JSON.stringify(committed));
  }

  let fetching: Promise<UpdateFetchResult> | null = null;

  async function fetchOnce(active: SvelteUpdatesNative): Promise<UpdateFetchResult> {
    const { evaluation, response } = await evaluate(active);
    let result: UpdateFetchResult = { isNew: false, manifest: undefined, isRollBackToEmbedded: false };
    if (evaluation.kind === "rollback") {
      await active.rollBackToEmbedded(evaluation.commitTime);
      result = { isNew: false, manifest: undefined, isRollBackToEmbedded: true };
    } else if (evaluation.kind === "update") {
      if (!evaluation.downloaded) await download(active, evaluation.manifest);
      result = { isNew: true, manifest: evaluation.manifest.raw, isRollBackToEmbedded: false };
    }
    // Even a response that only says "no update" can carry new filters or server-defined headers; a header it lacks keeps the stored value.
    const metadata: StoredMetadata = { serverDefinedHeaders: response.headers.serverDefinedHeaders, manifestFilters: response.headers.manifestFilters };
    if (metadata.serverDefinedHeaders || metadata.manifestFilters) await active.saveMetadata(JSON.stringify(metadata));
    return result;
  }

  /** Downloads the newest update that passes selection. It launches on the next start, or at once after `reloadAsync`. Concurrent calls share one run. */
  function fetchUpdateAsync(): Promise<UpdateFetchResult> {
    if (!enabled) return Promise.resolve({ isNew: false, manifest: undefined, isRollBackToEmbedded: false });
    fetching ??= fetchOnce(enabled).finally(() => { fetching = null; });
    return fetching;
  }

  async function reloadAsync(): Promise<void> {
    if (enabled) await enabled.reload();
  }

  /** The check that runs after the first commit when the build says `checkOnLaunch: ALWAYS`; failures are logged, never thrown. */
  async function checkOnLaunch(): Promise<void> {
    if (enabled?.checkOnLaunch !== "ALWAYS") return;
    try {
      const result = await fetchUpdateAsync();
      if (result.isNew) log(`Update ${String(result.manifest.id)} downloaded; it launches on the next start`);
    } catch (error) {
      log("Update check failed", error);
    }
  }

  return {
    isEnabled: enabled !== null,
    updateId: enabled?.updateId?.toLowerCase() ?? null,
    channel,
    runtimeVersion: enabled?.runtimeVersion ?? null,
    checkForUpdateAsync,
    fetchUpdateAsync,
    reloadAsync,
    checkOnLaunch,
  };
}

export type Updates = ReturnType<typeof createUpdates>;
