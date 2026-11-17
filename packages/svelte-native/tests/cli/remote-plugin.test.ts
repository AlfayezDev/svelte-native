// The `remote` option of the Expo config plugin: the host validated at config time, written where the runtime reads it, and the native builds allowed to
// reach an http: development server.
import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { allowAndroidCleartext, allowIosCleartext, atsExceptionDomain, isCleartext, remoteExtra, withRemoteHost } from "../../src/remote/plugin.ts";
import { hostFromExtra } from "../../src/remote/host.ts";

const config = (extra?: Record<string, unknown>) => ({ name: "app", slug: "app", ...(extra ? { extra } : {}) });
const thrown = (call: () => unknown): Error => { try { call(); } catch (error) { return error as Error; } throw new Error("did not throw"); };

describe("extra.svelteNative.remote", () => {
  test("the validated host is written under the key the runtime reads, and the rest of extra stays", () => {
    const extra = remoteExtra({ eas: { projectId: "p" }, svelteNative: { other: 1 } }, { origin: "http://localhost:3000/", base: "/app" });
    expect(extra).toEqual({ eas: { projectId: "p" }, svelteNative: { other: 1, remote: { origin: "http://localhost:3000", base: "/app", appDir: "_app" } } });
    // What the runtime makes of it.
    expect(hostFromExtra(extra)).toEqual({ origin: "http://localhost:3000", base: "/app", appDir: "_app" });
    expect(remoteExtra(undefined, { origin: "https://app.example.com" })).toEqual({ svelteNative: { remote: { origin: "https://app.example.com", base: "", appDir: "_app" } } });
  });
  test("a bad host stops the config, naming the value", () => {
    for (const origin of ["", "localhost:3000", "https://app.example.com/app", "ftp://x.example"]) expect([origin, thrown(() => remoteExtra({}, { origin })).name]).toEqual([origin, "RemoteConfigError"]);
    expect(thrown(() => remoteExtra({}, { origin: "https://a.example", base: "app" })).message).toContain('"app"');
    expect(thrown(() => remoteExtra({}, { origin: "https://a.example", appDir: "/_app" })).message).toContain('"/_app"');
  });
});

describe("plain HTTP", () => {
  test("only an http: origin needs it", () => {
    expect([isCleartext("http://localhost:3000"), isCleartext("https://app.example.com"), isCleartext("http://192.168.1.4:3000")]).toEqual([true, false, true]);
  });
  test("Android: cleartext traffic on the application element, others of its attributes kept", () => {
    const application: { $?: Record<string, string> } = { $: { "android:name": ".MainApplication" } };
    allowAndroidCleartext(application);
    expect(application.$).toEqual({ "android:name": ".MainApplication", "android:usesCleartextTraffic": "true" });
    const bare: { $?: Record<string, string> } = {};
    allowAndroidCleartext(bare);
    expect(bare.$).toEqual({ "android:usesCleartextTraffic": "true" });
  });
  test("iOS: App Transport Security does not cover addresses, unqualified names or .local, and an exception is made for a domain", () => {
    for (const origin of ["http://localhost:3000", "http://192.168.1.4:3000", "http://10.0.0.5", "http://macbook.local:3000", "http://[::1]:3000", "http://devbox:3000"]) expect([origin, atsExceptionDomain(origin)]).toEqual([origin, undefined]);
    expect(atsExceptionDomain("http://dev.example.com:3000")).toBe("dev.example.com");
    const plist: Record<string, unknown> = { CFBundleName: "app", NSAppTransportSecurity: { NSExceptionDomains: { "other.example": { NSIncludesSubdomains: true } }, NSAllowsLocalNetworking: true } };
    allowIosCleartext(plist, "http://dev.example.com:3000");
    expect(plist).toEqual({
      CFBundleName: "app",
      NSAppTransportSecurity: { NSAllowsLocalNetworking: true, NSExceptionDomains: { "other.example": { NSIncludesSubdomains: true }, "dev.example.com": { NSExceptionAllowsInsecureHTTPLoads: true, NSIncludesSubdomains: false } } },
    });
    const untouched: Record<string, unknown> = {};
    allowIosCleartext(untouched, "http://localhost:3000");
    expect(untouched).toEqual({});
  });
});

describe("the plugin", () => {
  const mods = (result: { mods?: Record<string, Record<string, unknown>> }) => Object.fromEntries(Object.entries(result.mods ?? {}).map(([platform, byName]) => [platform, Object.keys(byName)]));
  test("an https: host sets the extra and changes nothing native", () => {
    const result = withRemoteHost(config({ eas: {} }), { origin: "https://app.example.com" }) as { extra: unknown; mods?: Record<string, Record<string, unknown>> };
    expect(result.extra).toEqual({ eas: {}, svelteNative: { remote: { origin: "https://app.example.com", base: "", appDir: "_app" } } });
    expect(mods(result)).toEqual({});
  });
  test("an http: host also asks the Android manifest and Info.plist mods to allow it", () => {
    const result = withRemoteHost(config(), { origin: "http://dev.example.com:3000" }) as { extra: { svelteNative: { remote: { origin: string } } }; mods?: Record<string, Record<string, unknown>> };
    expect(result.extra.svelteNative.remote.origin).toBe("http://dev.example.com:3000");
    expect(mods(result)).toEqual({ android: ["manifest"], ios: ["infoPlist"] });
  });
  test("a bad host fails the plugin", () => {
    expect(thrown(() => withRemoteHost(config(), { origin: "nope" })).name).toBe("RemoteConfigError");
  });
});

describe("loading", () => {
  test("what the config plugin imports from its own files is loaded by Node's module loader, which wants `expo/config-plugins.js` spelled out", () => {
    // (`expo.ts` is transpiled by Expo's config loader, which turns its imports into requires; the files it requires are Node's to load.)
    for (const file of ["remote/plugin.ts", "remote/host.ts", "capabilities.ts"]) {
      const done = spawnSync("node", ["--input-type=module", "-e", `const loaded = await import(${JSON.stringify(new URL(`../../src/${file}`, import.meta.url).href)}); if (Object.keys(loaded).length === 0) process.exit(2);`], { encoding: "utf8" });
      expect([file, done.status, done.stderr.slice(0, 300)]).toEqual([file, 0, ""]);
    }
  });

  test("and it names no export that Expo defines with a getter (`AndroidConfig`, `XML`, `IOSConfig`): Node before 24 does not see those in a CommonJS module, whatever the Node that runs this test sees", () => {
    const expoRequire = createRequire(createRequire(import.meta.url).resolve("expo/package.json"));
    const index = readFileSync(expoRequire.resolve("@expo/config-plugins"), "utf8");
    const getters = [...index.matchAll(/Object\.defineProperty\(exports, "(\w+)"/g)].map((match) => match[1]);
    expect(getters).toContain("AndroidConfig");
    for (const file of ["remote/plugin.ts", "remote/host.ts", "capabilities.ts"]) {
      const source = readFileSync(new URL(`../../src/${file}`, import.meta.url), "utf8");
      const named = [...source.matchAll(/^import\s+(?!type\b)[^;]*?\{([^}]*)\}\s*from\s*"expo\/config-plugins(?:\.js)?";/gm)]
        .flatMap((match) => (match[1] ?? "").split(","))
        .map((name) => name.trim())
        .filter((name) => name !== "" && !name.startsWith("type "))
        .map((name) => name.split(/\s+as\s+/)[0]);
      expect([file, named.filter((name) => getters.includes(name ?? ""))]).toEqual([file, []]);
    }
  });
});
