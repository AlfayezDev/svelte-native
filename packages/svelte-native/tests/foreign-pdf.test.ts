import { createHash } from "node:crypto";
import { expect, test } from "bun:test";
import { createHarness, find, settle } from "./foreign-harness.ts";
import { parsePdfMessage, sha1 } from "../src/fabric/foreign-pdf.ts";

/**
 * react-native-pdf (SPEC.md, "Foreign views"): `RNPDFPdfView` takes a local `path`, so the component first does what the library's
 * `Pdf` does (a download, a bundled asset, a data URI or a file, with the optional cache) through react-native-blob-util's module,
 * here a fake with a file table; then it mounts the view with the library's props and reads the one string event it sends.
 */
type App = { setSource(source: unknown): void; setPage(page: number): void; eventLog(): unknown[][]; pdfHandle(): { setPage(page: number): void; host: { tag: number } } | null };
type Stat = { size: number; lastModified: number };
const dataUri = "data:application/pdf;base64,JVBERi0xLjQK";

/** react-native-blob-util's TurboModule as the library calls it: callbacks `(error, value)`, files in a table, a log of calls. */
function fakeBlobUtil(responses: Record<string, { headers?: Record<string, string>; size?: number; hold?: boolean; fail?: string }> = {}) {
  const files = new Map<string, Stat>();
  const log: string[] = [];
  const held: { finish(): void; taskId: string }[] = [];
  const module = {
    getConstants: () => ({ CacheDir: "/cache" }),
    stat(path: string, callback: (error: string | null, stat?: Stat) => void) { log.push(`stat ${path}`); const stat = files.get(path); queueMicrotask(() => (stat ? callback(null, { ...stat }) : callback(`failed to stat path \`${path}\` because it does not exist`))); },
    unlink(path: string, callback: (error?: string) => void) { log.push(`unlink ${path}`); queueMicrotask(() => { if (files.delete(path)) callback(); else callback("no such file"); }); },
    cp(source: string, destination: string, callback: (error: string | null, ok?: boolean) => void) {
      log.push(`cp ${source} ${destination}`);
      queueMicrotask(() => { const stat = files.get(source) ?? (source.startsWith("bundle-assets://") ? { size: 9, lastModified: Date.now() } : undefined); if (stat) { files.set(destination, stat); callback(null, true); } else callback("source missing"); });
    },
    writeFile(path: string, encoding: string, data: string) { log.push(`writeFile ${path} ${encoding} ${data}`); files.set(path, { size: data.length, lastModified: Date.now() }); return Promise.resolve(data.length); },
    fetchBlob(options: { path: string; trusty: boolean }, taskId: string, method: string, url: string, headers: object, body: string, callback: (error: string | null, type?: string, data?: string, info?: object) => void) {
      log.push(`fetch ${JSON.stringify(options)} ${method} ${url} ${JSON.stringify(headers)} ${JSON.stringify(body)}`);
      const response = responses[url] ?? {};
      const finish = () => {
        if (response.fail) return callback(response.fail);
        files.set(options.path, { size: response.size ?? 5, lastModified: Date.now() });
        callback(null, "path", options.path, { status: 200, headers: response.headers ?? {} });
      };
      if (response.hold) held.push({ finish, taskId }); else queueMicrotask(finish);
    },
    cancelRequest(taskId: string) { log.push(`cancel ${held.some((entry) => entry.taskId === taskId) ? "held" : "unknown"}`); },
  };
  return { module, files, log, held };
}

async function mount(natives: ReturnType<typeof fakeBlobUtil>, root: number, initial?: unknown, assets: Record<number, { uri: string }> = {}) {
  const harness = createHarness("android", { natives: { turbo: { ReactNativeBlobUtil: natives.module }, assets } });
  const loaded = await harness.load("foreign-pdf-fixture.svelte");
  const app = loaded.startSurface(root, loaded.Fixture, { initial }) as App;
  const views = () => find(harness.roots()[root] ?? [], "RNPDFPdfView");
  const until = async (done: () => boolean) => { for (let turn = 0; turn < 40 && !done(); turn++) await settle(loaded); };
  return { harness, loaded, app, views, until, texts: () => find(harness.roots()[root] ?? [], "RCTRawText").map((node) => node.props.text) };
}
const cacheFileOf = (uri: string) => `/cache/${createHash("sha1").update(uri).digest("hex")}.pdf`;

test("a data URI is written to the cache file named by the hash of the URI, then the view mounts with the library's props and defaults", async () => {
  const natives = fakeBlobUtil();
  const { harness, loaded, app, views, until, texts } = await mount(natives, 91);
  // Until the file is local the `loading` content is shown and nothing is mounted (or announced to the engine).
  expect(views()).toEqual([]);
  expect(texts()).toEqual(["Loading"]);
  await until(() => views().length > 0);
  const cacheFile = cacheFileOf(dataUri);
  expect(natives.log).toEqual([`unlink ${cacheFile}`, `writeFile ${cacheFile} base64 JVBERi0xLjQK`]);
  const [view] = views();
  expect(view.props).toMatchObject({
    path: cacheFile, page: 1, scale: 1, minScale: 1, maxScale: 3, horizontal: true, enablePaging: true, fitPolicy: 0, spacing: 4, password: "pw",
    enableRTL: false, enableAnnotationRendering: true, enableAntialiasing: true, showsHorizontalScrollIndicator: true, showsVerticalScrollIndicator: true,
    scrollEnabled: true, singlePage: false, flex: 1, backgroundColor: 0xffeeeeee | 0, height: 200,
  });
  for (const key of ["source", "loading", "trustAllCerts", "onLoadComplete", "ref", "nativeProps", "component", "onChange"]) expect(key in view.props, key).toBe(false);
  expect(harness.calls.indexOf("engine.registerForeign RNPDFPdfView")).toBeGreaterThanOrEqual(0);
  expect(harness.calls.indexOf("engine.registerForeign RNPDFPdfView")).toBeLessThan(harness.calls.indexOf("create RNPDFPdfView"));
  expect(texts()).toEqual([]);
  expect(loaded.configs.viewConfigFor("RNPDFPdfView", "android").events.get("topChange")).toBe("onChange");

  // A new page is a clone of the same node.
  harness.calls.length = 0;
  app.setPage(5);
  await settle(loaded);
  expect(harness.calls.filter((call) => call.startsWith("create"))).toEqual([]);
  expect(views()[0].props.page).toBe(5);
});

test("the string event is read as the library reads it, and setPage is the setNativePage command", async () => {
  const { harness, app, views, until } = await mount(fakeBlobUtil(), 92);
  await until(() => views().length > 0);
  const [view] = views();
  const message = (text: string) => harness.emit(view.target, "topChange", { message: text });
  message("loadComplete|12|595.5|842|[{\"title\":\"A|B\",\"pageIdx\":0}]");
  message("loadComplete|2|100|200|not json");
  message("pageChanged|3|12");
  message("error|password required");
  message("pageSingleTap|3|10.5|20");
  message("scaleChanged|2.5");
  message("linkPressed|https://example.com/?a=1");
  message("somethingElse|1");
  const path = view.props.path;
  expect(app.eventLog()).toEqual([
    ["loaded", 12, path, { width: 595.5, height: 842 }, [{ title: "A|B", pageIdx: 0 }]],
    ["loaded", 2, path, { width: 100, height: 200 }, "not json"],
    ["page", 3, 12], ["error", "password required"], ["tap", 3, 10.5, 20], ["scale", 2.5], ["link", "https://example.com/?a=1"],
  ]);

  harness.calls.length = 0;
  const handle = app.pdfHandle();
  expect(typeof handle?.host.tag).toBe("number");
  handle?.setPage(7);
  expect(harness.calls).toEqual(["fabric.dispatchCommand RNPDFPdfView setNativePage [7]"]);
  expect(() => handle?.setPage(Number.NaN)).toThrow("Specified pageNumber is not a number");
});

test("a download goes to a .tmp file with the request as given, is checked against Content-Length and moved to the cache", async () => {
  const url = "https://example.com/a.pdf";
  const natives = fakeBlobUtil({ [url]: { headers: { "Content-Length": "5" }, size: 5 } });
  const { views, until } = await mount(natives, 93, { uri: url, method: "POST", headers: { Authorization: "Bearer x", Empty: null }, body: "q=1" });
  await until(() => views().length > 0);
  const cacheFile = cacheFileOf(url);
  expect(natives.log).toEqual([
    `unlink ${cacheFile}`, `unlink ${cacheFile}.tmp`,
    `fetch ${JSON.stringify({ path: `${cacheFile}.tmp`, trusty: true })} POST ${url} ${JSON.stringify({ Authorization: "Bearer x", Empty: "" })} "q=1"`,
    `stat ${cacheFile}.tmp`, `unlink ${cacheFile}`, `cp ${cacheFile}.tmp ${cacheFile}`, `unlink ${cacheFile}.tmp`,
  ]);
  expect(views()[0].props.path).toBe(cacheFile);
  expect(natives.files.has(`${cacheFile}.tmp`)).toBe(false);
});

test("a download that is shorter than Content-Length, or fails, is removed and reported to onError; an encoded response is not measured", async () => {
  const short = "https://example.com/short.pdf";
  const natives = fakeBlobUtil({ [short]: { headers: { "content-length": "9" }, size: 5 } });
  const first = await mount(natives, 94, { uri: short });
  await first.until(() => first.app.eventLog().length > 0);
  expect(first.app.eventLog()).toEqual([["error", `DownloadFailed:${short}`]]);
  expect(first.views()).toEqual([]);
  expect(natives.files.size).toBe(0);

  const broken = "https://example.com/broken.pdf";
  const second = await mount(fakeBlobUtil({ [broken]: { fail: "Network request failed" } }), 95, { uri: broken });
  await second.until(() => second.app.eventLog().length > 0);
  expect(second.app.eventLog()).toEqual([["error", "Network request failed"]]);

  // The compressed length is not the file's: the check is skipped (the header is matched whatever its case).
  const gzip = "https://example.com/gzip.pdf";
  const third = await mount(fakeBlobUtil({ [gzip]: { headers: { "Content-Length": "2", "content-encoding": "gzip" }, size: 50 } }), 96, { uri: gzip });
  await third.until(() => third.views().length > 0);
  expect(third.views()[0].props.path).toBe(cacheFileOf(gzip));
});

test("with cache, a file that has not expired is used without a request; an expired one is downloaded again", async () => {
  const url = "https://example.com/cached.pdf";
  const natives = fakeBlobUtil({ [url]: { headers: {}, size: 7 } });
  natives.files.set(cacheFileOf(url), { size: 3, lastModified: Date.now() - 10_000 });
  const fresh = await mount(natives, 97, { uri: url, cache: true, expiration: 3600 });
  await fresh.until(() => fresh.views().length > 0);
  expect(natives.log).toEqual([`stat ${cacheFileOf(url)}`]);
  expect(fresh.views()[0].props.path).toBe(cacheFileOf(url));

  natives.log.length = 0;
  const expired = await mount(natives, 98, { uri: url, cache: true, expiration: 5 });
  await expired.until(() => natives.log.some((line) => line.startsWith("cp ")));
  expect(natives.log[0]).toBe(`stat ${cacheFileOf(url)}`);
  expect(natives.log.some((line) => line.startsWith("fetch "))).toBe(true);

  // Without an expiration a cached file lasts; a named cache file is used as given.
  natives.log.length = 0;
  natives.files.set("/cache/mine.pdf", { size: 1, lastModified: 0 });
  const named = await mount(natives, 99, { uri: url, cache: true, cacheFileName: "mine.pdf" });
  await named.until(() => named.views().length > 0);
  expect(natives.log).toEqual(["stat /cache/mine.pdf"]);
  expect(named.views()[0].props.path).toBe("/cache/mine.pdf");
});

test("a bundled asset is copied to the cache, a file URI is a decoded path, a require()d asset resolves first, and no uri is an error", async () => {
  const natives = fakeBlobUtil();
  const asset = await mount(natives, 100, { uri: "bundle-assets://docs/a.pdf" });
  await asset.until(() => asset.views().length > 0);
  expect(natives.log).toEqual([`unlink ${cacheFileOf("bundle-assets://docs/a.pdf")}`, `cp bundle-assets://docs/a.pdf ${cacheFileOf("bundle-assets://docs/a.pdf")}`]);

  const local = fakeBlobUtil();
  const file = await mount(local, 101, { uri: "file:///data/user/0/a%20b.pdf" });
  await file.until(() => file.views().length > 0);
  expect(file.views()[0].props.path).toBe("/data/user/0/a b.pdf");
  expect(local.log).toEqual([`unlink ${cacheFileOf("file:///data/user/0/a%20b.pdf")}`]);

  const required = await mount(fakeBlobUtil(), 102, 7, { 7: { uri: "file:///data/bundle/manual.pdf" } });
  await required.until(() => required.views().length > 0);
  expect(required.views()[0].props.path).toBe("/data/bundle/manual.pdf");

  const none = await mount(fakeBlobUtil(), 103, {});
  await none.until(() => none.app.eventLog().length > 0);
  expect(none.app.eventLog()).toEqual([["error", "no pdf source!"]]);
  expect(none.views()).toEqual([]);
});

test("a new URI loads again and stops the download in progress; its result is never mounted", async () => {
  const slow = "https://example.com/slow.pdf";
  const natives = fakeBlobUtil({ [slow]: { hold: true } });
  const { app, views, until, loaded } = await mount(natives, 104, { uri: slow });
  await until(() => natives.held.length > 0);
  app.setSource({ uri: "data:application/pdf;base64,QUJD" });
  await until(() => views().length > 0);
  expect(natives.log).toContain("cancel held");
  expect(views()[0].props.path).toBe(cacheFileOf("data:application/pdf;base64,QUJD"));
  // The stale download finishes later: nothing changes.
  natives.held[0]?.finish();
  await settle(loaded);
  await settle(loaded);
  expect(views()).toHaveLength(1);
  expect(views()[0].props.path).toBe(cacheFileOf("data:application/pdf;base64,QUJD"));
  expect(app.eventLog()).toEqual([]);
});

test("sha1 is the hash crypto-js makes of the URI, for any text", () => {
  for (const text of ["", "abc", dataUri, "https://example.com/é/ü.pdf?x=1&y=ß", "😀 pdf", "x".repeat(1000), "y".repeat(55), "z".repeat(56), "w".repeat(64)]) {
    expect(sha1(text), text.slice(0, 20)).toBe(createHash("sha1").update(text, "utf8").digest("hex"));
  }
});

test("messages without a name, a short load and an unknown one are read as the library reads them", () => {
  expect(parsePdfMessage("")).toBeNull();
  expect(parsePdfMessage(undefined)).toBeNull();
  expect(parsePdfMessage("loadComplete|1|2|3")).toEqual({ type: "loadComplete", pages: 1, size: { width: 2, height: 3 }, tableContents: undefined });
  expect(parsePdfMessage("pageChanged|x|y")).toEqual({ type: "pageChanged", page: Number.NaN, pages: Number.NaN });
});

test("without react-native-blob-util the error reaches onError and nothing is mounted", async () => {
  const harness = createHarness("android");
  const loaded = await harness.load("foreign-pdf-fixture.svelte");
  const app = loaded.startSurface(105, loaded.Fixture, {}) as App;
  await settle(loaded);
  expect(app.eventLog()).toEqual([["error", "no TurboModule ReactNativeBlobUtil"]]);
  expect(find(harness.roots()[105], "RNPDFPdfView")).toEqual([]);
});
