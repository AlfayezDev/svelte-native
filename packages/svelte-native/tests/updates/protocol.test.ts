import { describe, expect, test } from "bun:test";
import { dispositionName, multipartBoundary, parseMultipart } from "../../src/updates/multipart.ts";
import {
  assetsToDownload,
  buildAssetRequestHeaders,
  buildManifestRequest,
  matchesFilters,
  parseDirective,
  parseManifest,
  parseUpdateResponse,
  requestUpdate,
  shouldApplyRollBack,
  shouldLoadNewUpdate,
  verifyDownloadedAssets,
  type RequestContext,
} from "../../src/updates/protocol.ts";
import { parseDictionary, serializeStringDictionary, serializeStringList } from "../../src/updates/structured-headers.ts";
import {
  BOUNDARY, CREATED_AT, UPDATE_ID, bundleBytes, directiveResponse, emptyResponse, extensions, imageBytes, launchAsset, logo, logo2x, manifest, manifestResponse,
  md5, multipart, noUpdateDirective, responseHeaders, rollBackDirective, sha256,
} from "./support/eas.ts";

describe("structured headers", () => {
  test("a dictionary keeps strings, numbers and booleans and drops the rest", () => {
    expect(parseDictionary('branchname="production", rollout=3, beta, off=?0, ratio=0.5, neg=-2')).toEqual({ branchname: "production", rollout: 3, beta: true, off: false, ratio: 0.5, neg: -2 });
    expect(parseDictionary('token=abc, list=(1 2), bytes=:aGk=:, name="x";p=1, last=?1')).toEqual({ name: "x", last: true });
  });
  test("string escapes", () => {
    expect(parseDictionary('quote="a\\"b", slash="c\\\\d"')).toEqual({ quote: 'a"b', slash: "c\\d" });
  });
  test("an empty header is an empty dictionary and a malformed one is null", () => {
    expect(parseDictionary("")).toEqual({});
    for (const bad of ['a="unterminated', "a=1,", "A=1", 'a="x" b="y"', 'a="bad\\n"', "a=?2", "=1"]) expect(parseDictionary(bad)).toBeNull();
  });
  test("lists and dictionaries of strings serialize with escapes", () => {
    expect(serializeStringList(["a", 'b"c', "d\\e"])).toBe('"a", "b\\"c", "d\\\\e"');
    expect(serializeStringList([])).toBe("");
    expect(serializeStringDictionary({ one: "1", "two-x": "a b" })).toBe('one="1", two-x="a b"');
    expect(() => serializeStringList(["é"])).toThrow();
    expect(() => serializeStringDictionary({ Bad: "x" })).toThrow();
  });
});

describe("multipart", () => {
  test("boundary from the content type, quoted or not", () => {
    expect(multipartBoundary(`multipart/mixed; boundary=${BOUNDARY}`)).toBe(BOUNDARY);
    expect(multipartBoundary('multipart/mixed; charset=utf-8; boundary="a b"')).toBe("a b");
    expect(multipartBoundary("application/json")).toBeNull();
    expect(multipartBoundary(null)).toBeNull();
    expect(multipartBoundary("multipart/mixed")).toBeNull();
  });
  test("the name parameter of a disposition", () => {
    expect(dispositionName('form-data; name="manifest"')).toBe("manifest");
    expect(dispositionName("inline; name=directive")).toBe("directive");
    expect(dispositionName("inline; name='extensions'")).toBe("extensions");
    expect(dispositionName('attachment; filename="a.txt"')).toBeNull();
    expect(dispositionName('form-data; name="first"; name="second"')).toBe("first");
  });
  test("parts keep their headers and bodies; unnamed parts are skipped; preamble and epilogue are ignored", () => {
    const body = `preamble\r\n--b\r\nContent-Disposition: form-data; name="manifest"\r\nContent-Type: application/json\r\nexpo-signature: sig="x"\r\n\r\n{"a":1}\r\n--b\r\nContent-Type: text/plain\r\n\r\nno name\r\n--b\r\ncontent-disposition: inline; name="directive"\r\n\r\n\r\n--b--\r\nepilogue`;
    const parts = parseMultipart("multipart/mixed; boundary=b", body);
    expect(parts.map((part) => part.name)).toEqual(["manifest", "directive"]);
    expect(parts[0]?.body).toBe('{"a":1}');
    expect(parts[0]?.headers).toEqual({ "content-disposition": 'form-data; name="manifest"', "content-type": "application/json", "expo-signature": 'sig="x"' });
    expect(parts[1]?.body).toBe("");
  });
  test("a body that contains the boundary text inside a line is not split there", () => {
    const parts = parseMultipart("multipart/mixed; boundary=b", 'preamble --b\r\n--b\r\ncontent-disposition: inline; name="manifest"\r\n\r\nx--b y\r\n--b--\r\n');
    expect(parts.map((part) => part.body)).toEqual(["x--b y"]);
  });
  test("an empty multipart body has no parts and an unclosed one throws", () => {
    expect(parseMultipart("multipart/mixed; boundary=b", "--b--\r\n")).toEqual([]);
    expect(parseMultipart("multipart/mixed; boundary=b", "")).toEqual([]);
    expect(() => parseMultipart("multipart/mixed; boundary=b", '--b\r\ncontent-disposition: inline; name="x"\r\n\r\nbody')).toThrow("not closed");
    expect(() => parseMultipart("multipart/mixed; boundary=b", "garbage")).toThrow("opening delimiter");
    expect(() => parseMultipart("application/json", "{}")).toThrow("not multipart");
  });
});

const context: RequestContext = {
  updateUrl: "https://u.expo.dev/bb048172-896f-48f1-97c0-c9ec765842c0",
  platform: "android",
  runtimeVersion: "0.1.0",
  requestHeaders: { "expo-channel-name": "production" },
  clientId: "11111111-2222-3333-4444-555555555555",
  currentUpdateId: null,
  embeddedUpdateId: null,
  recentFailedUpdateIds: [],
  serverDefinedHeaders: null,
};

describe("manifest request", () => {
  test("carries the protocol headers, runtime version, channel and client id", () => {
    expect(buildManifestRequest(context)).toEqual({
      url: context.updateUrl,
      headers: {
        accept: "multipart/mixed,application/expo+json,application/json",
        "expo-platform": "android",
        "expo-protocol-version": "1",
        "expo-api-version": "1",
        "expo-updates-environment": "BARE",
        "expo-json-error": "true",
        "eas-client-id": "11111111-2222-3333-4444-555555555555",
        "expo-runtime-version": "0.1.0",
        "expo-channel-name": "production",
      },
    });
  });
  test("names the running update, the recent failures, server-defined headers and extra params", () => {
    const { headers } = buildManifestRequest({
      ...context,
      platform: "ios",
      currentUpdateId: UPDATE_ID.toUpperCase(),
      embeddedUpdateId: "AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE",
      recentFailedUpdateIds: ["a1", "b2"],
      serverDefinedHeaders: { "x-rollout": 3, "x-beta": true, "Expo-Channel-Name": "staging", accept: "text/plain" },
      extraParams: { tier: "gold" },
    });
    expect(headers["expo-current-update-id"]).toBe(UPDATE_ID);
    expect(headers["expo-embedded-update-id"]).toBe("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
    expect(headers["expo-recent-failed-update-ids"]).toBe('"a1", "b2"');
    expect(headers["expo-extra-params"]).toBe('tier="gold"');
    expect(headers["x-rollout"]).toBe("3");
    expect(headers["x-beta"]).toBe("true");
    expect(headers["expo-platform"]).toBe("ios");
    // Protocol headers replace server-defined ones, and the build-time channel replaces everything.
    expect(headers.accept).toBe("multipart/mixed,application/expo+json,application/json");
    expect(headers["expo-channel-name"]).toBe("production");
  });
  test("no current update id for an embedded launch and no failure header when nothing failed", () => {
    const { headers } = buildManifestRequest(context);
    expect(headers["expo-current-update-id"]).toBeUndefined();
    expect(headers["expo-recent-failed-update-ids"]).toBeUndefined();
  });
  test("asset requests: per-asset headers first, then protocol identity", () => {
    const asset = parseManifest(manifest, extensions).assets[0];
    if (!asset) throw new Error("fixture has assets");
    const headers = buildAssetRequestHeaders(asset, { platform: "android", clientId: "c", requestHeaders: { "expo-channel-name": "production" }, currentUpdateId: null, embeddedUpdateId: null, requestedUpdateId: UPDATE_ID });
    expect(headers).toEqual({
      authorization: "Bearer asset-token",
      "x-asset": "7",
      "expo-requested-update-id": UPDATE_ID,
      "expo-platform": "android",
      "expo-protocol-version": "1",
      "expo-api-version": "1",
      "expo-updates-environment": "BARE",
      "eas-client-id": "c",
      "expo-channel-name": "production",
    });
  });
});

describe("manifest", () => {
  test("parses the EAS shape", () => {
    const parsed = parseManifest(manifest, extensions);
    expect(parsed.id).toBe(UPDATE_ID);
    expect(parsed.createdAt).toBe(Date.parse(CREATED_AT));
    expect(parsed.runtimeVersion).toBe("0.1.0");
    expect(parsed.launchAsset).toMatchObject({ key: launchAsset.key, hash: launchAsset.hash, fileExtension: null, headers: {} });
    expect(parsed.assets.map((asset) => [asset.key, asset.fileExtension])).toEqual([[logo.key, ".png"], [logo2x.key, ".png"]]);
    expect(parsed.assets[0]?.headers).toEqual({ authorization: "Bearer asset-token", "x-asset": "7" });
    expect(parsed.assets[1]?.headers).toEqual({});
    expect(parsed.metadata).toEqual({ branchName: "production" });
    expect(parsed.raw).toBe(manifest);
  });
  test("ids are normalized to lowercase and assets and metadata are optional", () => {
    const parsed = parseManifest({ ...manifest, id: UPDATE_ID.toUpperCase(), assets: undefined, metadata: undefined });
    expect(parsed.id).toBe(UPDATE_ID);
    expect(parsed.assets).toEqual([]);
    expect(parsed.metadata).toEqual({});
  });
  test("a manifest that cannot be trusted is rejected", () => {
    const withLaunch = (changes: object) => ({ ...manifest, launchAsset: { ...launchAsset, ...changes } });
    const withAsset = (changes: object) => ({ ...manifest, assets: [{ ...logo, ...changes }] });
    const rejects: [string, unknown][] = [
      ["id", { ...manifest, id: "not-a-uuid" }],
      ["createdAt", { ...manifest, createdAt: "yesterday" }],
      ["runtimeVersion", { ...manifest, runtimeVersion: "" }],
      ["launchAsset", { ...manifest, launchAsset: undefined }],
      ["hash", withLaunch({ hash: undefined })],
      ["hash", withLaunch({ hash: "cb65fafb5ed456fc3ed8a726cf4087d37b875184eba96f33f6d99104e6e2266d" })],
      ["hash", withAsset({ hash: `${logo.hash}=` })],
      ["url", withLaunch({ url: "file:///data/data/app/secret" })],
      ["url", withAsset({ url: "content://media/1" })],
      ["key", withAsset({ key: "../../index.json" })],
      ["key", withLaunch({ key: "a/b" })],
      ["fileExtension", withAsset({ fileExtension: undefined })],
      ["fileExtension", withAsset({ fileExtension: ".png/../x" })],
      ["assets", { ...manifest, assets: {} }],
    ];
    for (const [field, value] of rejects) expect(() => parseManifest(value), field).toThrow();
    expect(() => parseManifest(null)).toThrow();
    expect(() => parseManifest([])).toThrow();
  });
  test("asset hashes are SHA-256 in base64url and keys are MD5, as the exporter writes them", () => {
    expect(launchAsset.hash).toBe(sha256(bundleBytes));
    expect(logo.hash).toBe(sha256(imageBytes));
    expect(logo.hash).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(logo.key).toBe(md5(imageBytes));
    // The SHA-256 of "abc" is the RFC 6234 test vector.
    expect(sha256("abc")).toBe("ungWv48Bz-pBQUDeXa4iI7ADYaOWF3qctBD_YfIAFa0");
  });
});

describe("directives", () => {
  test("both kinds", () => {
    expect(parseDirective(noUpdateDirective)).toEqual({ type: "noUpdateAvailable" });
    expect(parseDirective(rollBackDirective)).toEqual({ type: "rollBackToEmbedded", commitTime: Date.parse("2026-10-22T08:30:00.000Z") });
  });
  test("an unknown type or a rollback without a commit time is an error", () => {
    expect(() => parseDirective({ type: "somethingElse" })).toThrow("Invalid directive type");
    expect(() => parseDirective({ type: "rollBackToEmbedded" })).toThrow();
    expect(() => parseDirective({ type: "rollBackToEmbedded", parameters: { commitTime: "soon" } })).toThrow();
  });
});

describe("responses", () => {
  test("a multipart response with manifest and extensions, and the headers around it", async () => {
    const response = await parseUpdateResponse(manifestResponse());
    expect(response.manifest?.id).toBe(UPDATE_ID);
    expect(response.manifest?.assets[0]?.headers).toEqual({ authorization: "Bearer asset-token", "x-asset": "7" });
    expect(response.directive).toBeNull();
    expect(response.headers).toEqual({ protocolVersion: 1, manifestFilters: { branchname: "production" }, serverDefinedHeaders: { "expo-channel-name": "production", rollout: 3 } });
  });
  test("a bare JSON manifest (application/expo+json)", async () => {
    const response = await parseUpdateResponse(new Response(JSON.stringify(manifest), { headers: { "content-type": "application/expo+json", "expo-protocol-version": "0" } }));
    expect(response.manifest?.id).toBe(UPDATE_ID);
    expect(response.headers.protocolVersion).toBe(0);
  });
  test("directive-only responses", async () => {
    expect((await parseUpdateResponse(directiveResponse(noUpdateDirective))).directive).toEqual({ type: "noUpdateAvailable" });
    const rollback = await parseUpdateResponse(directiveResponse(rollBackDirective));
    expect(rollback.manifest).toBeNull();
    expect(rollback.directive).toEqual({ type: "rollBackToEmbedded", commitTime: Date.parse("2026-10-22T08:30:00.000Z") });
  });
  test("a manifest and a directive can arrive together", async () => {
    const body = multipart([{ name: "manifest", json: manifest }, { name: "directive", json: noUpdateDirective }]);
    const response = await parseUpdateResponse(new Response(body, { headers: responseHeaders }));
    expect(response.manifest?.id).toBe(UPDATE_ID);
    expect(response.directive).toEqual({ type: "noUpdateAvailable" });
  });
  test("an empty multipart body is a response with nothing in it", async () => {
    const response = await parseUpdateResponse(new Response(multipart([]), { headers: responseHeaders }));
    expect(response.manifest).toBeNull();
    expect(response.directive).toBeNull();
  });
  test("204 means nothing new from protocol version 1 on, and is an error before", async () => {
    expect(await parseUpdateResponse(emptyResponse())).toMatchObject({ manifest: null, directive: null });
    await expect(parseUpdateResponse(new Response(null, { status: 204 }))).rejects.toThrow("empty body");
    await expect(parseUpdateResponse(new Response("", { status: 200, headers: { "expo-protocol-version": "0" } }))).rejects.toThrow("empty body");
  });
  test("malformed parts are errors", async () => {
    const response = (parts: Parameters<typeof multipart>[0]) => new Response(multipart(parts), { headers: responseHeaders });
    await expect(parseUpdateResponse(response([{ name: "manifest", json: "{not json" }]))).rejects.toThrow("manifest is not valid JSON");
    await expect(parseUpdateResponse(response([{ name: "manifest", json: manifest }, { name: "extensions", json: "nope" }]))).rejects.toThrow("extensions is not valid JSON");
    await expect(parseUpdateResponse(response([{ name: "directive", json: { type: "other" } }]))).rejects.toThrow("Invalid directive type");
    await expect(parseUpdateResponse(new Response("{", { headers: { "content-type": "application/json" } }))).rejects.toThrow("not valid JSON");
  });
  test("unparseable filter and server-header values become null instead of failing the response", async () => {
    const response = await parseUpdateResponse(new Response(multipart([{ name: "manifest", json: manifest }]), { headers: { ...responseHeaders, "expo-manifest-filters": "A=broken", "expo-server-defined-headers": 'x="' } }));
    expect(response.headers.manifestFilters).toBeNull();
    expect(response.headers.serverDefinedHeaders).toBeNull();
    expect(response.manifest?.id).toBe(UPDATE_ID);
  });
  test("requestUpdate sends the built request and reports the server's error body", async () => {
    const calls: { url: string; headers: Record<string, string> }[] = [];
    const ok = await requestUpdate(async (url, init) => { calls.push({ url, headers: init.headers }); return manifestResponse(); }, context);
    expect(ok.manifest?.id).toBe(UPDATE_ID);
    expect(calls).toEqual([buildManifestRequest(context)]);
    await expect(requestUpdate(async () => new Response('{"errorCode":"NO_UPDATE"}', { status: 404 }), context)).rejects.toThrow('status 404: {"errorCode":"NO_UPDATE"}');
  });
});

describe("selection", () => {
  const at = (iso: string, metadata: Record<string, unknown> = {}) => ({ createdAt: Date.parse(iso), metadata });
  test("filters compare metadata case-insensitively and only where metadata has the key", () => {
    const update = at(CREATED_AT, { branchName: "production", build: 4 });
    expect(matchesFilters(update, null)).toBe(true);
    expect(matchesFilters(update, {})).toBe(true);
    expect(matchesFilters(update, { branchname: "production" })).toBe(true);
    expect(matchesFilters(update, { branchname: "staging" })).toBe(false);
    expect(matchesFilters(update, { other: "x" })).toBe(true);
    expect(matchesFilters(update, { build: 4 })).toBe(true);
    expect(matchesFilters(update, { build: "4" })).toBe(false);
    expect(matchesFilters(at(CREATED_AT), { branchname: "staging" })).toBe(true);
  });
  test("an update is loaded when it is newer than what runs", () => {
    const launched = at("2026-10-20T12:00:00.000Z");
    expect(shouldLoadNewUpdate(at("2026-10-21T00:00:00.000Z"), launched, null)).toBe(true);
    expect(shouldLoadNewUpdate(at("2026-10-20T12:00:00.000Z"), launched, null)).toBe(false);
    expect(shouldLoadNewUpdate(at("2026-10-19T00:00:00.000Z"), launched, null)).toBe(false);
    expect(shouldLoadNewUpdate(at("2026-10-19T00:00:00.000Z"), null, null)).toBe(true);
  });
  test("filters outrank age", () => {
    const filters = { branchname: "production" };
    const newer = at("2026-10-21T00:00:00.000Z", { branchName: "staging" });
    expect(shouldLoadNewUpdate(newer, at("2026-10-20T00:00:00.000Z"), filters)).toBe(false);
    const older = at("2026-10-01T00:00:00.000Z", { branchName: "production" });
    expect(shouldLoadNewUpdate(older, at("2026-10-20T00:00:00.000Z", { branchName: "staging" }), filters)).toBe(true);
  });
  test("a rollback applies when the directive is newer than what runs and the embedded bundle passes the filters", () => {
    const embedded = at("2026-10-01T00:00:00.000Z");
    const launched = at("2026-10-20T00:00:00.000Z");
    expect(shouldApplyRollBack(Date.parse("2026-10-22T00:00:00.000Z"), embedded, launched, null)).toBe(true);
    expect(shouldApplyRollBack(Date.parse("2026-10-19T00:00:00.000Z"), embedded, launched, null)).toBe(false);
    expect(shouldApplyRollBack(Date.parse("2026-10-22T00:00:00.000Z"), at("2026-10-01T00:00:00.000Z", { branchName: "x" }), launched, { branchname: "y" })).toBe(false);
    expect(shouldApplyRollBack(Date.parse("2026-10-19T00:00:00.000Z"), embedded, at("2026-10-20T00:00:00.000Z", { branchName: "x" }), { branchname: "y" })).toBe(true);
    expect(shouldApplyRollBack(1, embedded, null, null)).toBe(true);
  });
});

describe("assets", () => {
  test("the launch asset comes first and each key once", () => {
    const parsed = parseManifest({ ...manifest, assets: [logo, logo, logo2x] });
    expect(assetsToDownload(parsed).map((asset) => asset.key)).toEqual([launchAsset.key, logo.key, logo2x.key]);
  });
  test("downloaded hashes must be the manifest's", () => {
    const assets = assetsToDownload(parseManifest(manifest));
    const good = assets.map((asset) => ({ key: asset.key, hash: asset.hash }));
    expect(() => verifyDownloadedAssets(assets, good)).not.toThrow();
    expect(() => verifyDownloadedAssets(assets, good.map((entry, index) => (index === 1 ? { ...entry, hash: sha256("tampered") } : entry)))).toThrow("failed verification");
    expect(() => verifyDownloadedAssets(assets, good.slice(1))).toThrow("was not downloaded");
  });
});
