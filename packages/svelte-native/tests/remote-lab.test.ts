// biome-ignore-all lint/suspicious/noExplicitAny: the client is a bundle loaded at run time and its remote functions are not typed
// The platform app's remote functions lab (/__dev/remote), host side: its server module is served by a real SvelteKit server (the fixture), and the lab's own
// checks, the ones its "Run the checks" button runs on a device, run against it through the native client runtime. What a device adds is Hermes, the platform's
// networking and the screen.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { cpSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { cookieFetch, fixtureRoot, loadClient, startServer, type Server } from "./remote-harness.ts";

/* eslint-disable @typescript-eslint/no-explicit-any */
const platform = resolve(import.meta.dirname, "../../../apps/platform/src/lib/native/dev");
const copy = join(fixtureRoot, "src/lib/lab/remote-lab.remote.ts");

describe("the remote functions lab", () => {
  let server: Server;
  let m: Record<string, any>;

  beforeAll(async () => {
    mkdirSync(dirname(copy), { recursive: true });
    cpSync(join(platform, "remote-lab.remote.ts"), copy);
    server = await startServer("dev");
    // The lab imports the module from the platform app; the server has it where the fixture can serve it, and the ids are the server's.
    m = await loadClient(`
      export { checks } from "${join(platform, "remote-lab-checks.ts")}";
      export { applyLabOrigin } from "${join(platform, "remote-lab-host.ts")}";
      export * from "../src/remote/index.ts";
      export { linkRouter } from "../src/remote/router-link.ts";
    `, fixtureRoot, (file) => (file === join(platform, "remote-lab.remote.ts") ? copy : file));
  }, 180_000);
  afterAll(() => {
    server?.stop();
    rmSync(dirname(copy), { recursive: true, force: true });
  });

  test("every check the lab runs passes against the lab's server module", async () => {
    // (The platform keeps cookies for Expo's fetch; this one keeps them itself.)
    m.configureRemote({ origin: server.origin, fetch: cookieFetch().send });
    const unlink = m.linkRouter({ goto: () => {}, current: { url: new URL("https://native.invalid/__dev/remote") } });
    const results: Record<string, string> = {};
    for (const check of m.checks) {
      try { results[check.id] = `pass: ${await check.run()}`; } catch (error) { results[check.id] = `fail: ${(error as Error).message}`; }
    }
    unlink();
    expect(Object.keys(results)).toEqual(["query", "types", "error", "batch", "live", "command", "updates", "probe", "prerender", "redirect", "form"]);
    expect(Object.entries(results).filter(([, result]) => !result.startsWith("pass"))).toEqual([]);
    expect(results.probe).toStartWith(`pass: Origin ${server.origin}, /__dev/remote`);
  }, 60_000);

  test("the page's origin override (?origin=, the host field) changes the host only in a build with the lab on", () => {
    m.resetRemoteConfig();
    m.configureRemote({ origin: "https://app.example.com" });
    expect(m.applyLabOrigin("http://evil.example", false)).toBe(false);
    expect(m.applyLabOrigin(null, true)).toBe(false);
    expect(m.applyLabOrigin("", true)).toBe(false);
    expect(m.remoteHost().origin).toBe("https://app.example.com");
    expect(m.applyLabOrigin("http://localhost:3000", true)).toBe(true);
    expect(m.remoteHost().origin).toBe("http://localhost:3000");
    // (A value that is not an origin is refused, as everywhere.)
    expect(() => m.applyLabOrigin("not an origin", true)).toThrow(/not a URL|must be/);
    m.resetRemoteConfig();
  });
});
