import { describe, expect, jest, test } from "bun:test";
import { directiveResponse, manifestResponse, noUpdateDirective } from "../updates/support/eas.ts";
import { turn, kitWorld } from "./support/kit.ts";

/** `updated` of `$app/state` is the library's over-the-air updates. */
const { world, load, freshWorld, startOn } = kitWorld();

describe("updated is the library's over-the-air updates", () => {
  const native = (overrides: Record<string, unknown> = {}, response: () => Response = () => directiveResponse(noUpdateDirective)) => {
    const calls: string[] = [];
    const store = { embeddedCreatedAt: 0, updates: {}, failedIds: [], metadata: { serverDefinedHeaders: null, manifestFilters: null } };
    return {
      calls,
      module: {
        isEnabled: true, platform: "android", updateId: null, runtimeVersion: "0.1.0", updateUrl: "https://u.expo.dev/p", requestHeaders: { "expo-channel-name": "production" },
        checkOnLaunch: "NEVER", hasEmbeddedUpdate: true, isEmbeddedLaunch: true, createdAt: 0, localAssets: {}, clientId: "c",
        readStore: async () => JSON.stringify(store),
        request: async () => { calls.push("request"); const answer = response(); return { status: answer.status, headers: Object.fromEntries(answer.headers), body: await answer.text() }; },
        downloadAsset: async (download: { key: string; hash: string }) => { calls.push("download"); return { key: download.key, hash: download.hash }; },
        commitUpdate: async () => { calls.push("commit"); },
        saveMetadata: async () => {},
        rollBackToEmbedded: async () => {},
        markLaunched: async () => {},
        reload: async () => {},
        ...overrides,
      },
    };
  };

  test("with updates off, `current` is false and `check()` resolves false without asking a server (no native module, and a development build)", async () => {
    for (const module of [null, native({ isEnabled: false }).module]) {
      freshWorld();
      world.__kitUpdates = module;
      const m = await load();
      expect(m.state.updated.current).toBe(false);
      expect(await m.state.updated.check()).toBe(false);
      expect(m.state.updated.current).toBe(false);
    }
  });

  test("a server with nothing new: check() is false; with an update: check() is true, `current` stays true, and an effect that read it runs again", async () => {
    const none = native();
    world.__kitUpdates = none.module;
    let m = await load();
    expect(await m.state.updated.check()).toBe(false);
    expect(none.calls).toEqual(["request"]);

    freshWorld();
    const found = native({}, () => manifestResponse());
    world.__kitUpdates = found.module;
    m = await load();
    startOn(m, m.Reader);
    await turn(m);
    expect(world.__kitReads.filter((line) => line.startsWith("updated"))).toEqual(["updated false"]);
    expect(await m.state.updated.check()).toBe(true);
    await turn(m);
    expect(world.__kitReads.filter((line) => line.startsWith("updated"))).toEqual(["updated false", "updated true"]);
    expect(m.state.updated.current).toBe(true);
    expect(await m.state.updated.check()).toBe(true); // known: no second request
    expect(found.calls).toEqual(["request"]);
  });

  test("an update the app fetched itself, or the launch check downloaded, is `current` too, with no check", async () => {
    const found = native({}, () => manifestResponse());
    world.__kitUpdates = found.module;
    const m = await load();
    expect(m.state.updated.current).toBe(false);
    expect((await m.updates.fetchUpdateAsync()).isNew).toBe(true);
    expect(found.calls).toContain("commit");
    expect(m.state.updated.current).toBe(true);
  });

  test("a check that fails (the network is down) resolves false and warns, as SvelteKit's does not reject", async () => {
    const failing = native({ request: async () => { throw new Error("offline"); } });
    world.__kitUpdates = failing.module;
    const m = await load();
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect(await m.state.updated.check()).toBe(false);
      expect(warn.mock.calls[0]?.[0]).toBe("[Svelte updates] the check for an update failed");
    } finally {
      warn.mockRestore();
    }
  });
});
