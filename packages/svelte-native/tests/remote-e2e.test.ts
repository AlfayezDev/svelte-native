// biome-ignore-all lint/suspicious/noExplicitAny: the client is a bundle loaded at run time and its remote functions are not typed
// SvelteKit remote functions end to end: a real SvelteKit server (the fixture, tests/fixtures/kit-app: one remote function of each kind) and the native client
// runtime (src/remote, SvelteKit's own client files with the shims) calling it over HTTP. Every kind round-trips against the Vite dev server and against a
// production build, where SvelteKit's CSRF check for remote calls is on.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { cookieFetch, fixtureRoot, loadClient, startServer, type Server } from "./remote-harness.ts";
import { remoteHash } from "../src/remote/transform.ts";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Client = Record<string, any>;

const ENTRY = `
  import * as api from "${fixtureRoot}/src/lib/api.remote.ts";
  export { api };
  export * from "../src/remote/index.ts";
  export { linkRouter } from "../src/remote/link.ts";
  export { sweepRegistry } from "../src/remote/environment.ts";
  export { inOwner } from "./remote-owner.svelte.ts";
  export { Money } from "${fixtureRoot}/src/lib/money.ts";
  export { tick, flushSync } from "svelte";
`;

/** The error a promise-like (a query is not a Promise) rejects with, or `undefined`. */
const rejection = async (thenable: PromiseLike<unknown>): Promise<any> => {
  try { await thenable; } catch (error) { return error; }
  return undefined;
};

const eventually = async <T>(read: () => Promise<T> | T, done: (value: T) => boolean, ms = 4000): Promise<T> => {
  const end = Date.now() + ms;
  for (;;) {
    const value = await read();
    if (done(value) || Date.now() > end) return value;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
};

function suite(mode: "dev" | "preview", hermes = false) {
  describe(`remote functions against the SvelteKit ${mode === "dev" ? "dev server" : "production build"}${hermes ? ", in an engine with no FinalizationRegistry" : ""}`, () => {
    let server: Server;
    let m: Client;
    let api: Client;
    let jar: ReturnType<typeof cookieFetch>;
    let redirects: string[];

    beforeAll(async () => {
      server = await startServer(mode);
      m = await loadClient(ENTRY, undefined, undefined, { hermes });
      api = m.api;
    }, 180_000);
    afterAll(() => { server?.stop(); });

    const configure = (extra: Record<string, unknown> = {}) => {
      m.resetRemoteConfig();
      jar = cookieFetch();
      redirects = [];
      m.configureRemote({ origin: server.origin, fetch: jar.send, goto: (location: string) => { redirects.push(location); }, ...extra });
    };

    test("the ids the client calls are the ids the server registered", async () => {
      configure();
      const id = remoteHash(`${fixtureRoot}/src/lib/api.remote.ts`, fixtureRoot);
      const response = await fetch(`${server.origin}/_app/remote/${id}/buildInfo/`);
      expect(response.status).toBe(200);
      expect(Object.keys(api).toSorted()).toEqual(["bounce", "buildInfo", "clock", "counter", "double", "doubled", "echoArgument", "endless", "greeting", "hello", "increment", "incrementIgnoring", "incrementRequested", "login", "me", "price", "probe", "redirecting", "reset", "sendMail", "signup", "stats", "teapot", "types", "watched"]);
      expect(await api.hello("ids")).toBe("hello ids");
    });

    test("query: awaits, is reactive state, refreshes and takes a value set on the client", async () => {
      configure();
      await api.reset();
      const query = api.stats();
      expect(query.loading).toBe(true);
      expect(query.ready).toBe(false);
      const first = await query;
      expect(first.signups).toEqual([]);
      expect(query.ready).toBe(true);
      expect(query.loading).toBe(false);
      expect(query.current).toEqual(first);
      query.set({ ...first, signups: ["set on the client"] });
      expect(query.current.signups).toEqual(["set on the client"]);
      await query.refresh();
      expect(query.current.signups).toEqual([]);
      // The same call is the same cache entry.
      expect(api.stats().current).toEqual(query.current);
    });

    test("query: arguments, and devalue's types, round-trip", async () => {
      configure();
      const { argument } = await api.echoArgument({ date: new Date("2026-05-06T07:08:09Z"), list: [1, "two", null, undefined], map: new Map([["k", new Set([1])]]) });
      expect(argument.date).toEqual(new Date("2026-05-06T07:08:09Z"));
      expect(argument.list).toEqual([1, "two", null, undefined]);
      expect(argument.map.get("k")).toEqual(new Set([1]));
      const value = await api.types();
      expect(value.date).toEqual(new Date("2026-01-02T03:04:05Z"));
      expect(value.map.get(1)).toBe("one");
      expect(value.big).toBe(12345678901234567890n);
      expect(value.set.has("a")).toBe(true);
    });

    test("the app's transport hook carries its own types, in arguments and in results", async () => {
      const Money = m.Money;
      configure({ transport: { Money: { encode: (value: unknown) => value instanceof Money && [value.cents], decode: ([cents]: [number]) => new Money(cents) } } });
      const price = await api.price();
      expect(price).toBeInstanceOf(Money);
      expect(price.cents).toBe(1250);
      const doubled = await api.doubled(new Money(300));
      expect(doubled).toBeInstanceOf(Money);
      expect(doubled.cents).toBe(600);
    });

    test("query: error() from the server is the query's error; redirect() goes through goto", async () => {
      configure();
      const failing = api.teapot();
      expect(await rejection(failing)).toMatchObject({ status: 418, body: { status: 418, message: "short and stout" } });
      expect(failing.error).toMatchObject({ status: 418, message: "short and stout" });
      expect(failing.loading).toBe(false);
      await api.bounce();
      expect(redirects).toEqual(["/elsewhere"]);
    });

    test("a handleError hook turns an error into the app's App.Error, as in the browser", async () => {
      configure({ handleError: ({ kind }: { kind: string }) => ({ code: `E_${kind.toUpperCase()}` }) });
      const failing = api.teapot();
      await failing.catch(() => {});
      expect(failing.error).toMatchObject({ status: 418, message: "short and stout" });
    });

    test("query.batch: calls made together are one request", async () => {
      configure();
      await api.reset();
      expect(await Promise.all([api.double(1), api.double(2), api.double(3)])).toEqual([2, 4, 6]);
      const stats = api.stats();
      await stats.refresh();
      expect(stats.current.batches).toEqual([3]);
    });

    test("query.live: streams values, finishes, and a closed stream is closed on the server", async () => {
      configure();
      const finite = api.clock(3);
      const seen: number[] = [];
      for await (const value of finite) seen.push(value);
      expect(seen).toEqual([1, 2, 3]);
      expect(finite.done).toBe(true);
      expect(finite.connected).toBe(false);

      // The stream stays open for as long as the query object lives (SvelteKit's cache evicts an entry when its proxies are garbage collected).
      const values = await (async () => {
        const endless = api.endless();
        const read: number[] = [];
        for await (const value of endless) {
          read.push(value);
          if (read.length === 3) break;
        }
        return read;
      })();
      expect(values.length).toBe(3);
      expect(values).toEqual([values[0], values[0] + 1, values[0] + 2]);
      // Nothing holds it any more: once it is collected the client closes the stream and the server's generator finishes.
      const open = async () => { Bun.gc(true); m.sweepRegistry(); return (await eventually(async () => { await api.stats().refresh(); return api.stats().current; }, (stats) => stats.liveOpen === 0, 500)).liveOpen; };
      let remaining = 1;
      for (let attempt = 0; attempt < 12 && remaining !== 0; attempt++) remaining = await open();
      expect(remaining).toBe(0);
    }, 20_000);

    test("query.live: is reactive (current, ready, connected), and follows the app to the background and back", async () => {
      configure();
      const live = api.endless();
      expect(await live).toBeGreaterThanOrEqual(1);
      expect(live.ready).toBe(true);
      expect(live.connected).toBe(true);
      const first = live.current;
      await eventually(() => live.current, (current) => current > first);
      expect(live.current).toBeGreaterThan(first);
      const open = async () => { await api.stats().refresh(); return api.stats().current.liveOpen; };
      expect(await open()).toBe(1);
      // To the background: the stream is closed and not retried.
      (globalThis as any).__appState("background");
      expect(await eventually(open, (n) => n === 0)).toBe(0);
      expect(live.connected).toBe(false);
      // Back: it reconnects and keeps delivering.
      (globalThis as any).__appState("active");
      expect(await eventually(open, (n) => n === 1)).toBe(1);
      const resumed = live.current;
      await eventually(() => live.current, (current) => current !== resumed);
      expect(live.connected).toBe(true);
      await live.reconnect();
      expect(live.connected).toBe(true);
      m.resetRemoteConfig();
    }, 30_000);

    if (hermes) {
      test("a query object made by an effect is released when the effect is torn down: the entry is dropped and a live stream closes, with no garbage collection", async () => {
        configure();
        await api.reset();
        const open = async () => { const stats = api.stats(); await stats.refresh(); return stats.current.watchedOpen; };
        const owner = m.inOwner(() => ({ counter: api.counter(), live: api.watched() }));
        expect(await owner.value.counter).toBe(0);
        expect(await owner.value.live).toBeGreaterThanOrEqual(1);
        expect(await open()).toBe(1);
        owner.destroy();
        expect(await eventually(open, (n) => n === 0)).toBe(0);
        // The counter's entry is gone with its owner: asking again fetches again (the server ran it twice).
        expect(await api.counter()).toBe(0);
        const stats = api.stats();
        await stats.refresh();
        expect(stats.current.counterRuns).toBe(2);
        // An object made outside any effect has no owner and stays cached until it is collected.
        const kept = api.counter();
        await kept;
        expect(await api.counter()).toBe(0);
        const again = api.stats();
        await again.refresh();
        expect(again.current.counterRuns).toBe(2);
      }, 20_000);
    }

    test("command: single-flight, client-requested refreshes with .updates, optimistic overrides and the pending count", async () => {
      configure();
      await api.reset();
      const counter = api.counter();
      expect(await counter).toBe(0);
      // The server refreshed `counter` itself: the value is in the command's response.
      expect(await api.increment(5)).toBe(5);
      expect(counter.current).toBe(5);
      // The client asks for the refresh; the command answers it with `requested`.
      expect(await api.incrementRequested(2).updates(counter)).toBe(7);
      expect(counter.current).toBe(7);
      // An override shows until the command is done; the refreshed value replaces it.
      const pending = api.incrementRequested(1).updates(counter.withOverride((n: number) => n + 1));
      expect(counter.current).toBe(8);
      expect(api.incrementRequested.pending).toBe(1);
      expect(await pending).toBe(8);
      expect(counter.current).toBe(8);
      expect(api.incrementRequested.pending).toBe(0);
      // A command that does not answer a requested refresh fails it.
      await api.incrementIgnoring(1).updates(counter);
      await eventually(() => counter.error, (error) => error !== undefined);
      expect(counter.error).toMatchObject({ status: 400 });
    });

    test("the request: Origin is the configured origin, the screen's URL is sent, and cookies are the platform's", async () => {
      configure();
      const router = { goto: () => {}, current: { url: new URL("https://native.invalid/lab/remote?tab=live") } };
      const unlink = m.linkRouter(router);
      const seen = await api.probe();
      expect(seen).toMatchObject({ origin: server.origin, pathname: "/lab/remote", search: "?tab=live" });
      const call = jar.calls[jar.calls.length - 1] as (typeof jar.calls)[number];
      expect(call.init.credentials).toBe("include");
      expect(call.url).toStartWith(`${server.origin}/_app/remote/`);
      unlink();
      // A session cookie set by one call reaches the next ones.
      expect(await api.me()).toBeNull();
      await api.login("ada");
      expect(jar.jar.get("session")).toBe("ada");
      await api.me().refresh();
      expect(await api.me()).toBe("ada");
      expect((await api.probe()).cookie).toBe("session=ada");
    });

    if (mode === "preview") {
      test("SvelteKit's CSRF check for remote calls: Origin must be the server's own", async () => {
        configure();
        const id = remoteHash(`${fixtureRoot}/src/lib/api.remote.ts`, fixtureRoot);
        const post = (headers: Record<string, string>) => fetch(`${server.origin}/_app/remote/${id}/reset`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify({ payload: "" }) });
        expect((await post({})).status).toBe(403);
        expect((await post({ origin: "https://evil.example" })).status).toBe(403);
        expect((await post({ origin: server.origin })).status).toBe(200);
        // The client sends the configured origin, which is what the server compares with its own.
        expect((await api.probe()).origin).toBe(server.origin);
        // A request that arrives without it is the one SvelteKit refuses, and the refusal is the command's error.
        m.resetRemoteConfig();
        m.configureRemote({ origin: server.origin, fetch: (url: string, init: RequestInit) => { const headers = new Headers(init.headers); headers.delete("origin"); return fetch(url, { ...init, headers }); }, handleError: () => {} });
        expect(await rejection(api.reset())).toMatchObject({ status: 403 });
      });
    }

    test("form: issues, then success; the native props, pending, submitted, result and reset", async () => {
      configure();
      const form = m.native(api.signup);
      const name = form.fields.name.as("text");
      const age = form.fields.age.as("number");
      const agree = form.fields.agree.as("checkbox");
      expect(name.value).toBe("");
      expect(age.keyboardType).toBe("decimal-pad");
      expect(agree.value).toBe(false);
      expect(form.submitted).toBe(false);

      // Nothing entered: the server's issues, for the fields that have them.
      expect(await form.submit()).toBe(false);
      expect(form.submitted).toBe(true);
      expect(form.pending).toBe(0);
      expect(form.fields.name.issues()?.[0].message).toBe("Name is too short");
      expect(form.fields.age.issues()?.[0].message).toContain("number");
      expect(form.fields.allIssues()?.length).toBe(2);

      name.onChangeText("Ada");
      age.onChangeText("1");
      age.onChangeText("17.");
      expect(age.value).toBe("17.");
      expect(form.fields.age.value()).toBe(17);
      agree.onValueChange(true);
      expect(agree.value).toBe(true);
      expect(form.fields.name.dirty()).toBe(true);
      name.onBlur();
      expect(form.fields.name.touched()).toBe(true);
      expect(await form.submit()).toBe(false);
      expect(form.fields.name.issues()).toBeUndefined();
      expect(form.fields.age.issues()?.[0].message).toBe("Must be 18 or older");

      age.onChangeText("36");
      const sending = form.submit();
      expect(form.pending).toBe(1);
      expect(await sending).toBe(true);
      expect(form.pending).toBe(0);
      expect(form.result).toEqual({ id: 1, name: "Ada", age: 36, agree: true, topics: [] });
      // Reset after success, as the web form does.
      expect(form.fields.name.value()).toBeUndefined();
      expect(name.value).toBe("");
      expect(form.submitted).toBe(false);
      expect(form.fields.allIssues()).toBeUndefined();
    });

    test("form: an issue the handler raises with invalid(), preflight, validate, set(), array fields, for(key), enhance and updates", async () => {
      configure();
      const form = m.native(api.signup);
      form.fields.set({ name: "taken", age: 40 });
      expect(await form.submit()).toBe(false);
      expect(form.fields.name.issues()?.[0].message).toBe("That name is taken");

      // A preflight schema (Standard Schema) runs on the client before anything is sent.
      const gate = { "~standard": { version: 1, vendor: "test", validate: (value: any) => (value.name === "ok" ? { value } : { issues: [{ message: "client says no", path: ["name"] }] }) } };
      form.preflight(gate);
      form.fields.name.set("nope");
      expect(await form.submit()).toBe(false);
      expect(form.fields.name.issues()?.[0].message).toBe("client says no");
      const before = (await api.stats()).signups.length;
      await form.validate({ preflightOnly: true, all: true });
      expect(form.fields.name.issues()?.[0].message).toBe("client says no");
      await api.stats().refresh();
      expect(api.stats().current.signups.length).toBe(before);

      // Server validation without submitting.
      form.preflight({ "~standard": { version: 1, vendor: "test", validate: (value: any) => ({ value }) } });
      form.fields.set({ name: "x", age: 20 });
      await form.validate({ all: true });
      expect(form.fields.name.issues()?.[0].message).toBe("Name is too short");

      // Checkbox arrays, and a different instance per key.
      const topic = form.fields.topics.as("checkbox", "svelte");
      const other = form.fields.topics.as("checkbox", "kit");
      topic.onValueChange(true);
      other.onValueChange(true);
      topic.onValueChange(false);
      expect(form.fields.topics.value()).toEqual(["kit"]);
      expect(other.value).toBe(true);
      expect(topic.value).toBe(false);
      // (Outside an effect the instance is not remembered, as in SvelteKit's own client.)
      const keyed = form.for(7);
      expect(keyed).not.toBe(form);
      keyed.fields.set({ name: "Keyed", age: 30 });
      expect(await keyed.submit()).toBe(true);
      expect(keyed.result).toMatchObject({ name: "Keyed" });

      // enhance(): the callback decides what happens after the preflight; its submit() sends the data it was started with.
      const calls: string[] = [];
      form.fields.set({ name: "Grace", age: 50 });
      form.enhance(async (instance: any) => {
        calls.push("enhance");
        const accepted = await instance.submit().updates();
        calls.push(`accepted ${accepted}`);
      });
      expect(await form.submit()).toBe(true);
      expect(calls).toEqual(["enhance", "accepted true"]);
      expect(form.result).toMatchObject({ name: "Grace", age: 50 });
      // Not reset by a custom enhance.
      expect(form.fields.name.value()).toBe("Grace");
      form.reset();
      expect(form.fields.name.value()).toBeUndefined();
    });

    test("form: a redirect from the handler goes through goto", async () => {
      configure();
      const form = m.native(api.sendMail);
      form.fields.to.set("ada@example.com");
      expect(await form.submit()).toBe(true);
      expect(redirects).toEqual(["/sent?to=ada%40example.com"]);
      form.fields.to.set("not an email");
      expect(await form.submit()).toBe(false);
      expect(form.fields.to.issues()?.[0].message).toContain("email");
    });

    test("prerender: runs on the server when there is no prerendered file", async () => {
      configure();
      expect(await api.buildInfo()).toEqual({ built: "fixture", answer: 42 });
      expect(await api.greeting("ada")).toBe("prerendered ada");
      expect(await api.greeting("grace")).toBe("prerendered grace");
    });

    test("a missing host fails at the first call, naming where to set it", async () => {
      m.resetRemoteConfig();
      for (const call of [() => api.hello("x"), () => api.increment(1), () => api.clock(), () => api.buildInfo(), () => api.double(1)]) {
        expect(call).toThrow(/No SvelteKit host is configured.*extra\.svelteNative\.remote\.origin/);
      }
      const form = m.native(api.signup);
      form.fields.set({ name: "Ada", age: 40 });
      await expect(form.submit()).rejects.toThrow(/No SvelteKit host is configured/);
    });

    test("the host comes from the app config: extra.svelteNative.remote", async () => {
      (globalThis as any).__expoConfig = { extra: { svelteNative: { remote: { origin: server.origin } } } };
      try {
        const fresh = await loadClient(ENTRY);
        expect(await fresh.api.hello("manifest")).toBe("hello manifest");
        // configureRemote overrides it.
        const calls: string[] = [];
        fresh.configureRemote({ origin: "http://127.0.0.1:9", handleError: () => {}, fetch: async (url: string) => { calls.push(url); throw new TypeError("offline"); } });
        expect(await rejection(fresh.api.hello("override"))).toBeDefined();
        expect(calls[0]).toStartWith("http://127.0.0.1:9/_app/remote/");
      } finally {
        delete (globalThis as any).__expoConfig;
      }
    });
  });
}

suite("dev");
suite("preview");
// React Native 0.86's Hermes has no FinalizationRegistry: the package supplies one (environment.ts), and the query objects of an effect are released by it.
suite("dev", true);
