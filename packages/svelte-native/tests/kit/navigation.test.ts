import { describe, expect, test } from "bun:test";
import { kitExports } from "./support/kit-types.ts";
import { type Router, pathsOf, turn, where, kitWorld } from "./support/kit.ts";

/** SvelteKit's `$app/navigation` and `$app/state` on the device: what `goto` does from outside any component, and what a screen reads from `page`. */
const { world, load, mountApp, startOn } = kitWorld();

describe("goto drives the app's root router from any code", () => {
  test("it selects the tab a route is in, pushes in a tab, opens a modal over the tabs and replaces a screen, and the page follows each", async () => {
    const m = await load();
    const { router, settle } = await mountApp(m, { initial: "/workspaces" });
    const go = async (url: string | URL, options?: object) => { await m.navigation.goto(url, options); await settle(); };
    expect(where(m)).toBe("/workspaces {} /workspaces");

    // A route that is a project's tabs screen: its first pane's page.
    await go("/acme");
    expect(pathsOf(router)).toEqual(["/workspaces", "/acme"]);
    expect(where(m)).toBe('/acme/home {"slug":"acme"} /(workspace)/[slug]/(tabs)/home');

    // Another tab is a selection: nothing is pushed on the root, and the page is the other pane's.
    await go("/acme/inbox");
    expect(pathsOf(router)).toEqual(["/workspaces", "/acme"]);
    expect(where(m)).toBe('/acme/inbox {"slug":"acme"} /(workspace)/[slug]/(tabs)/inbox');

    // A page of a tab's stack: the tab is selected again, the page pushed, and its parameters come with it.
    await go("/acme/home/thread/7");
    expect(where(m)).toBe('/acme/home/thread/7 {"slug":"acme","id":"7"} /(workspace)/[slug]/(tabs)/home/thread/[id]');
    // A relative URL is read against the screen the user sees, as the browser reads it; a URL object is taken as it is.
    await go("9");
    expect(where(m)).toBe('/acme/home/thread/9 {"slug":"acme","id":"9"} /(workspace)/[slug]/(tabs)/home/thread/[id]');
    await go(new URL("/acme/home/thread/10?tab=1#top", m.state.page.url));
    expect(m.state.page.url.search + m.state.page.url.hash).toBe("?tab=1#top");

    // A modal covers the tabs, and it is the page now; back closes it and the page is the thread again.
    await go("/account");
    expect(pathsOf(router)).toEqual(["/workspaces", "/acme", "/account"]);
    expect(router.entries[2].presentation).toBe("modal");
    expect(where(m)).toBe("/account {} /(account)/account");
    expect(router.back()).toBe(true);
    await settle();
    expect(where(m)).toBe('/acme/home/thread/10 {"slug":"acme","id":"10"} /(workspace)/[slug]/(tabs)/home/thread/[id]');

    // Back to the first screen: its own route, with the stacks it left.
    await go("/workspaces");
    expect(pathsOf(router)).toEqual(["/workspaces"]);
    expect(where(m)).toBe("/workspaces {} /workspaces");
  });

  test("`replace` (and `replaceState`, SvelteKit's deprecated name) replaces the top screen instead of pushing; `reset`, `refreshAll`, `invalidate`, `invalidateAll` and `persistState` are ignored", async () => {
    const m = await load();
    const { router, settle } = await mountApp(m, { initial: "/workspaces" });
    await m.navigation.goto("/account");
    await settle();
    expect(pathsOf(router)).toEqual(["/workspaces", "/account"]);
    await m.navigation.goto("/workspaces", { replace: true });
    await settle();
    expect(pathsOf(router)).toEqual(["/workspaces", "/workspaces"]);
    await m.navigation.goto("/account", { replaceState: true });
    await settle();
    expect(pathsOf(router)).toEqual(["/workspaces", "/account"]);
    // `reset: true` is SvelteKit's scroll and focus reset, not the router's `reset` (which drops the history): the stack is kept.
    await m.navigation.goto("/workspaces", { reset: true, refreshAll: true, invalidate: ["x:y"], invalidateAll: true, persistState: true });
    await settle();
    expect(pathsOf(router)).toEqual(["/workspaces"]);
  });

  test("`replace` wins over `replaceState`, its deprecated name, as in SvelteKit: a pushed screen when `replace` is false, a replaced one when only `replaceState` is given", async () => {
    const m = await load();
    const { router, settle } = await mountApp(m, { initial: "/workspaces" });
    await m.navigation.goto("/account", { replace: false, replaceState: true });
    await settle();
    expect(pathsOf(router)).toEqual(["/workspaces", "/account"]);
    await m.navigation.goto("/workspaces", { replace: undefined, replaceState: true });
    await settle();
    expect(pathsOf(router)).toEqual(["/workspaces", "/workspaces"]);
    await m.navigation.goto("/account", { replace: true, replaceState: false });
    await settle();
    expect(pathsOf(router)).toEqual(["/workspaces", "/account"]);
  });

  test("it rejects for what the device cannot do: no screen for the path, `shallow`, `state`, and an app that has no router (yet, or any more)", async () => {
    const m = await load();
    await expect(m.navigation.goto("/workspaces")).rejects.toThrow("goto needs the app's router, which does not exist yet");
    const { router, settle, tag } = await mountApp(m, { initial: "/workspaces" });
    await expect(m.navigation.goto("/no/where/at/all")).rejects.toThrow("No native screen for /no/where/at/all");
    await expect(m.navigation.goto("/account", { shallow: true })).rejects.toThrow("`shallow` in the options of goto is not available on the device yet (svelte-native)");
    await expect(m.navigation.goto("/account", { state: { a: 1 } })).rejects.toThrow("`state` in the options of goto is not available on the device yet (svelte-native)");
    await settle();
    expect(pathsOf(router)).toEqual(["/workspaces"]); // none of them navigated
    m.stopSurface(tag);
    await expect(m.navigation.goto("/account")).rejects.toThrow("goto needs the app's router");
  });

  test("a URL of another site or a scheme of the system is opened by the system, as `<a href>` does, and the screen stays", async () => {
    const m = await load();
    const { router, settle } = await mountApp(m, { initial: "/workspaces" });
    await m.navigation.goto("https://example.com/docs?a=1");
    await m.navigation.goto("mailto:someone@example.com");
    await m.navigation.goto(new URL("tel:+15550100"));
    await settle();
    expect(world.__kitOpened).toEqual(["https://example.com/docs?a=1", "mailto:someone@example.com", "tel:+15550100"]);
    expect(pathsOf(router)).toEqual(["/workspaces"]);
  });
});

describe("what an effect that navigates does not depend on", () => {
  test("goto, match and preloadCode called in an effect do not make it run again for the screens the user pushes, as SvelteKit's do not; nor does the router's own goto", async () => {
    const m = await load();
    const { router, settle, inEffect } = await mountApp(m, { initial: "/workspaces" });
    const ignore = (promise: unknown) => void (promise as Promise<unknown>).catch(() => {});
    const effects = {
      goto: inEffect(() => ignore(m.navigation.goto("/workspaces", { replace: true }))),
      match: inEffect(() => ignore(m.paths.match("/workspaces"))),
      preload: inEffect(() => ignore(m.navigation.preloadCode("/workspaces"))),
      router: inEffect(() => router.goto("/workspaces", { replaceState: true })),
    };
    await settle();
    expect(Object.values(effects).map((effect) => effect.runs())).toEqual([1, 1, 1, 1]);
    // The user pushes screens: nothing the effects read has changed for them.
    router.goto("/account");
    await settle();
    router.goto("/acme/home/thread/7");
    await settle();
    expect(Object.values(effects).map((effect) => effect.runs())).toEqual([1, 1, 1, 1]);
    expect(pathsOf(router)).toEqual(["/workspaces", "/account", "/acme"]);
    for (const effect of Object.values(effects)) effect.stop();
  });
});

describe("the app's root router is the newest one that is alive", () => {
  test("a surface that starts before another one stops, in the same turn, keeps the registration; goto and page are the new surface's", async () => {
    const m = await load();
    const first = await mountApp(m, { initial: "/workspaces" });
    expect(m.rootRouter()).toBe(first.router);
    const { app: second } = startOn(m, m.Fixture, { initial: "/workspaces" });
    m.stopSurface(first.tag); // no turn in between: the teardown runs in the batch that registered the new router
    await turn(m);
    const router = (second.root as () => Router)();
    expect(m.rootRouter()).toBe(router);
    await m.navigation.goto("/account");
    await turn(m);
    expect(pathsOf(router)).toEqual(["/workspaces", "/account"]);
    expect(where(m)).toBe("/account {} /(account)/account");
  });

  test("with two alive, stopping the newer one falls back to the older one, and stopping that leaves none", async () => {
    const m = await load();
    const older = await mountApp(m, { initial: "/workspaces" });
    const newer = await mountApp(m, { initial: "/account" });
    expect(m.rootRouter()).toBe(newer.router);
    // Stopping the older one while the newer is alive changes nothing.
    const third = await mountApp(m, { initial: "/workspaces" });
    m.stopSurface(newer.tag);
    await turn(m);
    expect(m.rootRouter()).toBe(third.router);
    m.stopSurface(third.tag);
    await turn(m);
    expect(m.rootRouter()).toBe(older.router);
    expect(where(m)).toBe("/workspaces {} /workspaces");
    m.stopSurface(older.tag);
    await turn(m);
    expect(m.rootRouter()).toBeUndefined();
    expect(where(m)).toBe("/ {} null");
  });
});

describe("a goto to the screen the user is on, with another search or hash", () => {
  test("changes its url in place: no new screen, no remount, whether or not it replaces; a path that differs is a navigation as before", async () => {
    const log: string[] = [];
    world.__treeLog = log;
    const m = await load();
    const { router, settle } = await mountApp(m, { initial: "/workspaces" });
    const entry = router.entries[0];
    expect(log).toEqual(["init /workspaces", "effect /workspaces", "mount /workspaces"]);
    const go = async (url: string, options?: object) => { await m.navigation.goto(url, options); await settle(); };

    await go("?tab=3", { replaceState: true });
    expect(router.entries).toHaveLength(1);
    expect(router.entries[0]).toBe(entry);
    expect(entry.url.search).toBe("?tab=3");
    expect(m.state.page.url.search).toBe("?tab=3");
    // A hash only keeps the search, as a browser's relative URL does, and goes to the same screen too; so does a push that was not asked to replace.
    await go("#top");
    expect(entry.url.search + entry.url.hash).toBe("?tab=3#top");
    await go("/workspaces?tab=4");
    expect(entry.url.search + entry.url.hash).toBe("?tab=4");
    await go("/workspaces");
    expect(entry.url.search + entry.url.hash).toBe("");
    expect(pathsOf(router)).toEqual(["/workspaces"]);
    expect(log).toEqual(["init /workspaces", "effect /workspaces", "mount /workspaces"]); // the page was not built again, and no cleanup ran

    // The router's own goto does it too, and a screen in a tab's stack is the visible one.
    await go("/acme");
    router.goto("/acme/home?x=1");
    await settle();
    expect(m.state.page.url.pathname + m.state.page.url.search).toBe("/acme/home?x=1");
    expect(pathsOf(router)).toEqual(["/workspaces", "/acme"]);

    // Another path is a navigation, and a reset is a new root: neither is in place.
    await go("/account");
    expect(pathsOf(router)).toEqual(["/workspaces", "/acme", "/account"]);
    router.goto("/account?x=2", { reset: true }); // the router's reset (SvelteKit's `reset` is not it, and goto ignores that)
    await settle();
    expect(pathsOf(router)).toEqual(["/account"]);
    expect(router.entries[0]).not.toBe(entry);
  });
});

describe("page follows the screen the user sees", () => {
  test("an effect reads it, and runs again for each screen: a tab switch, a push, a modal, a back; before the app has a router it is SvelteKit's page of nothing", async () => {
    const m = await load();
    // Before any router: a page with no route, which is what a read before the app has started gets.
    expect(where(m)).toBe("/ {} null");
    expect(m.state.page).toMatchObject({ status: 200, error: null, form: null, shallow: null, data: {}, state: {} });
    const { settle } = await mountApp(m, { initial: "/workspaces" });
    for (const href of ["/acme", "/acme/inbox", "/acme/home/thread/7", "/account"]) { await m.navigation.goto(href); await settle(); }
    expect(world.__kitSeen).toEqual([
      "/workspaces {} /workspaces",
      '/acme/home {"slug":"acme"} /(workspace)/[slug]/(tabs)/home',
      '/acme/inbox {"slug":"acme"} /(workspace)/[slug]/(tabs)/inbox',
      '/acme/home/thread/7 {"slug":"acme","id":"7"} /(workspace)/[slug]/(tabs)/home/thread/[id]',
      "/account {} /(account)/account",
    ]);
  });

  test("a component that was mounted before the router existed follows it from the moment it does, and back to nothing when the app's component is gone", async () => {
    const m = await load();
    startOn(m, m.Reader);
    await turn(m);
    expect(world.__kitReads).toEqual(["page / null", "updated false"]);
    const { tag: appTag, settle } = await mountApp(m, { initial: "/workspaces" });
    await settle();
    expect(world.__kitReads.at(-1)).toBe("page /workspaces /workspaces");
    await m.navigation.goto("/account");
    await settle();
    expect(world.__kitReads.at(-1)).toBe("page /account /(account)/account");
    m.stopSurface(appTag);
    await settle();
    expect(world.__kitReads.at(-1)).toBe("page / null");
  });

  test("page.route is one object for as long as a screen is on top, so a `$derived` of it does not run again; the shapes SvelteKit gives are neutral values", async () => {
    const m = await load();
    await mountApp(m, { initial: "/workspaces" });
    const { page, navigating } = m.state;
    expect(page.route).toBe(page.route);
    expect(page.params).toBe(page.params);
    expect(page.url.origin).toBe("https://native.invalid");
    expect(page.data).toEqual({});
    expect(Object.isFrozen(page.data) && Object.isFrozen(page.state)).toBe(true);
    // The router applies a navigation in one step: there is nothing in flight, so `navigating` is SvelteKit's "no navigation".
    expect(navigating).toEqual({ from: null, to: null, type: null, willUnload: null, delta: null, complete: null });
  });
});

describe("the rest of $app/navigation", () => {
  test("it exports the names SvelteKit declares, and no others", () => {
    const declared = kitExports("$app/navigation");
    expect(declared).toContain("goto");
    expect(declared).toContain("beforeNavigate");
    return load().then((m) => expect(Object.keys(m.navigation).toSorted()).toEqual(declared));
  });

  test("what has nothing behind it on the device throws, naming the function and why; disableScrollHandling does nothing", async () => {
    const m = await load();
    const stubs = ["beforeNavigate", "afterNavigate", "onNavigate", "snapshot", "invalidate", "invalidateAll", "refreshAll", "preloadData", "pushState", "replaceState"];
    for (const name of stubs) expect(() => (m.navigation[name] as () => void)(), name).toThrow(new RegExp(`^\`${name}\` is not available on the device yet \\(svelte-native\\): `));
    expect(() => (m.navigation.beforeNavigate as () => void)()).toThrow("the router has no hook to look at a navigation before it happens or to cancel it");
    expect(() => (m.navigation.preloadData as () => void)()).toThrow("`preloadCode(routeId)` loads its code");
    expect((m.navigation.disableScrollHandling as () => unknown)()).toBeUndefined();
  });

  test("preloadCode loads the code of the route with that id, once, and rejects for an id no route has", async () => {
    const m = await load();
    const loads: string[] = [];
    await expect(m.navigation.preloadCode("/workspaces")).rejects.toThrow("preloadCode needs the app's router");
    const { settle } = await mountApp(m, { initial: "/workspaces", logLoads: loads });
    await settle();
    const before = loads.length;
    await m.navigation.preloadCode("/(workspace)/[slug]/(tabs)/home/thread/[id]");
    expect(loads.slice(before)).toEqual(["(workspace)/[slug]/(tabs)/home/thread/[id]/+mobile.svelte"]);
    await m.navigation.preloadCode("/(workspace)/[slug]/(tabs)/home/thread/[id]");
    expect(loads.slice(before)).toHaveLength(1); // loaded: not again
    // A navigator's screen has its layout as its code.
    await m.navigation.preloadCode("/(workspace)/[slug]/(tabs)");
    expect(loads.slice(before).at(-1)).toBe("(workspace)/[slug]/(tabs)/+layout.mobile.svelte");
    await expect(m.navigation.preloadCode("/nowhere")).rejects.toThrow("No route of the app has the id /nowhere");
    // The navigation that follows has nothing left to load for the page.
    const afterPreload = loads.length;
    await m.navigation.goto("/acme/home/thread/7");
    await settle();
    expect(loads.slice(afterPreload)).not.toContain("(workspace)/[slug]/(tabs)/home/thread/[id]/+mobile.svelte");
  });
});
