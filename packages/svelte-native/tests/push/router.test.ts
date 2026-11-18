import { afterAll, beforeEach, describe, expect, jest, test } from "bun:test";
import { resolve } from "node:path";
import { snapshotGlobals } from "../support/globals.ts";
import { createStorage, memoryBackend } from "../../src/web-storage.ts";
import { handlersOf, navigationWorld, pathsOf, treeGlobals, turns, withInsets, type TreeApp, type TreeRouter } from "../navigation/support/world.ts";
import { src } from "../support/bundle.ts";
import { loadRouter, routerStubs, type RouterApp } from "../support/router.ts";
import { message, pushStubs, world, type PushWorld } from "./support/world.ts";

/**
 * A tapped notification is a link (PUSH.md, rule 1), through the router as it is: the real `<Router>` of the navigation tests over the push client, with the stand-in of the native
 * module behind it. The router reads the launch link from `Linking.getInitialURL()` and the later ones from `Linking.addEventListener("url")`; nothing in it knows about push.
 */
const { host, mountTree } = navigationWorld();
const fixture = resolve(import.meta.dirname, "fixtures/push-router-fixture.svelte");
const stubs = {
  ...routerStubs,
  // The navigation tests' stand-ins, with the native module of push and a `Linking` that can emit.
  "expo-modules-core": pushStubs["expo-modules-core"],
  "react-native/Libraries/Linking/Linking": pushStubs["react-native/Libraries/Linking/Linking"],
};

const snapshot = snapshotGlobals();
let pushWorld: PushWorld;
beforeEach(() => {
  pushWorld = world();
  withInsets(24);
  (globalThis as { localStorage?: Storage }).localStorage = createStorage(memoryBackend());
});
afterAll(() => snapshot.restore());

let surface = 300;
const mount = (hooks?: object) => mountTree(++surface, { initial: "/acme/home", hooks }, fixture, { stubs });

describe("a cold start by a tap", () => {
  test("opens the notification's path as the stack's base, with no back arrow, and the opened hook has run before", async () => {
    pushWorld.launch = message({ id: "launch", url: "/workspaces" });
    const seen: string[] = [];
    const app = await mount({ push: { opened: (arrived: { id: string }) => { seen.push(arrived.id); } } });
    await app.settled();
    expect(pathsOf(app.router)).toEqual(["/workspaces"]);
    expect(app.hardwareBack()).toBe(false);
    expect(seen).toEqual(["launch"]);
    expect(pushWorld.calls.filter((call) => call === "take")).toHaveLength(1);
  });

  test("opens it in an app whose hooks file has no push: the native module being there is what starts the client", async () => {
    pushWorld.launch = message({ id: "launch", url: "/workspaces" });
    const app = await mount();
    await app.settled();
    expect(pathsOf(app.router)).toEqual(["/workspaces"]);
    expect(app.hardwareBack()).toBe(false);
    // And a tap with the app running, the same way.
    pushWorld.dispatch("opened", message({ id: "later", url: "/acme/home" }));
    await app.settled();
    expect(pathsOf(app.router)).toEqual(["/workspaces", "/acme"]);
  });

  test("a full link of the app's own scheme opens the same way", async () => {
    pushWorld.launch = message({ url: "myapp://workspaces" });
    const app = await mount({ push: {} });
    await app.settled();
    expect(pathsOf(app.router)).toEqual(["/workspaces"]);
  });

  test("a hook that returns false stops it: the app starts on its first screen", async () => {
    pushWorld.launch = message({ url: "/workspaces" });
    const app = await mount({ push: { opened: () => false } });
    await app.settled();
    expect(pathsOf(app.router)).toEqual(["/acme"]);
  });

  test("a path no screen matches is ignored, as a link none matches is", async () => {
    pushWorld.launch = message({ url: "/a/b/c/d/e" });
    const app = await mount({ push: {} });
    await app.settled();
    expect(pathsOf(app.router)).toEqual(["/acme"]);
  });

  test("the link the platform launched the app with wins over the notification's", async () => {
    pushWorld.initialURL = "https://example.test/workspaces";
    pushWorld.launch = message({ url: "/acme/home" });
    const seen: string[] = [];
    const app = await mount({ push: { opened: (arrived: { id: string }) => { seen.push(arrived.id); } } });
    await app.settled();
    expect(pathsOf(app.router)).toEqual(["/workspaces"]);
    expect(seen).toEqual(["m1"]);
  });

  test("a launch by no tap, with push hooks, starts as it did", async () => {
    const app = await mount({ push: {} });
    await app.settled();
    expect(pathsOf(app.router)).toEqual(["/acme"]);
  });
});

describe("a process with no screen yet (iOS: the system started it for a background message)", () => {
  const hidden = (hooks: object) => mountTree(++surface, { initial: "/acme/home", hooks, mounted: false }, fixture, { stubs });
  const link = (url: string) => { for (const handler of [...pushWorld.linkHandlers]) handler({ url }); };

  test("a link that brings it to the foreground before the first screen exists opens when the screen mounts, as the stack's base", async () => {
    const app = await hidden({ push: {} });
    expect(pushWorld.linkHandlers).toHaveLength(1); // the push client's: no router hears links yet
    link("https://example.test/workspaces");
    app.app.show(true);
    await app.settled();
    expect(pathsOf(app.router)).toEqual(["/workspaces"]);
    expect(app.hardwareBack()).toBe(false);
    expect(pushWorld.linkHandlers).toHaveLength(1); // the router's alone from then on
    link("https://example.test/acme/home");
    await app.settled();
    expect(pathsOf(app.router)).toEqual(["/workspaces", "/acme"]);
  });

  test("a tap on a notification that brings it to the foreground opens the notification's path", async () => {
    pushWorld.launch = message({ id: "tap", url: "/workspaces" });
    const app = await hidden({ push: {} });
    app.app.show(true);
    await app.settled();
    expect(pathsOf(app.router)).toEqual(["/workspaces"]);
    expect(pushWorld.calls.filter((call) => call === "take")).toHaveLength(1);
  });
});

describe("a tap with the app running", () => {
  test("opens the notification's path like any link that arrives: the screen stacks and has its back arrow", async () => {
    const app = await mount({ push: {} });
    await app.settled();
    expect(pathsOf(app.router)).toEqual(["/acme"]);
    pushWorld.dispatch("opened", message({ url: "/workspaces" }));
    await app.settled();
    expect(pathsOf(app.router)).toEqual(["/acme", "/workspaces"]);
    expect(app.router.screens.filter((screen) => !screen.leaving).map((screen) => screen.canGoBack)).toEqual([false, true]);
  });

  test("a path with a search and a hash arrives whole", async () => {
    const app = await mount({ push: {} });
    await app.settled();
    pushWorld.dispatch("opened", message({ url: "/acme/inbox?tab=2#top" }));
    await app.settled();
    // The tabs layout is the stack's entry, and the inbox the screen it shows.
    const { pathname, search, hash } = app.router.current.url;
    expect([pathname, search, hash]).toEqual(["/acme/inbox", "?tab=2", "#top"]);
  });

  test("the opened hook runs before the link opens, and false stops it", async () => {
    const order: string[] = [];
    const app = await mount({
      push: {
        opened: async (arrived: { id: string }) => {
          await Promise.resolve();
          order.push(`hook ${arrived.id} while on ${pathsOf(app.router).join(",")}`);
          return arrived.id !== "stopped";
        },
      },
    });
    await app.settled();
    pushWorld.dispatch("opened", message({ id: "stopped", url: "/workspaces" }));
    await app.settled();
    expect(pathsOf(app.router)).toEqual(["/acme"]);
    pushWorld.dispatch("opened", message({ id: "open", url: "/workspaces" }));
    await app.settled();
    expect(order).toEqual(["hook stopped while on /acme", "hook open while on /acme"]);
    expect(pathsOf(app.router)).toEqual(["/acme", "/workspaces"]);
  });
});

/**
 * An Android Activity that is made again while the JavaScript runtime lives (the system ended it, or the user left and came back through a notification): its surface stops,
 * another starts in the same runtime with a router of its own, and that router reads the launch link when its `<Router>` mounts. A deep link that made the Activity is read by
 * `Linking.getInitialURL()` (the platform answers the new Activity's intent; `tests/navigation/surface-restore.test.ts` shows it for the router), and a notification's tap must
 * arrive the same way: the native module hands a tap over as the launch message or as an `opened` event depending on whether JavaScript has asked yet, and the old router is gone
 * when the event comes while the new one has not read.
 */
describe("an Activity made again while the runtime lives", () => {
  type Surface = { app: TreeApp; router: TreeRouter; tag: number };

  /** One bundle (one push client, one native stand-in) that surfaces start and stop in, as the host does for an Activity. */
  async function runtime() {
    const m = await loadRouter<RouterApp & { stopSurface: (rootTag: number) => void }>(`import Fixture from ${JSON.stringify(fixture)};
      import { startSurface, stopSurface, flush, fabricStats } from ${JSON.stringify(src("fabric/host.ts"))};
      import { openLaunchURL } from ${JSON.stringify(src("router.svelte.ts"))};
      import { tick } from 'svelte';
      export { startSurface, stopSurface, flush, fabricStats, openLaunchURL, tick, Fixture };`, { stubs });
    jest.useFakeTimers(); // a popped screen's exit timer must not fire into the test that runs after this one
    host.reset();
    treeGlobals.__treeRouters = {}; treeGlobals.__treeRoots = {};
    handlersOf("__backHandlers").length = 0;
    handlersOf("__linkHandlers").length = 0;
    const start = async (props: Record<string, unknown> = {}): Promise<Surface> => {
      const tag = ++surface;
      const app = m.startSurface(tag, m.Fixture, { initial: "/acme/home", hooks: { push: {} }, ...props }) as unknown as TreeApp;
      await turns(m);
      return { app, router: app.root?.() as TreeRouter, tag };
    };
    const stop = async (running: Surface): Promise<void> => { m.stopSurface(running.tag); await turns(m); };
    const stack = (running: Surface) => running.router.screens.filter((screen) => !screen.leaving).map((screen) => screen.canGoBack);
    return { m, start, stop, stack, settled: () => turns(m) };
  }

  test("a tap after the old surface stopped and before the new one mounted is the new router's launch: its screen is the base, as a deep link's is", async () => {
    const app = await runtime();
    const old = await app.start();
    expect(pathsOf(old.router)).toEqual(["/acme"]);
    await app.stop(old);
    pushWorld.dispatch("opened", message({ id: "tap", url: "/workspaces" })); // native: JavaScript took the launch message at the first read, so this is an event
    await app.settled();
    const next = await app.start();
    expect(pathsOf(next.router)).toEqual(["/workspaces"]);
    expect(app.stack(next)).toEqual([false]);
    expect(pushWorld.calls.filter((call) => call === "take")).toHaveLength(1); // the held tap was the launch; the first router took, and the native side had nothing for the second
  });

  test("the same, with a deep link: the platform answers the new Activity's intent and the router opens it the same way", async () => {
    const app = await runtime();
    const old = await app.start();
    await app.stop(old);
    pushWorld.initialURL = "https://app.invalid/workspaces";
    const next = await app.start();
    expect(pathsOf(next.router)).toEqual(["/workspaces"]);
    expect(app.stack(next)).toEqual([false]);
  });

  test("the hook of the tap ran once, at the tap, and false stops the link", async () => {
    const seen: string[] = [];
    const app = await runtime();
    const hooks = { push: { opened: (arrived: { id: string }) => { seen.push(arrived.id); return arrived.id !== "stopped"; } } };
    const old = await app.start({ hooks });
    await app.stop(old);
    pushWorld.dispatch("opened", message({ id: "tap", url: "/workspaces" }));
    pushWorld.dispatch("opened", message({ id: "stopped", url: "/acme/inbox" }));
    await app.settled();
    const next = await app.start({ hooks });
    expect(seen).toEqual(["tap", "stopped"]);
    expect(pathsOf(next.router)).toEqual(["/workspaces"]);
  });

  test("a launch from the icon after that does not open the last launch's link again", async () => {
    const app = await runtime();
    pushWorld.launch = message({ id: "launch", url: "/workspaces" });
    const cold = await app.start();
    expect(pathsOf(cold.router)).toEqual(["/workspaces"]);
    await app.stop(cold);
    const icon = await app.start(); // no tap, no link: the user opened the app
    expect(pathsOf(icon.router)).toEqual(["/acme"]);
    expect(pushWorld.calls.filter((call) => call === "take")).toHaveLength(2);
  });

  test("a tap while the router listens still stacks its screen on the one the user is on: nothing is held for the next surface", async () => {
    const app = await runtime();
    const running = await app.start();
    pushWorld.dispatch("opened", message({ url: "/workspaces" }));
    await app.settled();
    expect(pathsOf(running.router)).toEqual(["/acme", "/workspaces"]);
    await app.stop(running);
    const next = await app.start();
    expect(pathsOf(next.router)).toEqual(["/acme"]);
  });

  test("a tap while the new surface has its router but not its <Router> waits for the mount, and opens as the launch", async () => {
    const app = await runtime();
    const old = await app.start();
    await app.stop(old);
    const next = await app.start({ mounted: false });
    pushWorld.dispatch("opened", message({ id: "tap", url: "/workspaces" }));
    await app.settled();
    expect(pathsOf(next.router)).toEqual(["/acme"]);
    next.app.show(true);
    await app.settled();
    expect(pathsOf(next.router)).toEqual(["/workspaces"]);
    expect(app.stack(next)).toEqual([false]);
  });
});
