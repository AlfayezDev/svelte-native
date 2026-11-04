// The native half of remote functions without a server: the host config, the transport (what a request looks like), the globals SvelteKit's client files are given,
// the redirect and the screen URL, and the native form's inputs. Bundled the way Metro would bundle it (remote-harness.ts); the server round trips are in remote-e2e.test.ts.
import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { stringify } from "devalue";
import { pathToFileURL } from "node:url";
import { kitRoot } from "../src/remote/transform.ts";
import { loadClient } from "./remote-harness.ts";

/* eslint-disable @typescript-eslint/no-explicit-any */
let m: Record<string, any>;
const ENTRY = `
  export * from "../src/remote/index.ts";
  export { normalizeBase, normalizeAppDir, hostFromExtra, currentHost, requireOrigin } from "../src/remote/config.ts";
  export { fetch as transportFetch, location, navigator, window, Blob } from "../src/remote/globals.ts";
  export { linkRouter, navigate, currentUrl } from "../src/remote/link.ts";
  export { form, query, assertReady } from "../src/remote/runtime.ts";
  export { base, app_dir } from "../src/remote/shims/paths.ts";
  export { handle_error } from "../src/remote/shims/client.ts";
  export { serialize_binary_form } from "@sveltejs/kit/src/runtime/form-utils.js";
  export { HttpError, HandledHttpError, SvelteKitError } from "@sveltejs/kit/internal";
`;

beforeAll(async () => { m = await loadClient(ENTRY); });
afterEach(() => { m.resetRemoteConfig(); (globalThis as any).__opened = []; });

/** The server's answer to a query: the result, and (as SvelteKit's does) the same result under the query's key, which is how the client's cache entry gets its value. */
const ok = (key: string, value: string) => Response.json({ type: "result", data: stringify({ _: value, q: { [key]: { v: value } } }) });
const throws = (call: () => unknown): any => { try { call(); } catch (error) { return error; } return undefined; };

describe("the host", () => {
  test("an origin is an http(s) origin and nothing else", () => {
    expect(m.normalizeOrigin("https://app.example.com")).toBe("https://app.example.com");
    expect(m.normalizeOrigin(" http://localhost:3000/ ")).toBe("http://localhost:3000");
    expect(m.normalizeOrigin("HTTPS://App.Example.com:443")).toBe("https://app.example.com");
    for (const bad of [undefined, null, "", "  ", 42, "localhost:3000", "ftp://x.example", "https://user:pw@x.example", "https://x.example/app", "https://x.example/?a=1", "https://x.example/#top", "not a url"]) {
      const error = throws(() => m.normalizeOrigin(bad));
      expect([bad, error?.name]).toEqual([bad, "RemoteConfigError"]);
    }
    expect(throws(() => m.normalizeOrigin("https://x.example/app")).message).toContain("`base`");
  });
  test("base is SvelteKit's paths.base and appDir its appDir", () => {
    expect([m.normalizeBase(undefined), m.normalizeBase(""), m.normalizeBase("/app"), m.normalizeBase("/a/b")]).toEqual(["", "", "/app", "/a/b"]);
    for (const bad of ["app", "/app/", "/", 3]) expect([bad, throws(() => m.normalizeBase(bad))?.name]).toEqual([bad, "RemoteConfigError"]);
    expect([m.normalizeAppDir(undefined), m.normalizeAppDir("_native"), m.normalizeAppDir("a/b")]).toEqual(["_app", "_native", "a/b"]);
    for (const bad of ["/_app", "_app/", 3]) expect([bad, throws(() => m.normalizeAppDir(bad))?.name]).toEqual([bad, "RemoteConfigError"]);
  });
  test("the app config's extra.svelteNative.remote", () => {
    expect(m.hostFromExtra(undefined)).toBeUndefined();
    expect(m.hostFromExtra({ eas: {} })).toBeUndefined();
    expect(m.hostFromExtra({ svelteNative: {} })).toBeUndefined();
    expect(m.hostFromExtra({ svelteNative: { remote: { origin: "http://10.0.2.2:3000", base: "/app", appDir: "_x" } } })).toEqual({ origin: "http://10.0.2.2:3000", base: "/app", appDir: "_x" });
    expect(m.hostFromExtra({ svelteNative: { remote: { origin: "https://a.example" } } })).toEqual({ origin: "https://a.example", base: "", appDir: "_app" });
    expect(throws(() => m.hostFromExtra({ svelteNative: { remote: { origin: "nope" } } }))?.name).toBe("RemoteConfigError");
    expect(throws(() => m.hostFromExtra({ svelteNative: { remote: { base: "/x" } } }))?.message).toContain("remote origin");
    expect(throws(() => m.hostFromExtra({ svelteNative: { remote: "https://a.example" } }))?.message).toContain("must be an object");
  });
  test("no host: the first call throws, naming where to set one", () => {
    expect(m.currentHost()).toEqual({ origin: undefined, base: "", appDir: "_app" });
    const error = throws(() => m.requireOrigin());
    expect(error.name).toBe("RemoteConfigError");
    expect(error.message).toContain("extra.svelteNative.remote.origin");
    expect(error.message).toContain("configureRemote");
    for (const call of [() => m.query("h/n")(), () => m.assertReady()]) expect(throws(call)?.name).toBe("RemoteConfigError");
  });
  test("configureRemote validates before it changes anything, and only changes what it is given", () => {
    m.configureRemote({ origin: "https://a.example", base: "/app" });
    expect(throws(() => m.configureRemote({ origin: "https://b.example/path" }))?.name).toBe("RemoteConfigError");
    expect(m.currentHost()).toEqual({ origin: "https://a.example", base: "/app", appDir: "_app" });
    m.configureRemote({ appDir: "_native" });
    expect(m.currentHost()).toEqual({ origin: "https://a.example", base: "/app", appDir: "_native" });
    expect([m.base, m.app_dir]).toEqual(["/app", "_native"]);
    m.resetRemoteConfig();
    expect([m.base, m.app_dir]).toEqual(["", "_app"]);
  });
  test("a request goes to origin + base + appDir + remote + id", async () => {
    const urls: string[] = [];
    m.configureRemote({ origin: "https://a.example", base: "/app", appDir: "_native", fetch: async (url: string) => { urls.push(url); return ok(url.includes("other") ? "hash/other/WyJhcmciXQ" : "hash/name/", "v"); } });
    expect(await m.query("hash/name")()).toBe("v");
    expect(await m.query("hash/other")("arg")).toBe("v");
    expect(urls).toEqual(["https://a.example/app/_native/remote/hash/name", "https://a.example/app/_native/remote/hash/other?payload=WyJhcmciXQ"]);
  });
  test("refreshAll fetches every query a screen holds again", async () => {
    let calls = 0;
    m.configureRemote({ origin: "https://a.example", fetch: async (url: string) => (url.endsWith("/refreshing") ? ok("hash/refreshing/", `call ${++calls}`) : ok("hash/name/", "other")) });
    const query = m.query("hash/refreshing")();
    expect(await query).toBe("call 1");
    await m.refreshAll();
    expect(calls).toBe(2);
    expect(query.current).toBe("call 2");
  });
});

describe("the transport", () => {
  const record = () => {
    const sent: { url: string; init: RequestInit }[] = [];
    m.configureRemote({ origin: "https://a.example", fetch: async (url: string, init: RequestInit) => { sent.push({ url, init }); return new Response("{}"); } });
    return sent;
  };
  test("a path is on the configured origin; cookies are the platform's; a request that is not a GET says which origin it comes from", async () => {
    const sent = record();
    await m.transportFetch("/_app/remote/h/q?payload=x");
    await m.transportFetch("/_app/remote/h/c", { method: "POST", body: "{}", headers: { "Content-Type": "application/json" } });
    await m.transportFetch("/_app/remote/h/c", { method: "post" });
    expect(sent.map((request) => request.url)).toEqual(["https://a.example/_app/remote/h/q?payload=x", "https://a.example/_app/remote/h/c", "https://a.example/_app/remote/h/c"]);
    expect(sent.map((request) => request.init.credentials)).toEqual(["include", "include", "include"]);
    const headers = sent.map((request) => new Headers(request.init.headers));
    expect(headers.map((h) => h.get("origin"))).toEqual([null, "https://a.example", "https://a.example"]);
    expect(headers[1].get("content-type")).toBe("application/json");
  });
  test("a caller's own Origin stays, and a URL on another host gets none", async () => {
    const sent = record();
    await m.transportFetch("/x", { method: "POST", headers: { Origin: "https://elsewhere.example" } });
    await m.transportFetch("https://other.example/x", { method: "POST" });
    await m.transportFetch(new URL("https://a.example/y"), { method: "DELETE" });
    expect(sent.map((request) => new Headers(request.init.headers).get("origin"))).toEqual(["https://elsewhere.example", null, "https://a.example"]);
  });
  test("without a host the request is not sent", () => {
    expect(throws(() => m.transportFetch("/x"))?.name).toBe("RemoteConfigError");
  });
  test("a form body is the bytes SvelteKit's own serializer makes", async () => {
    const kit = await import(pathToFileURL(join(kitRoot(), "src/runtime/form-utils.js")).href);
    const data = { a: 1, b: "two", c: [true, null, undefined], d: new Date(0), e: { f: "ünï ✓" } };
    const meta = { remote_refreshes: ["h/q/p"] };
    const expected = new Uint8Array(await kit.serialize_binary_form(data, meta).blob.arrayBuffer());
    expect(m.serialize_binary_form(data, meta).blob.bytes()).toEqual(expected);
    expect(expected[0]).toBe(0);
    expect(() => new m.Blob([new Uint16Array(1)])).toThrow(/files are not supported/);
    expect(new m.Blob(["ab", new Uint8Array([1, 2])]).bytes()).toEqual(new Uint8Array([97, 98, 1, 2]));
  });
});

describe("the globals of SvelteKit's client files", () => {
  const router = (href: string, goto: (to: string) => void = () => {}) => ({ goto, current: { url: new URL(href, "https://native.invalid") } });
  test("location is the screen on top, and a plain URL when there is none", () => {
    expect(m.location.href).toBe("https://native.invalid/");
    const unlink = m.linkRouter(router("/lab/remote?tab=2#top"));
    expect([m.location.pathname, m.location.search, m.location.hash, m.location.origin, String(m.location)]).toEqual(["/lab/remote", "?tab=2", "#top", "https://native.invalid", "https://native.invalid/lab/remote?tab=2#top"]);
    unlink();
    expect(m.location.pathname).toBe("/");
    // A router that has no screen yet.
    const empty = { goto() {}, get current(): never { throw new Error("no screen yet"); } };
    m.linkRouter(empty)();
    const unlinkEmpty = m.linkRouter(empty);
    expect(m.location.pathname).toBe("/");
    unlinkEmpty();
  });
  test("a live query retries: the phone always says it is online", () => {
    expect(m.navigator.onLine).toBe(true);
  });
  test("window's page events are the app's: pagehide in the background, pageshow (persisted) in the foreground", () => {
    const seen: string[] = [];
    const hide = (event: any) => seen.push(event.type);
    const show = (event: any) => seen.push(`${event.type}${event.persisted ? " persisted" : ""}`);
    m.window.addEventListener("pagehide", hide);
    m.window.addEventListener("pageshow", show);
    (globalThis as any).__appState("inactive");
    (globalThis as any).__appState("background");
    (globalThis as any).__appState("active");
    m.window.removeEventListener("pagehide", hide);
    (globalThis as any).__appState("background");
    (globalThis as any).__appState("active");
    m.window.removeEventListener("pageshow", show);
    (globalThis as any).__appState("active");
    expect(seen).toEqual(["pagehide", "pageshow persisted", "pageshow persisted"]);
  });
});

describe("redirects", () => {
  const linked = () => { const gone: string[] = []; const unlink = m.linkRouter({ goto: (to: string) => gone.push(to), current: { url: new URL("https://native.invalid/") } }); return { gone, unlink }; };
  test("a location of the app goes through the root router, without SvelteKit's base", async () => {
    m.configureRemote({ origin: "https://a.example", base: "/app" });
    const { gone, unlink } = linked();
    await m.navigate("/app/sent?to=a#top");
    await m.navigate("/elsewhere");
    await m.navigate("https://a.example/app");
    await m.navigate("https://a.example/application/x");
    expect(gone).toEqual(["/sent?to=a#top", "/elsewhere", "/", "/application/x"]);
    unlink();
  });
  test("another site is opened by the system, and the app's own goto comes first", async () => {
    m.configureRemote({ origin: "https://a.example" });
    const { gone, unlink } = linked();
    await m.navigate("https://pay.example/checkout?id=1");
    expect((globalThis as any).__opened).toEqual(["https://pay.example/checkout?id=1"]);
    expect(gone).toEqual([]);
    const own: string[] = [];
    m.configureRemote({ goto: (to: string) => { own.push(to); } });
    await m.navigate("/anywhere");
    expect(own).toEqual(["/anywhere"]);
    expect(gone).toEqual([]);
    unlink();
  });
  test("a redirect with no router to follow it is an error, not silence", async () => {
    m.configureRemote({ origin: "https://a.example" });
    await expect(m.navigate("/login")).rejects.toThrow(/no router is connected/);
  });
});

describe("errors", () => {
  test("handle_error gives the App.Error of whatever was caught, through the app's handleError hook", async () => {
    const seen: string[] = [];
    m.configureRemote({ handleError: ({ kind }: any) => { seen.push(kind); return kind === "unknown" ? { message: "Something broke", code: "E1" } : undefined; } });
    expect(await m.handle_error(new m.HandledHttpError({ status: 400, message: "already final" }), {})).toEqual({ status: 400, message: "already final" });
    expect(await m.handle_error(new m.HttpError({ status: 418, message: "teapot" }), {})).toEqual({ status: 418, message: "teapot" });
    expect(await m.handle_error(new m.SvelteKitError(404, "Not Found", "no such remote function"), {})).toEqual({ status: 404, message: "Not Found" });
    expect(await m.handle_error(new TypeError("Network request failed"), {})).toEqual({ status: 500, message: "Something broke", code: "E1" });
    expect(seen).toEqual(["app", "framework", "unknown"]);
  });
});
