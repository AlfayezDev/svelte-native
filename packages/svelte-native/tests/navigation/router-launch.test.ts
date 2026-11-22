import { expect, jest, test } from "bun:test";
import { routeFiles } from "../../src/build.ts";
import { parseNativeID } from "../../src/fabric/navigation.ts";
import { type FakeNode, type TreeRouter, ofKind, withInsets, handlersOf, treeGlobals, pathsOf, paneRouter, tabScreens, navigationWorld, standInRoutes } from "./support/world.ts";

/** The launch link: read once and bounded, opened ahead of the <Router> or by it, and what a restart does with it. */
const { host, selectedIndex, mountTree } = navigationWorld();

test("the launch link is the stack's base: no back arrow on /__dev; later links are plain gotos", async () => {
  withInsets(24);
  const launch = globalThis as { __initialURL?: string };
  const files = await routeFiles(standInRoutes, { lab: true });
  const arrows = (router: TreeRouter) => router.screens.filter((screen) => !screen.leaving).map((screen) => screen.canGoBack);
  const backOf = (surface: number) => Object.fromEntries(ofKind(host.roots[surface], "header").map((node) => {
    const pairs = parseNativeID(String(node.props.nativeID))?.pairs ?? {};
    return [decodeURIComponent(String(pairs.t)), pairs.bk === "1"];
  }));

  launch.__initialURL = "rasheed-svelte:///__dev";
  const lab = await mountTree(134, { initial: "/sign-in", files });
  await lab.settled();
  expect(pathsOf(lab.router)).toEqual(["/__dev"]); // a direct load has no history: the sign-in is not below it
  expect(arrows(lab.router)).toEqual([false]);
  expect(backOf(134)["/__dev"]).toBe(false); // so the lab's header has no arrow, and its declared controls have no Back
  expect(lab.hardwareBack()).toBe(false);
  // A link that arrives while the app runs opens like any goto: the screen stacks and has its arrow.
  for (const handler of handlersOf("__linkHandlers")) (handler as (event: { url: string }) => void)({ url: "rasheed-svelte:///__dev/screens" });
  await lab.settled();
  expect(pathsOf(lab.router)).toEqual(["/__dev", "/__dev/screens"]);
  expect(arrows(lab.router)).toEqual([false, true]);

  // A project opened by the launch link is the base too: the tabs are the root's only entry.
  launch.__initialURL = "https://example.test/acme/settings";
  const project = await mountTree(135, { initial: "/sign-in", files, tabs: [{ key: "home", title: "Home" }, { key: "settings", title: "Settings" }] });
  await project.settled();
  expect(pathsOf(project.router)).toEqual(["/acme"]);
  expect(selectedIndex(135)).toBe("1");
  expect(arrows(project.router)).toEqual([false]);
  expect(project.hardwareBack()).toBe(false);

  // A link no screen matches is ignored: the app stays on its first screen.
  launch.__initialURL = "rasheed-svelte:///a/b/c/d/e";
  const nothing = await mountTree(136, { initial: "/sign-in", files });
  await nothing.settled();
  expect(pathsOf(nothing.router)).toEqual(["/sign-in"]);
});

test("the launch link can be opened before the root <Router> mounts: the first screen is never rendered, nothing waits for its exit, and the mount does not open the link again", async () => {
  withInsets(24);
  const launch = globalThis as { __initialURL?: string; __initialURLReads?: number };
  launch.__initialURL = "https://example.test/workspaces";
  const { m, app, router, settled, texts: shown, hardwareBack } = await mountTree(190, { initial: "/acme/home", mounted: false });
  expect(shown()).toEqual([]);
  expect(pathsOf(router)).toEqual(["/acme"]); // the router's first screen, which a shell that decides by the link does not want rendered
  await m.openLaunchURL(router);
  expect(pathsOf(router)).toEqual(["/workspaces"]);
  expect(router.screens.map((screen) => screen.leaving)).toEqual([false]); // no native stack ever showed the first screen, so none reports its exit
  expect(launch.__initialURLReads).toBe(1);
  expect(await m.openLaunchURL(router)).toBe("https://example.test/workspaces"); // asked again: the same read, and the link is not opened a second time
  expect(launch.__initialURLReads).toBe(1);
  expect(handlersOf("__linkHandlers")).toHaveLength(0);

  app.show(true);
  await settled();
  expect(Object.keys(treeGlobals.__treeRouters ?? {})).toEqual(["/workspaces"]); // the first screen's page never ran
  expect(shown()).toContain("page /workspaces");
  expect(pathsOf(router)).toEqual(["/workspaces"]);
  expect(launch.__initialURLReads).toBe(1); // the <Router> found the link opened
  expect(handlersOf("__linkHandlers")).toHaveLength(1);
  expect(hardwareBack()).toBe(false); // the launch link is the base of the stack

  // From here the screens leave through the native stack as before: a replaced screen stays until its exit is reported.
  router.goto("/acme/home");
  await settled();
  expect(router.screens.map((screen) => screen.leaving)).toEqual([false, false]);
  router.goto("/workspaces", { reset: true });
  await settled();
  expect(router.screens.filter((screen) => screen.leaving)).toHaveLength(2);
});

/** Every native node's own props that a stack is built from, screens and headers of the tab panes, as the host would receive them. */
const paneNodes = (tree: FakeNode[]) => tabScreens(tree).map((screens) => screens.map((screen) => [String(screen.props.nativeID), ...ofKind(screen.children, "header").map((header) => String(header.props.nativeID))]));

test("a cold start by a link to a sheet under a pane's stack, opened ahead of the <Router> or by it, gives the stacks and native screens a warm link to it gives", async () => {
  withInsets(24);
  const launch = globalThis as { __initialURL?: string };
  // What the app shows once the link is open: the root stack, the pane's stack with the presentation and the back arrow of each screen, the selected tab, and every native screen and header.
  const observed = (surface: number, router: TreeRouter) => {
    const pane = paneRouter("/acme/inbox/compose");
    return {
      root: pathsOf(router),
      pane: pathsOf(pane),
      presentations: pane.entries.map((entry) => entry.presentation),
      screens: pane.screens.map((screen) => [screen.canGoBack, screen.leaving]),
      selected: selectedIndex(surface),
      nodes: paneNodes(host.roots[surface]),
    };
  };
  launch.__initialURL = "rasheed://acme/inbox/compose";
  const ahead = await mountTree(198, { initial: "/workspaces", mounted: false });
  expect(await ahead.m.openLaunchURL(ahead.router)).toBe("rasheed://acme/inbox/compose");
  ahead.app.show(true);
  await ahead.settled();
  const first = observed(198, ahead.router);
  const after = await mountTree(199, { initial: "/workspaces" });
  await after.settled(); // the <Router>'s own read of the link opens it
  const second = observed(199, after.router);
  // The warm link: the app is running on the inbox and is told of the same link.
  delete launch.__initialURL;
  const warm = await mountTree(200, { initial: "/acme/inbox" });
  expect(pathsOf(paneRouter("/acme/inbox"))).toEqual(["/acme/inbox"]);
  expect(warm.router.openURL("rasheed://acme/inbox/compose")).toBe(true);
  await warm.settled();
  const third = observed(200, warm.router);
  expect(first.root).toEqual(["/acme"]);
  expect(first.pane).toEqual(["/acme/inbox", "/acme/inbox/compose"]);
  expect(first.presentations).toEqual(["push", "sheet"]);
  expect(first.screens).toEqual([[false, false], [true, false]]);
  expect(first.selected).toBe("1");
  // A cold start, however the link is opened, is the warm link: the same stacks, the same presentations, the same screens for the native side.
  expect(first).toEqual(third);
  expect(second).toEqual(third);
});

test("the read of the launch link is bounded and a failed read is not remembered", async () => {
  withInsets(24);
  const launch = globalThis as { __initialURL?: string; __initialURLReads?: number; __initialURLMode?: string };
  launch.__initialURL = "https://example.test/workspaces";
  const { m, app, router, settled } = await mountTree(191, { initial: "/acme/home", mounted: false });
  // The platform's read fails: the caller hears of it, and the next ask reads again instead of getting the same failure.
  launch.__initialURLMode = "reject";
  await expect(m.openLaunchURL(router)).rejects.toThrow("the link service is down");
  expect(pathsOf(router)).toEqual(["/acme"]);
  delete launch.__initialURLMode;
  await m.openLaunchURL(router);
  expect(launch.__initialURLReads).toBe(2);
  expect(pathsOf(router)).toEqual(["/workspaces"]);
  app.show(true);
  await settled();
  expect(launch.__initialURLReads).toBe(2); // read once for good now

  // A platform that never answers: the wait ends after three seconds and the app starts as if it had no link.
  const second = await mountTree(192, { initial: "/acme/home", mounted: false });
  launch.__initialURLMode = "hang";
  let settledAfter = "pending";
  void second.m.openLaunchURL(second.router).then(() => { settledAfter = "settled"; });
  await second.settled();
  jest.advanceTimersByTime(2_999);
  await second.settled();
  expect(settledAfter).toBe("pending");
  jest.advanceTimersByTime(1);
  await second.settled();
  expect(settledAfter).toBe("settled");
  expect(pathsOf(second.router)).toEqual(["/acme"]); // no link: the router stays on its first screen
});

test("the launch link is read once, and a platform that answers after the three seconds is still heard: opened if nothing has navigated since, never twice", async () => {
  withInsets(24);
  const launch = globalThis as { __initialURL?: string; __initialURLReads?: number; __initialURLMode?: string; __resolveInitialURL?: (url: string | null) => void };
  // The answer comes late and the stack is as the app left it: the link is the launch's, and it opens (reset: its screen is the base).
  launch.__initialURLMode = "late";
  const first = await mountTree(194, { initial: "/acme/home", mounted: false });
  const settledWith: (string | null)[] = [];
  void first.m.openLaunchURL(first.router).then((url) => { settledWith.push(url); });
  jest.advanceTimersByTime(3_000);
  await first.settled();
  expect(settledWith).toEqual([null]); // the app goes on without it
  expect(pathsOf(first.router)).toEqual(["/acme"]);
  launch.__resolveInitialURL?.("https://example.test/workspaces");
  await first.settled();
  expect(pathsOf(first.router)).toEqual(["/workspaces"]);
  expect(first.router.screens.map((screen) => screen.canGoBack)).toEqual([false]);
  first.app.show(true); // a <Router> mounting afterwards neither reads nor opens it again
  await first.settled();
  expect(launch.__initialURLReads).toBe(1);
  expect(pathsOf(first.router)).toEqual(["/workspaces"]);
  first.app.show(false);
  await first.settled();
  first.app.show(true);
  await first.settled();
  expect(launch.__initialURLReads).toBe(1);

  // The user went on while the platform was silent: the late answer is dropped.
  const second = await mountTree(195, { initial: "/acme/home", mounted: false });
  void second.m.openLaunchURL(second.router);
  jest.advanceTimersByTime(3_000);
  await second.settled();
  second.router.goto("/acme/inbox");
  await second.settled();
  const before = pathsOf(second.router);
  launch.__resolveInitialURL?.("https://example.test/workspaces");
  await second.settled();
  expect(pathsOf(second.router)).toEqual(before);
  second.app.show(true);
  await second.settled();
  expect(pathsOf(second.router)).toEqual(before); // and the <Router> that mounts does not open it either
});

test("a link that is refused ahead of the <Router> is left for it, and a read that failed is not applied once the app has gone on", async () => {
  withInsets(24);
  const launch = globalThis as { __initialURL?: string; __initialURLReads?: number; __initialURLMode?: string };
  launch.__initialURL = "https://example.test/workspaces";
  const refused = await mountTree(196, { initial: "/acme/home", mounted: false });
  expect(await refused.m.openLaunchURL(refused.router, (url: string) => !url.includes("workspaces"))).toBe("https://example.test/workspaces");
  expect(pathsOf(refused.router)).toEqual(["/acme"]); // not opened here
  refused.app.show(true);
  await refused.settled();
  expect(pathsOf(refused.router)).toEqual(["/workspaces"]); // the <Router>'s own call opens it
  expect(launch.__initialURLReads).toBe(1); // from the one read

  // The first read fails; the app goes on (a sign-out sends it to the login and remounts the <Router>); the read that then succeeds is the cold start's, long stale.
  const stale = await mountTree(197, { initial: "/acme/home", mounted: false });
  launch.__initialURLMode = "reject";
  await expect(stale.m.openLaunchURL(stale.router)).rejects.toThrow("the link service is down");
  stale.router.goto("/acme/inbox");
  await stale.settled();
  const before = pathsOf(stale.router);
  delete launch.__initialURLMode;
  expect(await stale.m.openLaunchURL(stale.router)).toBe("https://example.test/workspaces");
  await stale.settled();
  expect(pathsOf(stale.router)).toEqual(before);
  stale.app.show(true);
  await stale.settled();
  expect(pathsOf(stale.router)).toEqual(before);
});

/** What the root router would leave for a restart or a hot remount right now (`hmrState().navigation`). */
const savedNavigation = () => (globalThis as { __svelteNativeHmrState?: { navigation?: () => { stack: object; launch?: string } } }).__svelteNativeHmrState?.navigation?.();

test("a launch link that is dropped is recorded as the one acted on, so a restart that gets the intent again does not replay it over the restored screens", async () => {
  withInsets(24);
  const launch = globalThis as { __initialURL?: string; __initialURLReads?: number; __initialURLMode?: string; __resolveInitialURL?: (url: string | null) => void; __svelteNativeHmrState?: { restore?: unknown } };
  const link = "https://example.test/workspaces";
  // An answer that comes after the app navigated is dropped...
  delete launch.__svelteNativeHmrState;
  launch.__initialURLMode = "late";
  const first = await mountTree(198, { initial: "/acme/home", mounted: false });
  void first.m.openLaunchURL(first.router);
  jest.advanceTimersByTime(3_000);
  await first.settled();
  first.router.goto("/acme/inbox");
  await first.settled();
  launch.__resolveInitialURL?.(link);
  await first.settled();
  expect(pathsOf(first.router)).toEqual(["/acme"]);
  // ...but remembered as the launch's: it is in the state a restart gets.
  const saved = savedNavigation();
  expect(saved?.launch).toBe(link);
  // The process dies and Android delivers the same intent to the restored app: the restored screens stay.
  delete launch.__initialURLMode;
  launch.__initialURL = link;
  (launch.__svelteNativeHmrState as { restore?: unknown }).restore = saved;
  const restored = await mountTree(199, { initial: "/acme/home" });
  await restored.settled();
  expect(pathsOf(restored.router)).toEqual(["/acme"]);
  expect(launch.__initialURLReads).toBe(1);

  // A read that failed and was asked again after the app went on is dropped the same way.
  delete launch.__svelteNativeHmrState;
  launch.__initialURLMode = "reject";
  const stale = await mountTree(200, { initial: "/acme/home", mounted: false });
  await expect(stale.m.openLaunchURL(stale.router)).rejects.toThrow("the link service is down");
  stale.router.goto("/acme/inbox");
  await stale.settled();
  delete launch.__initialURLMode;
  await stale.m.openLaunchURL(stale.router);
  expect(pathsOf(stale.router)).toEqual(["/acme"]);
  expect(savedNavigation()?.launch).toBe(link);
});

test("a late answer is judged as a timely one is: not after a failed read and a navigation, and by the caller's accept", async () => {
  withInsets(24);
  const launch = globalThis as { __initialURL?: string; __initialURLReads?: number; __initialURLMode?: string; __resolveInitialURL?: (url: string | null) => void };
  const link = "https://example.test/workspaces";
  // The first read fails, the app goes on, the second read is silent for three seconds and then answers: the answer is the cold start's, long stale.
  launch.__initialURLMode = "reject";
  const stale = await mountTree(201, { initial: "/acme/home", mounted: false });
  await expect(stale.m.openLaunchURL(stale.router)).rejects.toThrow("the link service is down");
  stale.router.goto("/acme/inbox");
  await stale.settled();
  launch.__initialURLMode = "late";
  void stale.m.openLaunchURL(stale.router);
  jest.advanceTimersByTime(3_000);
  await stale.settled();
  launch.__resolveInitialURL?.(link); // nothing navigated since the wait ended, but the app had gone on before the read
  await stale.settled();
  expect(pathsOf(stale.router)).toEqual(["/acme"]);
  stale.app.show(true);
  await stale.settled();
  expect(pathsOf(stale.router)).toEqual(["/acme"]);

  // The caller refused the link for the moment: a late answer is not opened behind its back, and waits for the next call, the <Router>'s.
  launch.__initialURLMode = "late";
  const refused = await mountTree(202, { initial: "/acme/home", mounted: false });
  void refused.m.openLaunchURL(refused.router, (url: string) => !url.includes("workspaces"));
  jest.advanceTimersByTime(3_000);
  await refused.settled();
  launch.__resolveInitialURL?.(link);
  await refused.settled();
  expect(pathsOf(refused.router)).toEqual(["/acme"]);
  refused.app.show(true); // the <Router> mounts, asks, and finds the answer that was left for it
  await refused.settled();
  expect(pathsOf(refused.router)).toEqual(["/workspaces"]);
  expect(launch.__initialURLReads).toBe(1);

  // Left for the next call, but the app navigated before it came: dropped.
  launch.__initialURLMode = "late";
  const gone = await mountTree(203, { initial: "/acme/home", mounted: false });
  void gone.m.openLaunchURL(gone.router, (url: string) => !url.includes("workspaces"));
  jest.advanceTimersByTime(3_000);
  await gone.settled();
  launch.__resolveInitialURL?.(link);
  await gone.settled();
  gone.router.goto("/acme/inbox");
  await gone.settled();
  gone.app.show(true);
  await gone.settled();
  expect(pathsOf(gone.router)).toEqual(["/acme"]);
});

test("a read that throws at once is forgotten like one that rejects, and leaves no timer behind", async () => {
  withInsets(24);
  const launch = globalThis as { __initialURL?: string; __initialURLReads?: number; __initialURLMode?: string };
  const timers = () => (jest as unknown as { getTimerCount(): number }).getTimerCount();
  launch.__initialURL = "https://example.test/workspaces";
  const { m, app, router, settled } = await mountTree(204, { initial: "/acme/home", mounted: false });
  const before = timers();
  launch.__initialURLMode = "throw";
  await expect(m.openLaunchURL(router)).rejects.toThrow("the link service threw at once");
  expect(timers()).toBe(before); // the three seconds' wait was cleared, not left to fire
  await expect(m.openLaunchURL(router)).rejects.toThrow("the link service threw at once"); // asked again, not the same rejection from a cache
  expect(launch.__initialURLReads).toBe(2);
  delete launch.__initialURLMode;
  expect(await m.openLaunchURL(router)).toBe("https://example.test/workspaces");
  expect(pathsOf(router)).toEqual(["/workspaces"]);
  app.show(true);
  await settled();
  expect(launch.__initialURLReads).toBe(3);
  expect(pathsOf(router)).toEqual(["/workspaces"]);
});

test("a link that arrives while the platform is still answering for the launch link is the newer one: the launch link's answer does not reset the app over it (#85)", async () => {
  withInsets(24);
  const launch = globalThis as { __initialURLMode?: string; __resolveInitialURL?: (url: string | null) => void };
  const emit = (url: string) => { for (const handler of handlersOf("__linkHandlers")) (handler as (event: { url: string }) => void)({ url }); };
  launch.__initialURLMode = "late";
  try {
    const newer = await mountTree(206, { initial: "/workspaces" });
    emit("https://example.test/account");
    await newer.settled();
    expect(pathsOf(newer.router)).toEqual(["/workspaces", "/account"]);
    launch.__resolveInitialURL?.("https://example.test/acme/home"); // within the three seconds
    await newer.settled();
    expect(pathsOf(newer.router)).toEqual(["/workspaces", "/account"]);
    newer.app.show(false);
    await newer.settled();

    // A link no screen matches opens nothing, so the launch link still opens.
    const unmatched = await mountTree(207, { initial: "/workspaces" });
    emit("https://example.test/a/b/c/d/e");
    await unmatched.settled();
    launch.__resolveInitialURL?.("https://example.test/account");
    await unmatched.settled();
    expect(pathsOf(unmatched.router)).toEqual(["/account"]);
    unmatched.app.show(false);
    await unmatched.settled();

    // The launch link answered first: it is the base, and the newer link stacks on it.
    const first = await mountTree(208, { initial: "/workspaces" });
    launch.__resolveInitialURL?.("https://example.test/account");
    await first.settled();
    emit("https://example.test/workspaces");
    await first.settled();
    expect(pathsOf(first.router)).toEqual(["/account", "/workspaces"]);
  } finally {
    delete launch.__initialURLMode;
  }
});
