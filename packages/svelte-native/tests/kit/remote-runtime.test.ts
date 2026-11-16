// biome-ignore-all lint/suspicious/noExplicitAny: the client is a bundle loaded at run time and its remote functions are not typed
// The native half of remote functions without a server: the host config, the transport (what a request looks like), the globals SvelteKit's client files are given,
// the redirect and the screen URL, and the native form's inputs. Bundled the way Metro would bundle it (remote-harness.ts); the server round trips are in remote-e2e.test.ts.
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { stringify } from "devalue";
import { pathToFileURL } from "node:url";
import { kitRoot } from "../../src/remote/transform.ts";
import { loadClient } from "./support/remote-harness.ts";
import { type GlobalSnapshot, snapshotGlobals } from "../support/globals.ts";

// What the client bundles and their stand-ins leave on the global object (`__remoteAppState`, `__opened`, `__expoConfig`...) goes when the file is done.
let world: GlobalSnapshot;
beforeAll(() => { world = snapshotGlobals(); });
afterAll(() => world.restore());

/* eslint-disable @typescript-eslint/no-explicit-any */
let m: Record<string, any>;
const ENTRY = `
  export * from "../src/remote/index.ts";
  export { normalizeBase, normalizeAppDir, hostFromExtra } from "../src/remote/host.ts";
  export { currentHost, requireOrigin } from "../src/remote/config.ts";
  export { fetch as transportFetch, location, navigator, window, Blob } from "../src/remote/globals.ts";
  export { navigate, currentUrl } from "../src/remote/link.ts";
  export { linkRouter } from "../src/remote/router-link.ts";
  export { form, query, assertReady } from "../src/remote/runtime.ts";
  export { base, app_dir } from "../src/remote/shims/paths.ts";
  export { handle_error } from "../src/remote/shims/client.ts";
  export { serialize_binary_form } from "@sveltejs/kit/src/runtime/form-utils.js";
  export { HttpError, HandledHttpError, SvelteKitError } from "@sveltejs/kit/internal";
  export { parse as kitParse } from "@sveltejs/kit/src/runtime/app/internal/transport.js";
  export { registerHooks, resetHooks } from "../src/app-hooks.ts";
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
  test("the current global fetch is used unless a custom transport overrides it", async () => {
    const previous = globalThis.fetch;
    const used: string[] = [];
    const send = (name: string): typeof fetch => (async () => { used.push(name); return new Response("ok"); }) as typeof fetch;
    try {
      m.configureRemote({ origin: "https://a.example" });
      globalThis.fetch = send("global-one");
      await m.transportFetch("/one");
      globalThis.fetch = send("global-two");
      await m.transportFetch("/two");
      m.configureRemote({ fetch: send("custom") });
      await m.transportFetch("/three");
      m.configureRemote({ fetch: null });
      await m.transportFetch("/four");
      expect(used).toEqual(["global-one", "global-two", "custom", "global-two"]);
    } finally {
      globalThis.fetch = previous;
    }
  });
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
  test("a redirect is an error, not followed: the session cookie goes nowhere the server did not name", async () => {
    const sent = record();
    await m.transportFetch("/x");
    await m.transportFetch("/x", { method: "POST" });
    expect(sent.map((request) => request.init.redirect)).toEqual(["error", "error"]);
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
    // Without files the body is the bytes, as before; with one it is the platform's Blob of the parts (the file's bytes stay where they are).
    expect(new m.Blob(["ab", new Uint8Array([1, 2])]).bytes()).toEqual(new Uint8Array([97, 98, 1, 2]));
    const withFile = new m.Blob([new Uint8Array([1]), "x", new File([new Uint8Array([7, 8])], "f.bin")]);
    expect(withFile).toBeInstanceOf(Blob);
    expect(new Uint8Array(await withFile.arrayBuffer())).toEqual(new Uint8Array([1, 120, 7, 8]));
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
    (globalThis as any).__remoteAppState("inactive");
    (globalThis as any).__remoteAppState("background");
    (globalThis as any).__remoteAppState("active");
    m.window.removeEventListener("pagehide", hide);
    (globalThis as any).__remoteAppState("background");
    (globalThis as any).__remoteAppState("active");
    m.window.removeEventListener("pageshow", show);
    (globalThis as any).__remoteAppState("active");
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
  test("only an http: or https: address of another site is opened; nothing else the server names is", async () => {
    m.configureRemote({ origin: "https://a.example" });
    const { gone, unlink } = linked();
    for (const location of ["javascript:alert(1)", "intent://scan/#Intent;scheme=zxing;end", "file:///etc/passwd", "example://auth/login", "tel:+966500000000", "data:text/html,<b>x</b>"]) {
      await expect(m.navigate(location)).rejects.toThrow(/not an http: or https: address/);
    }
    expect((globalThis as any).__opened).toEqual([]);
    expect(gone).toEqual([]);
    await m.navigate("http://other.example/page");
    expect((globalThis as any).__opened).toEqual(["http://other.example/page"]);
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

  test("src/hooks.mobile.ts gives the handleError and the transport, and configureRemote's replace them until resetRemoteConfig", async () => {
    class Point { constructor(readonly x: number) {} }
    const encoded = stringify(new Point(3), { Point: (value: unknown) => value instanceof Point && [value.x] });
    try {
      // Before any hooks: SvelteKit's default handleError (500, Internal Error), and no decoder for Point.
      expect(await m.handle_error(new TypeError("offline"), {})).toEqual({ status: 500, message: "Internal Error" });
      expect(() => m.kitParse(encoded)).toThrow();
      m.registerHooks({
        handleError: () => ({ message: "from the hooks file" }),
        transport: { Point: { encode: (value: unknown) => value instanceof Point && [value.x], decode: ([x]: [number]) => new Point(x) } },
      });
      expect(await m.handle_error(new TypeError("offline"), {})).toEqual({ status: 500, message: "from the hooks file" });
      expect(m.kitParse(encoded)).toBeInstanceOf(Point);
      expect(m.kitParse(encoded).x).toBe(3);
      // A hot update of the file registers its new exports.
      m.registerHooks({ handleError: () => ({ message: "edited" }) });
      expect(await m.handle_error(new TypeError("offline"), {})).toEqual({ status: 500, message: "edited" });
      expect(() => m.kitParse(encoded)).toThrow();
      m.configureRemote({ handleError: () => ({ message: "from configureRemote" }) });
      m.registerHooks({ handleError: () => ({ message: "edited again" }) });
      expect(await m.handle_error(new TypeError("offline"), {})).toEqual({ status: 500, message: "from configureRemote" });
      m.resetRemoteConfig();
      expect(await m.handle_error(new TypeError("offline"), {})).toEqual({ status: 500, message: "edited again" });
    } finally {
      m.resetHooks();
    }
    expect(await m.handle_error(new TypeError("offline"), {})).toEqual({ status: 500, message: "Internal Error" });
  });

  test("a transport SvelteKit refuses is thrown by the registration, after init has started", () => {
    let ran = false;
    try {
      expect(() => m.registerHooks({ transport: { Broken: null }, init: () => { ran = true; } })).toThrow(TypeError);
      expect(ran).toBe(true);
    } finally {
      m.resetHooks();
    }
  });
});

describe("a query object that outlives the effect that made it", () => {
  const entry = `
    export * from "../src/remote/index.ts";
    export { query, query_live, command } from "../src/remote/runtime.ts";
    export { inOwner, sharedDerived } from "./kit/fixtures/remote-owner.svelte.ts";
    export { query_map } from "../src/remote/shims/client.ts";
    export { tick } from "svelte";
  `;
  const settle = (ms = 30) => new Promise((resolve) => setTimeout(resolve, ms));
  for (const hermes of [true, false]) {
    describe(hermes ? "in an engine with no FinalizationRegistry" : "with the engine's FinalizationRegistry", () => {
      let client: Record<string, any>;
      let calls = 0;
      beforeAll(async () => { client = await loadClient(entry, undefined, undefined, { hermes }); });
      afterEach(() => { client.resetRemoteConfig(); calls = 0; });
      const serve = (value = "v", updateKey = "hash/name/", commandResponse?: () => Promise<void>) => client.configureRemote({
        origin: "https://a.example",
        fetch: async (url: string) => {
          calls++;
          if (url.includes("/hash/command")) {
            await commandResponse?.();
            return Response.json({ type: "result", data: stringify({ _: 1, q: { [updateKey]: { v: "from the command" } } }) });
          }
          const target = new URL(url);
          return ok(`${target.pathname.replace("/_app/remote/", "")}/${target.searchParams.get("payload") ?? ""}`, value);
        },
      });

      test("used after the effect is torn down, it works: reading, refreshing, setting and overriding do not throw", async () => {
        serve();
        const owner = client.inOwner(() => client.query("hash/name")());
        const query = owner.value;
        expect(await query).toBe("v");
        owner.destroy();
        await settle();
        // The entry went with its effect; the object makes SvelteKit's again, which asks the server again.
        expect(() => query.current).not.toThrow();
        expect(await query).toBe("v");
        expect(query.current).toBe("v");
        expect(await query.refresh()).toBeUndefined();
        query.set("set");
        expect(query.current).toBe("set");
        const release = query.withOverride((value: string) => `${value}!`);
        expect(query.current).toBe("set!");
        release();
        expect(await query).toBe("set");
      });
      test("a query made by a $derived and first read in a branch that goes away is still there for the next reader", async () => {
        serve();
        const scenario = client.sharedDerived(() => client.query("hash/shared")());
        await settle(50);
        expect(scenario.out.first).toBe("v");
        scenario.hideFirst();
        await settle();
        scenario.readSecond();
        await settle(50);
        expect([scenario.out.error, scenario.out.second]).toEqual([undefined, "v"]);
        scenario.destroy();
      });
      test("a read that continues after the screen is gone, and a command that finishes after it, find a query to read", async () => {
        // A unique key isolates this cache from proxies retained by earlier tests until engine GC.
        const key = "hash/after-destroy";
        let respond!: () => void;
        let started!: () => void;
        const response = new Promise<void>((resolve) => { respond = resolve; });
        const requestStarted = new Promise<void>((resolve) => { started = resolve; });
        serve("v", `${key}/`, () => { started(); return response; });
        const owner = client.inOwner(() => client.query(key)());
        const query = owner.value;
        await query;
        // Hold the response until the owner and its cache entry are actually gone.
        const finishing = client.command("hash/command")().updates(query);
        await requestStarted;
        owner.destroy();
        await client.tick();
        expect(client.query_map.has(key)).toBe(false);
        respond();
        await finishing;
        expect(await query).toBe("from the command");
        // An await that is already in flight when the effect goes retains its query until it resolves.
        const second = client.inOwner(() => client.query("hash/reading-after-destroy")());
        const reading = second.value.then((value: string) => value);
        second.destroy();
        expect(await reading).toBe("v");
        // A later read reacquires an evicted entry. Wait for it, rather than relying on a GC-retained cache.
        expect(await second.value).toBe("v");
        expect(second.value.current).toBe("v");
      });
      test("released objects are dropped from the cache: the next one fetches again", async () => {
        serve();
        const owner = client.inOwner(() => client.query("hash/other")());
        await owner.value;
        owner.destroy();
        await settle();
        const before = calls;
        const again = client.inOwner(() => client.query("hash/other")());
        await again.value;
        expect(calls).toBe(before + 1);
        again.destroy();
      });
    });
  }
});

describe("the product's share of it", () => {
  test("the router registers itself through a file of its own with no imports, and nothing else of the runtime is imported by it", () => {
    const here = join(import.meta.dirname, "../../src");
    const link = readFileSync(join(here, "remote/router-link.ts"), "utf8");
    expect(link).not.toMatch(/^\s*import\s/m);
    expect(Buffer.byteLength(link)).toBeLessThan(1200);
    const router = readFileSync(join(here, "router.svelte.ts"), "utf8");
    expect(router.match(/from "\.\/remote\/[^"]+"/g)).toEqual(['from "./remote/router-link.ts"']);
  });
});
