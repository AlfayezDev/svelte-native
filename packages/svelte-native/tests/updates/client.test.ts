import { describe, expect, test } from "bun:test";
import { createUpdates } from "../../src/updates/client.ts";
import { createAssetTransformer, type SourceResolver } from "../../src/updates/assets.ts";
import type { AssetDownload, CommittedUpdate, StoredMetadata, StoreSnapshot, SvelteUpdatesNative } from "../../src/updates/native.ts";
import { nativeFetch } from "../../src/updates/native.ts";
import type { FetchLike } from "../../src/updates/protocol.ts";
import {
  CREATED_AT, UPDATE_ID, directiveResponse, emptyResponse, launchAsset, logo, logo2x, manifest, manifestResponse, noUpdateDirective, rollBackDirective, multipart, responseHeaders,
} from "./support/eas.ts";
import { nativeUpdates } from "./support/native.ts";

const embeddedAt = Date.parse("2026-10-01T00:00:00.000Z");
const emptyMetadata: StoredMetadata = { serverDefinedHeaders: null, manifestFilters: null };
const emptyStore: StoreSnapshot = { embeddedCreatedAt: embeddedAt, updates: {}, failedIds: [], metadata: emptyMetadata };

type Fake = { native: SvelteUpdatesNative; calls: string[]; downloads: AssetDownload[]; commits: CommittedUpdate[]; metadata: StoredMetadata[]; rollbacks: number[]; store: StoreSnapshot };

/** A native module that records what it is asked and hashes nothing: `downloadAsset` answers with the hash it was given unless told otherwise. */
function fakeNative(overrides: Partial<SvelteUpdatesNative> = {}, store: Partial<StoreSnapshot> = {}, tamper: (download: AssetDownload) => string = (download) => download.hash): Fake {
  const fake = { calls: [] as string[], downloads: [] as AssetDownload[], commits: [] as CommittedUpdate[], metadata: [] as StoredMetadata[], rollbacks: [] as number[], store: { ...emptyStore, ...store } };
  const native = nativeUpdates({
    updateUrl: "https://u.expo.dev/bb048172-896f-48f1-97c0-c9ec765842c0",
    checkOnLaunch: "ALWAYS",
    launchWaitMs: 0,
    createdAt: embeddedAt,
    clientId: "client-1",
    downloadAsset: async (download) => { fake.downloads.push(download); return { key: download.key, hash: tamper(download) }; },
    commitUpdate: async (json) => { fake.commits.push(JSON.parse(json)); },
    saveMetadata: async (json) => { fake.metadata.push(JSON.parse(json)); },
    readStore: async () => JSON.stringify(fake.store),
    rollBackToEmbedded: async (commitTime) => { fake.rollbacks.push(commitTime); },
    markLaunched: async () => { fake.calls.push("markLaunched"); },
    reload: async () => { fake.calls.push("reload"); },
    ...overrides,
  });
  return { ...fake, native };
}

const respond = (...responses: Response[]): { fetch: FetchLike; requests: { url: string; headers: Record<string, string> }[] } => {
  const requests: { url: string; headers: Record<string, string> }[] = [];
  const queue = [...responses];
  return { requests, fetch: async (url, init) => { requests.push({ url, headers: init.headers }); const next = queue.shift(); if (!next) throw new Error("unexpected request"); return next; } };
};

describe("without updates", () => {
  test("no native module: nothing is enabled and every call resolves without a request", async () => {
    const updates = createUpdates({ native: null, fetch: async () => { throw new Error("no request expected"); } });
    expect(updates).toMatchObject({ isEnabled: false, updateId: null, channel: null, runtimeVersion: null });
    expect(await updates.checkForUpdateAsync()).toEqual({ isAvailable: false, manifest: undefined, isRollBackToEmbedded: false, reason: "updatesDisabled" });
    expect(await updates.fetchUpdateAsync()).toEqual({ isNew: false, manifest: undefined, isRollBackToEmbedded: false });
    await updates.reloadAsync();
    await updates.checkOnLaunch();
  });
  test("a development build's module reports disabled and behaves the same", async () => {
    const { native, calls } = fakeNative({ isEnabled: false, updateId: UPDATE_ID, runtimeVersion: "1" });
    const updates = createUpdates({ native, fetch: async () => { throw new Error("no request expected"); } });
    expect(updates).toMatchObject({ isEnabled: false, updateId: null, channel: null, runtimeVersion: null });
    expect((await updates.checkForUpdateAsync()).reason).toBe("updatesDisabled");
    await updates.reloadAsync();
    expect(calls).toEqual([]);
  });
});

describe("configuration", () => {
  test("the running update, the channel and the runtime version", () => {
    const { native } = fakeNative({ updateId: UPDATE_ID.toUpperCase(), isEmbeddedLaunch: false });
    const updates = createUpdates({ native, fetch: respond().fetch });
    expect(updates).toMatchObject({ isEnabled: true, updateId: UPDATE_ID, channel: "production", runtimeVersion: "0.1.0" });
  });
  test("a build without a channel header has no channel", () => {
    const updates = createUpdates({ native: fakeNative({ requestHeaders: {} }).native, fetch: respond().fetch });
    expect(updates.channel).toBeNull();
  });
});

describe("checkForUpdateAsync", () => {
  const check = async (response: Response, overrides: Partial<SvelteUpdatesNative> = {}, store: Partial<StoreSnapshot> = {}) => {
    const { native } = fakeNative(overrides, store);
    return createUpdates({ native, fetch: respond(response).fetch }).checkForUpdateAsync();
  };

  test("a newer update is available with its manifest", async () => {
    expect(await check(manifestResponse())).toEqual({ isAvailable: true, manifest, isRollBackToEmbedded: false, reason: undefined });
  });
  test("the request names the channel, platform, runtime version, stored headers and recent failures", async () => {
    const { native } = fakeNative(
      { updateId: "11111111-1111-1111-1111-111111111111", isEmbeddedLaunch: false },
      { failedIds: ["bad-1"], metadata: { serverDefinedHeaders: { "x-rollout": 3 }, manifestFilters: null }, updates: { "11111111-1111-1111-1111-111111111111": { id: "11111111-1111-1111-1111-111111111111", createdAt: embeddedAt, runtimeVersion: "0.1.0", status: "ready", metadata: {} } } },
    );
    const { fetch, requests } = respond(directiveResponse(noUpdateDirective));
    await createUpdates({ native, fetch }).checkForUpdateAsync();
    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe("https://u.expo.dev/bb048172-896f-48f1-97c0-c9ec765842c0");
    expect(requests[0]?.headers).toMatchObject({
      "expo-channel-name": "production",
      "expo-platform": "android",
      "expo-runtime-version": "0.1.0",
      "expo-protocol-version": "1",
      "expo-current-update-id": "11111111-1111-1111-1111-111111111111",
      "expo-recent-failed-update-ids": '"bad-1"',
      "x-rollout": "3",
      "eas-client-id": "client-1",
    });
  });
  test("an embedded launch sends no current update id", async () => {
    const { native } = fakeNative();
    const { fetch, requests } = respond(emptyResponse());
    await createUpdates({ native, fetch }).checkForUpdateAsync();
    expect(requests[0]?.headers["expo-current-update-id"]).toBeUndefined();
  });
  test("nothing on the server", async () => {
    for (const response of [directiveResponse(noUpdateDirective), emptyResponse(), new Response(multipart([]), { headers: responseHeaders })]) {
      expect(await check(response)).toMatchObject({ isAvailable: false, isRollBackToEmbedded: false, reason: "noUpdateAvailableOnServer" });
    }
  });
  // The selection policy itself is `protocol.test.ts`'s ("selection"); here is what the client hands it: the embedded bundle's date and the running update from the store, the
  // runtime version, and the filters of the response.
  const running = "22222222-2222-2222-2222-222222222222";
  const rejected: [string, () => Promise<unknown>][] = [
    ["is not newer than the embedded bundle", () => check(manifestResponse(), {}, { embeddedCreatedAt: Date.parse(CREATED_AT) + 1 })],
    ["is as old as the embedded bundle", () => check(manifestResponse(), {}, { embeddedCreatedAt: Date.parse(CREATED_AT) })],
    ["is not newer than the running update, even when the embedded bundle is older", () => check(manifestResponse(), { updateId: running, isEmbeddedLaunch: false }, { updates: { [running]: { id: running, createdAt: Date.parse(CREATED_AT) + 1000, runtimeVersion: "0.1.0", status: "ready" as const, metadata: {} } } })],
    ["is for another runtime version", () => check(manifestResponse({ ...manifest, runtimeVersion: "0.2.0" }))],
    ["has metadata the server's filters disagree with", () => check(new Response(multipart([{ name: "manifest", json: { ...manifest, metadata: { branchName: "staging" } } }]), { headers: responseHeaders }))],
  ];
  test.each(rejected)("an update that %s is rejected by the selection policy", async (_name, run) => {
    expect(await run()).toMatchObject({ isAvailable: false, reason: "updateRejectedBySelectionPolicy" });
  });
  test("an update that already failed to launch here is not offered again", async () => {
    expect(await check(manifestResponse(), {}, { failedIds: [UPDATE_ID] })).toMatchObject({ isAvailable: false, reason: "updatePreviouslyFailed" });
    expect(await check(manifestResponse(), {}, { updates: { [UPDATE_ID]: { id: UPDATE_ID, createdAt: 0, runtimeVersion: "0.1.0", status: "failed", metadata: {} } } })).toMatchObject({ reason: "updatePreviouslyFailed" });
  });
  test("a rollback to the embedded bundle", async () => {
    expect(await check(directiveResponse(rollBackDirective))).toEqual({ isAvailable: false, manifest: undefined, isRollBackToEmbedded: true, reason: undefined });
  });
  test("a rollback is refused without an embedded bundle, or when it is not newer than what runs", async () => {
    expect(await check(directiveResponse(rollBackDirective), { hasEmbeddedUpdate: false })).toMatchObject({ isAvailable: false, isRollBackToEmbedded: false, reason: "rollbackNoEmbeddedConfiguration" });
    expect(await check(directiveResponse(rollBackDirective), {}, { embeddedCreatedAt: Date.parse("2026-10-22T08:30:00.000Z") })).toMatchObject({ reason: "rollbackRejectedBySelectionPolicy" });
  });
  test("request and response errors reject", async () => {
    const { native } = fakeNative();
    await expect(createUpdates({ native, fetch: respond(new Response("down", { status: 503 })).fetch }).checkForUpdateAsync()).rejects.toThrow("status 503");
    await expect(createUpdates({ native, fetch: async () => { throw new Error("offline"); } }).checkForUpdateAsync()).rejects.toThrow("offline");
  });
});

describe("fetchUpdateAsync", () => {
  test("downloads the launch asset and every asset, then commits the update and the server's metadata", async () => {
    const fake = fakeNative();
    const { fetch } = respond(manifestResponse());
    const result = await createUpdates({ native: fake.native, fetch }).fetchUpdateAsync();
    expect(result).toEqual({ isNew: true, manifest, isRollBackToEmbedded: false });
    expect(fake.downloads.map((download) => [download.key, download.launch, download.extension])).toEqual([[launchAsset.key, true, ""], [logo.key, false, ".png"], [logo2x.key, false, ".png"]]);
    expect(fake.downloads.every((download) => download.updateId === UPDATE_ID)).toBe(true);
    expect(fake.downloads[1]).toMatchObject({ url: logo.url, hash: logo.hash });
    expect(fake.downloads[1]?.headers).toMatchObject({ authorization: "Bearer asset-token", "x-asset": "7", "expo-requested-update-id": UPDATE_ID, "expo-platform": "android" });
    expect(fake.downloads[2]?.headers.authorization).toBeUndefined();
    expect(fake.commits).toEqual([{
      id: UPDATE_ID,
      createdAt: Date.parse(CREATED_AT),
      runtimeVersion: "0.1.0",
      metadata: { branchName: "production" },
      launchAssetKey: launchAsset.key,
      assets: [{ key: launchAsset.key, extension: "" }, { key: logo.key, extension: ".png" }, { key: logo2x.key, extension: ".png" }],
    }]);
    expect(fake.metadata).toEqual([{ serverDefinedHeaders: { "expo-channel-name": "production", rollout: 3 }, manifestFilters: { branchname: "production" } }]);
  });
  test("a download whose hash is not the manifest's is never committed", async () => {
    const fake = fakeNative({}, {}, (download) => (download.key === logo.key ? "x".repeat(43) : download.hash));
    await expect(createUpdates({ native: fake.native, fetch: respond(manifestResponse()).fetch }).fetchUpdateAsync()).rejects.toThrow("failed verification");
    expect(fake.commits).toEqual([]);
    expect(fake.metadata).toEqual([]);
  });
  test("a failed download stops the run and commits nothing", async () => {
    const fake = fakeNative({ downloadAsset: async () => { throw new Error("connection reset"); } });
    await expect(createUpdates({ native: fake.native, fetch: respond(manifestResponse()).fetch, concurrency: 1 }).fetchUpdateAsync()).rejects.toThrow("connection reset");
    expect(fake.commits).toEqual([]);
  });
  test("downloads run at most `concurrency` at a time", async () => {
    let active = 0;
    let peak = 0;
    const fake = fakeNative({
      downloadAsset: async (download) => { active++; peak = Math.max(peak, active); await new Promise((done) => setTimeout(done, 5)); active--; return { key: download.key, hash: download.hash }; },
    });
    await createUpdates({ native: fake.native, fetch: respond(manifestResponse()).fetch, concurrency: 2 }).fetchUpdateAsync();
    expect(peak).toBe(2);
    expect(fake.commits).toHaveLength(1);
  });
  test("an update that is already stored and ready is not downloaded again", async () => {
    const fake = fakeNative({}, { updates: { [UPDATE_ID]: { id: UPDATE_ID, createdAt: Date.parse(CREATED_AT), runtimeVersion: "0.1.0", status: "ready", metadata: {} } } });
    const result = await createUpdates({ native: fake.native, fetch: respond(manifestResponse()).fetch }).fetchUpdateAsync();
    expect(result.isNew).toBe(true);
    expect(fake.downloads).toEqual([]);
    expect(fake.commits).toEqual([]);
  });
  test("a response with nothing new still stores its headers", async () => {
    const fake = fakeNative();
    const result = await createUpdates({ native: fake.native, fetch: respond(directiveResponse(noUpdateDirective)).fetch }).fetchUpdateAsync();
    expect(result).toEqual({ isNew: false, manifest: undefined, isRollBackToEmbedded: false });
    expect(fake.downloads).toEqual([]);
    expect(fake.metadata).toHaveLength(1);
  });
  test("a header the response lacks keeps the stored value: nothing is saved for it", async () => {
    const directive = multipart([{ name: "directive", json: noUpdateDirective }]);
    const bare = fakeNative();
    await createUpdates({ native: bare.native, fetch: respond(new Response(directive, { headers: { "content-type": responseHeaders["content-type"], "expo-protocol-version": "1" } })).fetch }).fetchUpdateAsync();
    expect(bare.metadata).toEqual([]);
    const filtersOnly = fakeNative();
    const headers = { "content-type": responseHeaders["content-type"], "expo-protocol-version": "1", "expo-manifest-filters": 'branchname="staging"' };
    await createUpdates({ native: filtersOnly.native, fetch: respond(new Response(directive, { headers })).fetch }).fetchUpdateAsync();
    expect(filtersOnly.metadata).toEqual([{ serverDefinedHeaders: null, manifestFilters: { branchname: "staging" } }]);
  });
  test("a rollback tells the store to prefer the embedded bundle from the directive's commit time", async () => {
    const fake = fakeNative();
    const result = await createUpdates({ native: fake.native, fetch: respond(directiveResponse(rollBackDirective)).fetch }).fetchUpdateAsync();
    expect(result).toEqual({ isNew: false, manifest: undefined, isRollBackToEmbedded: true });
    expect(fake.rollbacks).toEqual([Date.parse("2026-10-22T08:30:00.000Z")]);
    expect(fake.downloads).toEqual([]);
  });
  test("an update that is rejected downloads nothing", async () => {
    const fake = fakeNative({}, { embeddedCreatedAt: Date.parse(CREATED_AT) + 1 });
    expect((await createUpdates({ native: fake.native, fetch: respond(manifestResponse()).fetch }).fetchUpdateAsync()).isNew).toBe(false);
    expect(fake.downloads).toEqual([]);
  });
  test("concurrent calls share one request, and a later call starts a new one", async () => {
    const fake = fakeNative();
    const { fetch, requests } = respond(manifestResponse(), directiveResponse(noUpdateDirective));
    const updates = createUpdates({ native: fake.native, fetch });
    const [first, second] = await Promise.all([updates.fetchUpdateAsync(), updates.fetchUpdateAsync()]);
    expect(second).toBe(first);
    expect(requests).toHaveLength(1);
    await updates.fetchUpdateAsync();
    expect(requests).toHaveLength(2);
  });
});

describe("reload and launch check", () => {
  test("reloadAsync asks the native side to reload", async () => {
    const fake = fakeNative();
    await createUpdates({ native: fake.native, fetch: respond().fetch }).reloadAsync();
    expect(fake.calls).toEqual(["reload"]);
  });
  test("the launch check fetches only when the build says ALWAYS", async () => {
    for (const mode of ["NEVER", "WIFI_ONLY", "ERROR_RECOVERY_ONLY"] as const) {
      const fake = fakeNative({ checkOnLaunch: mode });
      const { fetch, requests } = respond();
      await createUpdates({ native: fake.native, fetch }).checkOnLaunch();
      expect(requests).toEqual([]);
    }
    const fake = fakeNative();
    const messages: string[] = [];
    await createUpdates({ native: fake.native, fetch: respond(manifestResponse()).fetch, log: (message) => messages.push(message) }).checkOnLaunch();
    expect(fake.commits).toHaveLength(1);
    expect(messages[0]).toContain(UPDATE_ID);
  });
  test("every outcome of the launch check is logged, so a finished check differs from one that never ran", async () => {
    const run = async (response: Response, store: Partial<StoreSnapshot> = {}) => {
      const messages: string[] = [];
      await createUpdates({ native: fakeNative({}, store).native, fetch: respond(response).fetch, log: (message) => messages.push(message) }).checkOnLaunch();
      return messages;
    };
    expect(await run(manifestResponse())).toEqual([`Update ${UPDATE_ID} downloaded; it launches on the next start`]);
    expect(await run(directiveResponse(noUpdateDirective))).toEqual(["No update to download (noUpdateAvailableOnServer)"]);
    expect(await run(directiveResponse(rollBackDirective))).toEqual(["Rolled back to the embedded bundle; it launches on the next start"]);
    // A newer update that failed to launch is named as such: the proof that the blocklist, not the server, kept it out.
    expect(await run(manifestResponse(), { failedIds: [UPDATE_ID] })).toEqual(["No update to download (updatePreviouslyFailed)"]);
  });
  test("a bad update stays out across launches: it is neither downloaded nor committed again", async () => {
    const fake = fakeNative({}, { failedIds: [UPDATE_ID] });
    const { fetch, requests } = respond(manifestResponse(), manifestResponse(), manifestResponse());
    const updates = createUpdates({ native: fake.native, fetch });
    for (let launch = 0; launch < 3; launch++) await updates.checkOnLaunch();
    expect(requests).toHaveLength(3);
    expect(requests.every((request) => request.headers["expo-recent-failed-update-ids"] === `"${UPDATE_ID}"`)).toBe(true);
    expect(fake.downloads).toEqual([]);
    expect(fake.commits).toEqual([]);
  });
  test("the failed list changes between launches: an update is fetched until the store fails it, never after, and a newer one still is", async () => {
    const fake = fakeNative();
    const launch = async (response: Response) => {
      const messages: string[] = [];
      // Every launch is a new process: a new client over whatever the store holds by then.
      await createUpdates({ native: fake.native, fetch: respond(response).fetch, log: (message) => messages.push(message) }).checkOnLaunch();
      return messages;
    };
    const newer = "33333333-3333-3333-3333-333333333333";
    const newerManifest = { ...manifest, id: newer, createdAt: "2026-10-23T00:00:00.000Z" };
    expect(await launch(manifestResponse())).toEqual([`Update ${UPDATE_ID} downloaded; it launches on the next start`]);
    // The next start found it unconfirmed with a fatal: the store fails it and lists it.
    Object.assign(fake.store, { failedIds: [UPDATE_ID], updates: { [UPDATE_ID]: { id: UPDATE_ID, createdAt: Date.parse(CREATED_AT), runtimeVersion: "0.1.0", status: "failed" as const, metadata: {} } } });
    expect(await launch(manifestResponse())).toEqual(["No update to download (updatePreviouslyFailed)"]);
    // The list keeps the newest five ids; the record stays failed after its id has scrolled out of it.
    fake.store.failedIds = ["a", "b", "c", "d", "e"];
    expect(await launch(manifestResponse())).toEqual(["No update to download (updatePreviouslyFailed)"]);
    // A newer update is a different id and is fetched.
    expect(await launch(manifestResponse(newerManifest))).toEqual([`Update ${newer} downloaded; it launches on the next start`]);
    // The same store without the record at all (a reset) offers the old one again.
    Object.assign(fake.store, { failedIds: [], updates: {} });
    expect(await launch(manifestResponse())).toEqual([`Update ${UPDATE_ID} downloaded; it launches on the next start`]);
    expect(fake.commits.map((committed) => committed.id)).toEqual([UPDATE_ID, newer, UPDATE_ID]);
  });
  test("a failing launch check is logged, not thrown", async () => {
    const logged: unknown[] = [];
    await createUpdates({ native: fakeNative().native, fetch: async () => { throw new Error("offline"); }, log: (_message, error) => logged.push(error) }).checkOnLaunch();
    expect((logged[0] as Error).message).toBe("offline");
  });
});

describe("native request as fetch", () => {
  test("status, case-insensitive headers and body", async () => {
    const fetch = nativeFetch({ request: async (url, headers) => ({ status: 200, headers: { "content-type": "application/json", "x-url": url, "x-sent": headers.a ?? "" }, body: "{}" }) });
    const response = await fetch("https://example.test/m", { method: "GET", headers: { a: "1" } });
    expect(response.ok).toBe(true);
    expect(response.headers.get("Content-Type")).toBe("application/json");
    expect(response.headers.get("x-url")).toBe("https://example.test/m");
    expect(response.headers.get("x-sent")).toBe("1");
    expect(response.headers.get("missing")).toBeNull();
    expect(await response.text()).toBe("{}");
    const failed = await nativeFetch({ request: async () => ({ status: 500, headers: {}, body: "" }) })("u", { method: "GET", headers: {} });
    expect(failed.ok).toBe(false);
  });
});

describe("image sources of an update", () => {
  type Resolved = string;
  const resolver = (asset: { fileHashes?: string[]; scales: number[] }): SourceResolver<Resolved> => ({
    asset,
    fromSource: (uri) => `source:${uri}`,
    defaultAsset: () => "default",
    resourceIdentifierWithoutScale: () => "drawable",
  });
  const transform = (platform: "android" | "ios", pick = (scales: number[]) => scales[scales.length - 1] ?? 1) =>
    createAssetTransformer<Resolved>({ localAssets: { h1: "file:///store/h1.png", h2: "file:///store/h2.png" }, platform, pickScale: pick });

  test("the picked scale's hash maps to its downloaded file", () => {
    expect(transform("android")(resolver({ scales: [1, 2], fileHashes: ["h1", "h2"] }))).toBe("source:file:///store/h2.png");
    expect(transform("android", () => 1)(resolver({ scales: [1, 2], fileHashes: ["h1", "h2"] }))).toBe("source:file:///store/h1.png");
  });
  test("a scale without its own hash falls back to the first file", () => {
    expect(transform("ios", () => 3)(resolver({ scales: [1, 2], fileHashes: ["h1"] }))).toBe("source:file:///store/h1.png");
  });
  test("assets the update does not carry resolve to the app binary's resource on Android and to the default elsewhere", () => {
    expect(transform("android")(resolver({ scales: [1], fileHashes: ["unknown"] }))).toBe("drawable");
    expect(transform("ios")(resolver({ scales: [1], fileHashes: ["unknown"] }))).toBe("default");
  });
  test("an asset registered without hashes keeps the default resolution", () => {
    expect(transform("android")(resolver({ scales: [1] }))).toBe("default");
  });
});

describe("pending: whether an update is waiting for the next start (what `updated` of $app/state reads)", () => {
  const seen = (updates: ReturnType<typeof createUpdates>) => { const log: boolean[] = []; updates.onPending(() => log.push(updates.pending)); return log; };

  test("it is false until a check finds an update, then true, and the listener hears the change once", async () => {
    const { native } = fakeNative();
    const updates = createUpdates({ native, fetch: respond(manifestResponse(), manifestResponse()).fetch });
    const log = seen(updates);
    expect(updates.pending).toBe(false);
    await updates.checkForUpdateAsync();
    expect(updates.pending).toBe(true);
    await updates.checkForUpdateAsync(); // still there: no change to report
    expect(log).toEqual([true]);
  });

  test("a check that finds nothing, or an update that cannot launch, leaves it false; a rollback to the embedded bundle is an update to wait for", async () => {
    for (const response of [directiveResponse(noUpdateDirective), manifestResponse({ ...manifest, runtimeVersion: "0.2.0" })]) {
      const updates = createUpdates({ native: fakeNative().native, fetch: respond(response).fetch });
      await updates.checkForUpdateAsync();
      expect(updates.pending).toBe(false);
    }
    const rollback = createUpdates({ native: fakeNative().native, fetch: respond(directiveResponse(rollBackDirective)).fetch });
    await rollback.checkForUpdateAsync();
    expect(rollback.pending).toBe(true);
  });

  test("a fetch that downloaded an update (or the check at launch, which fetches) sets it, with no check before", async () => {
    const updates = createUpdates({ native: fakeNative().native, fetch: respond(manifestResponse()).fetch });
    const log = seen(updates);
    await updates.fetchUpdateAsync();
    expect(updates.pending).toBe(true);
    expect(log).toEqual([true]);

    const launch = createUpdates({ native: fakeNative({ checkOnLaunch: "ALWAYS" }).native, fetch: respond(manifestResponse()).fetch });
    await launch.checkOnLaunch();
    expect(launch.pending).toBe(true);
  });

  test("a fetch that fails (an asset's hash is wrong, the server is down) leaves it as it was", async () => {
    const tampered = createUpdates({ native: fakeNative({}, {}, () => "wrong").native, fetch: respond(manifestResponse()).fetch });
    await expect(tampered.fetchUpdateAsync()).rejects.toThrow();
    expect(tampered.pending).toBe(false);
    const down = createUpdates({ native: fakeNative().native, fetch: async () => { throw new Error("offline"); } });
    await expect(down.checkForUpdateAsync()).rejects.toThrow("offline");
    expect(down.pending).toBe(false);
  });

  test("with updates off it is false, and a listener that stopped is not called", async () => {
    const off = createUpdates({ native: null, fetch: async () => { throw new Error("no request expected"); } });
    await off.checkForUpdateAsync();
    await off.fetchUpdateAsync();
    expect(off.pending).toBe(false);
    const updates = createUpdates({ native: fakeNative().native, fetch: respond(manifestResponse()).fetch });
    const calls: number[] = [];
    const stop = updates.onPending(() => calls.push(1));
    stop();
    await updates.checkForUpdateAsync();
    expect(calls).toEqual([]);
  });
});
