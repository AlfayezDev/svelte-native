import { expect, jest, test } from "bun:test";
import { EXIT_TIMEOUT_MS, parseNativeID } from "../../src/fabric/navigation.ts";
import { type TreeRouter, type TreeApp, ofKind, ofTestID, turns, withInsets, handlersOf, treeGlobals, pathsOf, paneRouter, tabScreens, activityOf, navigationWorld } from "./support/world.ts";

/** The route tree through the router: navigators as routes, tabs with a stack per pane (SPEC.md "Route tree: layouts as navigators"), on `fixtures/tree-fixture.svelte`. */
const { host, load, texts, selectedIndex, mountTree } = navigationWorld();

test("a deep link into the tabs puts the tabs screen on the root stack, selects the pane and stacks its route there; only the selected pane mounts", async () => {
  withInsets(24);
  const { router, texts: shown, tree } = await mountTree(81, { initial: "/acme/inbox/compose" });
  expect(router.scope).toBe("root");
  expect(pathsOf(router)).toEqual(["/acme"]);
  expect(router.entries[0].params).toEqual({ slug: "acme" });
  expect(router.selected).toBeUndefined(); // the root is a stack; the tabs router is the layout's
  expect(treeGlobals.__treeRoots?.["/acme/inbox/compose"]).toBe(router); // useRouter("root") from inside a pane
  expect(selectedIndex(81)).toBe("1");
  expect(paneRouter("/acme/inbox/compose").scope).toBe("inbox");
  expect(paneRouter("/acme/inbox").scope).toBe("inbox");
  expect(router.current.url.pathname).toBe("/acme/inbox/compose"); // the deepest shown entry
  expect(shown()).toEqual(["page /acme/inbox", "page /acme/inbox/compose"]); // the home pane has not mounted
  expect(ofKind(tree(), "tab").map((pane) => String(pane.props.nativeID).split(";").slice(1, 3).join(";"))).toEqual(["k=home;t=Home", "k=inbox;t=Inbox"]);
  const [home, inbox] = tabScreens(tree());
  expect(home).toHaveLength(0);
  expect(inbox.map((screen) => String(screen.props.nativeID).split(";").slice(0, 3).join(";"))).toEqual(["svelte:screen;a=2;p=push", "svelte:screen;a=2;p=sheet"]);
  expect(treeGlobals.__treePanes).toEqual([{ key: "home" }, { key: "inbox" }]);
});

test("a push within the shown pane touches only that pane's stack; a route of another pane selects the tab and stacks there", async () => {
  withInsets(24);
  const { router, settled, texts: shown } = await mountTree(82, { initial: "/acme/home" });
  expect(selectedIndex(82)).toBe("0");
  router.goto("/acme/home/thread/42");
  await settled();
  expect(pathsOf(router)).toEqual(["/acme"]);
  expect(pathsOf(paneRouter("/acme/home"))).toEqual(["/acme/home", "/acme/home/thread/42"]);
  expect(paneRouter("/acme/home/thread/42").entries[1].params).toEqual({ slug: "acme", id: "42" });
  expect(selectedIndex(82)).toBe("0");

  router.goto("/acme/inbox");
  await settled();
  expect(selectedIndex(82)).toBe("1");
  expect(pathsOf(paneRouter("/acme/inbox"))).toEqual(["/acme/inbox"]); // the pane starts on its index page; the route is that page
  expect(pathsOf(paneRouter("/acme/home"))).toEqual(["/acme/home", "/acme/home/thread/42"]); // the other pane keeps its stack
  expect(pathsOf(router)).toEqual(["/acme"]);
  expect(shown()).toEqual(["page /acme/home", "page /acme/home/thread/42", "page /acme/inbox"]);

  router.goto("/acme/inbox/compose", { presentation: "modal" });
  await settled();
  expect(paneRouter("/acme/inbox").entries.map((entry) => entry.presentation)).toEqual(["push", "modal"]);
  // The tabs screen is the root's; `useRouter()` on a page in a pane is the pane's; both reach the same tree.
  paneRouter("/acme/home").goto("/acme/home/thread/43");
  await settled();
  expect(selectedIndex(82)).toBe("0");
  expect(pathsOf(paneRouter("/acme/home"))).toEqual(["/acme/home", "/acme/home/thread/42", "/acme/home/thread/43"]);
});

test("a modal over the tabs is popped by a navigation to a tab route; the route that is already shown does nothing", async () => {
  withInsets(24);
  const { router, settled, tree } = await mountTree(83, { initial: "/acme/home" });
  router.goto("/account");
  await settled();
  expect(pathsOf(router)).toEqual(["/acme", "/account"]);
  expect(router.entries[1].presentation).toBe("modal");
  expect(router.current.url.pathname).toBe("/account");
  expect(paneRouter("/acme/home").active()).toBe(false); // covered
  expect(router.active()).toBe(true);

  router.goto("/acme/home"); // shown below the modal: the modal goes, nothing is pushed
  await settled();
  expect(pathsOf(router)).toEqual(["/acme"]);
  expect(pathsOf(paneRouter("/acme/home"))).toEqual(["/acme/home"]);
  const rootScreens = () => ofKind(tree(), "stack")[0].children;
  expect(rootScreens().map(activityOf)).toEqual(["2", "0"]); // the modal stays mounted, leaving, until the native stack reports its exit
  host.emit(rootScreens()[1].target, "topExited", {});
  await settled();
  expect(rootScreens()).toHaveLength(1);

  router.goto("/account");
  router.goto("/acme/inbox");
  await settled();
  expect(pathsOf(router)).toEqual(["/acme"]);
  expect(selectedIndex(83)).toBe("1");
  expect(paneRouter("/acme/home").active()).toBe(false); // its tab is not selected
  expect(paneRouter("/acme/inbox").active()).toBe(true);
});

test("back at a pane's base neither pops the pane nor switches tabs: the stack above it pops, and the root at one entry leaves the app", async () => {
  withInsets(24);
  const { router, settled, hardwareBack } = await mountTree(84, { initial: "/acme/inbox/compose" });
  router.goto("/acme/home/thread/1"); // also visits the home pane
  await settled();
  router.goto("/acme/inbox?again"); // another href of the pane's base page, so it stacks
  await settled();
  const inbox = paneRouter("/acme/inbox/compose");
  expect(pathsOf(inbox)).toEqual(["/acme/inbox", "/acme/inbox/compose", "/acme/inbox?again"]);

  expect(inbox.back()).toBe(true);
  expect(pathsOf(inbox)).toEqual(["/acme/inbox", "/acme/inbox/compose"]);
  expect(hardwareBack()).toBe(true);
  expect(pathsOf(inbox)).toEqual(["/acme/inbox"]);
  expect(hardwareBack()).toBe(false); // at the base, one screen on the root: the key falls through to the app
  expect(inbox.back()).toBe(false);
  expect(selectedIndex(84)).toBe("1");
  expect(pathsOf(paneRouter("/acme/home"))).toEqual(["/acme/home", "/acme/home/thread/1"]); // not asked: its tab is not selected

  // A screen on the root stack above the tabs: its pop is the pane's base pop.
  router.goto("/workspaces");
  await settled();
  expect(inbox.active()).toBe(false);
  expect(hardwareBack()).toBe(true);
  expect(pathsOf(router)).toEqual(["/acme"]);
  expect(inbox.back()).toBe(false);
  // Programmatically, a pane at its base hands the pop to the stack above it.
  router.goto("/account");
  await settled();
  expect(inbox.back()).toBe(true);
  expect(pathsOf(router)).toEqual(["/acme"]);
  expect(selectedIndex(84)).toBe("1");
});

test("the root router alone owns the back key and the launch link, so a reset of the root <Router> still gives the key to the pane first", async () => {
  withInsets(24);
  const { app, router, settled, hardwareBack } = await mountTree(97, { initial: "/workspaces" });
  router.goto("/acme/home/thread/1");
  await settled();
  expect(handlersOf("__backHandlers")).toHaveLength(1); // the root's: the pane's and the tabs' routers register nothing
  expect(handlersOf("__linkHandlers")).toHaveLength(1);
  expect((globalThis as { __initialURLReads?: number }).__initialURLReads).toBe(1);

  // The session resets: the root <Router> unmounts and mounts again with every module warm, so the panes mount before the root's own effects run.
  app.show(false);
  await settled();
  expect(handlersOf("__backHandlers")).toHaveLength(0);
  app.show(true);
  await settled();
  expect(handlersOf("__backHandlers")).toHaveLength(1);
  expect(handlersOf("__linkHandlers")).toHaveLength(1);
  expect((globalThis as { __initialURLReads?: number }).__initialURLReads).toBe(1); // the launch link is not opened again by a remount
  expect(pathsOf(paneRouter("/acme/home"))).toEqual(["/acme/home", "/acme/home/thread/1"]);

  expect(hardwareBack()).toBe(true); // the pane has depth: it pops, the root is untouched
  expect(pathsOf(paneRouter("/acme/home"))).toEqual(["/acme/home"]);
  expect(pathsOf(router)).toEqual(["/workspaces", "/acme"]);
  expect(hardwareBack()).toBe(true); // at its base the pane keeps its page and the root pops the tabs screen
  expect(pathsOf(paneRouter("/acme/home"))).toEqual(["/acme/home"]);
  expect(pathsOf(router)).toEqual(["/workspaces"]);
  expect(hardwareBack()).toBe(false); // the root at one entry: the app may leave
});

test("back() on a tabs router pops the selected pane first, then the stack above, and a pane that is not selected never pops its sibling", async () => {
  withInsets(24);
  const { router, settled } = await mountTree(98, { initial: "/workspaces" });
  router.goto("/acme/inbox"); // visits the inbox pane, which stays at its base
  await settled();
  router.goto("/acme/home/thread/1");
  await settled();
  const tabs = treeGlobals.__treeTabsRouter;
  const inbox = paneRouter("/acme/inbox");
  const home = paneRouter("/acme/home");
  if (!tabs) throw new Error("the tabs layout did not render");
  expect(tabs.selected).toBe("home");
  expect(pathsOf(tabs)).toEqual(["/acme/home", "/acme/home/thread/1"]); // entries are the selected pane's
  expect(tabs.current.url.pathname).toBe("/acme/home/thread/1");

  expect(tabs.back()).toBe(true); // the pane has depth: it pops, the root screen below the tabs stays
  expect(pathsOf(home)).toEqual(["/acme/home"]);
  expect(pathsOf(router)).toEqual(["/workspaces", "/acme"]);
  home.goto("/acme/home/thread/2");
  await settled();
  expect(inbox.back()).toBe(true); // at its base the unselected pane hands the pop to the root, not to the selected pane
  expect(pathsOf(home)).toEqual(["/acme/home", "/acme/home/thread/2"]);
  expect(pathsOf(router)).toEqual(["/workspaces"]);
});

test("a modal over the tabs takes the back key before the pane below it, whatever the pane's depth", async () => {
  withInsets(24);
  const { router, settled, hardwareBack } = await mountTree(85, { initial: "/acme/home" });
  router.goto("/acme/home/thread/9");
  router.goto("/account");
  await settled();
  expect(hardwareBack()).toBe(true);
  expect(pathsOf(router)).toEqual(["/acme"]);
  expect(pathsOf(paneRouter("/acme/home"))).toEqual(["/acme/home", "/acme/home/thread/9"]);
  expect(hardwareBack()).toBe(true);
  expect(pathsOf(paneRouter("/acme/home"))).toEqual(["/acme/home"]);
});

test("two screens of one tabs navigator keep a state each: another workspace's tabs start on their first pane with their own stacks", async () => {
  withInsets(24);
  const { router, settled } = await mountTree(86, { initial: "/acme/inbox" });
  router.goto("/acme/inbox/compose");
  router.goto("/other/home");
  await settled();
  expect(pathsOf(router)).toEqual(["/acme", "/other"]);
  expect(router.entries.map((entry) => entry.params.slug)).toEqual(["acme", "other"]);
  expect(router.current.url.pathname).toBe("/other/home");
  expect(pathsOf(paneRouter("/other/home"))).toEqual(["/other/home"]);
  expect(pathsOf(paneRouter("/acme/inbox/compose"))).toEqual(["/acme/inbox", "/acme/inbox/compose"]);
  expect(router.back()).toBe(true);
  expect(router.current.url.pathname).toBe("/acme/inbox/compose");
});

test("links open through the root and select the pane; a link no route matches is ignored; replaceBase swaps the root's first screen", async () => {
  withInsets(24);
  const { router, settled } = await mountTree(87, { initial: "/workspaces" });
  expect(router.openURL("example://acme/inbox/compose")).toBe(true);
  expect(router.openURL("https://example.com/acme/home")).toBe(true);
  expect(router.openURL("example://acme/nowhere/at/all")).toBe(false);
  await settled();
  expect(pathsOf(router)).toEqual(["/workspaces", "/acme"]);
  expect(pathsOf(paneRouter("/acme/home"))).toEqual(["/acme/home"]);
  expect(selectedIndex(87)).toBe("0");
  const [base, above] = router.entries;
  router.replaceBase("/account");
  await settled();
  expect(pathsOf(router)).toEqual(["/account", "/acme"]);
  expect(router.entries[0]).not.toBe(base);
  expect(router.entries[1]).toBe(above); // what was above the base is the same screen, not rebuilt
  expect(router.screens.filter((screen) => !screen.leaving).map((screen) => screen.canGoBack)).toEqual([false, true]);
  expect(() => router.replaceBase("/acme/home")).toThrow("not a page of this navigator");
  expect(() => router.goto("/nowhere/at/all")).toThrow("No native screen for /nowhere/at/all");
});

test("a navigator layout's <Stack> lays its defaults under each screen's own options: the page wins, objects merge key by key", async () => {
  withInsets(24);
  treeGlobals.__treeOptions = { "/acme/inbox": { header: { tint: "#abcdef" }, animation: "fade" } };
  const m = await load("tree-fixture.svelte");
  treeGlobals.__treeRouters = {};
  treeGlobals.__treeOptions = { "/acme/inbox": { header: { tint: "#abcdef" }, animation: "fade" } };
  const app = m.startSurface(88, m.Fixture, { initial: "/acme/inbox/compose" }) as TreeApp;
  await turns(m);
  const [, inbox] = tabScreens(host.roots[88]);
  const [base, compose] = inbox.map((screen) => parseNativeID(String(screen.props.nativeID))?.pairs);
  expect(base.s).toBe("fade"); // the page's own animation
  expect(compose.s).toBe("default"); // a sheet is no push: the layout's animation is for its push screens
  const headers = ofKind(inbox, "header").map((node) => parseNativeID(String(node.props.nativeID))?.pairs);
  expect(headers[0]).toMatchObject({ t: "%2Facme%2Finbox", l: "1", tc: "abcdefff" }); // large from the layout, tint from the page
  expect(headers[1]).toMatchObject({ t: "%2Facme%2Finbox%2Fcompose", l: "1", tc: "123456ff" });
  // The home pane has no <Stack>: its screens take the router's defaults.
  app.root().goto("/acme/home");
  await turns(m);
  const [home] = tabScreens(host.roots[88]);
  expect(parseNativeID(String(home[0].props.nativeID))?.pairs.s).toBe("default");
  expect(ofKind(home, "header").map((node) => parseNativeID(String(node.props.nativeID))?.pairs.l)).toEqual([undefined]);
});

test("a <Stack>'s animation is the default of its push screens only: a modal, a sheet and a form sheet keep the platform's", async () => {
  withInsets(24);
  const { router, settled, tree } = await mountTree(106, { initial: "/acme/flow/start" });
  const flow = paneRouter("/acme/flow/start");
  flow.goto("/acme/flow/done");
  flow.goto("/acme/flow/start?modal", { presentation: "modal" }); // other hrefs than the stack holds: the same href pops to its entry
  flow.goto("/acme/flow/done?form", { presentation: "formSheet" });
  flow.goto("/acme/flow/start?transparent", { presentation: "transparentModal" });
  flow.goto("/acme/flow/done?sheet", { presentation: "sheet" });
  await settled();
  expect(pathsOf(router)).toEqual(["/acme/flow"]);
  const screens = ofKind(tree(), "screen").map((screen) => parseNativeID(String(screen.props.nativeID))?.pairs);
  expect(screens.map((pairs) => `${pairs?.p}:${pairs?.s}`)).toEqual([
    "push:default", // the root's own screen, the flow
    "push:slide_from_right", "push:slide_from_right", "modal:default", "formSheet:default", "transparentModal:default", "sheet:default",
  ]);
});

test("a route's modules load when its navigation or its screen asks first; a pane's layout waits for its pane, and the <Stack>'s loading snippet shows until a page arrives", async () => {
  withInsets(24);
  const logLoads: string[] = [];
  const hold: Record<string, (() => void)[]> = {};
  const release = (path: string) => hold[path]?.shift()?.();
  const tabsLayout = "(workspace)/[slug]/(tabs)/+layout.mobile.svelte";
  const inboxLayout = "(workspace)/[slug]/(tabs)/inbox/+layout.mobile.svelte";
  const inboxPage = "(workspace)/[slug]/(tabs)/inbox/+mobile.svelte";
  const compose = "(workspace)/[slug]/(tabs)/inbox/compose/+mobile.svelte";
  const { router, settled, texts: shown, tree } = await mountTree(89, { initial: "/acme/inbox/compose", logLoads, hold });
  expect(logLoads).toEqual([tabsLayout]); // creating the router loads nothing; the first screen's own modules load as it renders
  expect(ofKind(tree(), "tab")).toHaveLength(0);
  release(tabsLayout);
  await settled();
  expect(ofKind(tree(), "tab")).toHaveLength(2);
  expect(logLoads).toEqual([tabsLayout, inboxLayout]); // the pane's layout loads with the pane
  expect(shown()).toEqual([]);
  release(inboxLayout);
  await settled();
  expect(logLoads).toEqual([tabsLayout, inboxLayout, inboxPage, compose]);
  expect(shown()).toEqual(["loading /acme/inbox", "loading /acme/inbox/compose"]); // the layout's <Stack loading>
  release(compose);
  await settled();
  expect(shown()).toEqual(["loading /acme/inbox", "page /acme/inbox/compose"]);
  release(inboxPage);
  await settled();
  expect(shown()).toEqual(["page /acme/inbox", "page /acme/inbox/compose"]);
  router.goto("/acme/home/thread/5"); // a navigation loads what it pushes at once
  expect(logLoads.at(-1)).toBe("(workspace)/[slug]/(tabs)/home/thread/[id]/+mobile.svelte");
});

test("a pane's stack layout receives the params and url of the tabs screen that hosts it, like every other layout", async () => {
  withInsets(24);
  await mountTree(103, { initial: "/acme/inbox" });
  expect(treeGlobals.__treeLayouts).toEqual([{ path: "/acme", params: { slug: "acme" } }]);
});

test("while a pane's layout loads the pane shows the placeholder of the router around it, and the layout's own loading snippet takes over once it is in", async () => {
  withInsets(24);
  const hold: Record<string, ((error?: Error) => void)[]> = {};
  const release = (path: string) => hold[path]?.shift()?.();
  const { settled, texts: shown } = await mountTree(104, { initial: "/acme/inbox", hold, outerLoading: true });
  expect(shown()).toEqual(["outer loading /acme"]); // the tabs screen's own modules
  release("(workspace)/[slug]/(tabs)/+layout.mobile.svelte");
  await settled();
  expect(shown()).toEqual(["outer loading /acme/inbox"]); // the pane's layout is pending: not a blank pane
  release("(workspace)/[slug]/(tabs)/inbox/+layout.mobile.svelte");
  await settled();
  expect(shown()).toEqual(["loading /acme/inbox"]); // the layout's <Stack loading> while the page loads
  release("(workspace)/[slug]/(tabs)/inbox/+mobile.svelte");
  await settled();
  expect(shown()).toEqual(["page /acme/inbox"]);
});

test("a pane's layout that failed to load throws where the pane renders and loads again on the next navigation into the pane", async () => {
  withInsets(24);
  const logLoads: string[] = [];
  const hold: Record<string, ((error?: Error) => void)[]> = {};
  const release = (path: string, error?: Error) => hold[path]?.shift()?.(error);
  const tabsLayout = "(workspace)/[slug]/(tabs)/+layout.mobile.svelte";
  const inboxLayout = "(workspace)/[slug]/(tabs)/inbox/+layout.mobile.svelte";
  const { router, settled, texts: shown } = await mountTree(105, { initial: "/acme/home", logLoads, hold, boundary: true });
  release(tabsLayout);
  await settled();
  release("(workspace)/[slug]/(tabs)/home/+mobile.svelte");
  await settled();
  const tabs = treeGlobals.__treeTabsRouter;
  const inbox = tabs?.node.panes?.find((pane) => pane.key === "inbox")?.stack;
  if (!tabs || !inbox) throw new Error("the tabs layout did not render");
  expect(shown()).toEqual(["page /acme/home"]);

  router.goto("/acme/inbox"); // a navigation into the pane loads its layout before the pane mounts
  expect(logLoads.filter((path) => path === inboxLayout)).toHaveLength(1);
  release(inboxLayout, new Error("chunk missing"));
  await settled();
  expect(() => tabs.modules(inbox)).toThrow("chunk missing");
  expect(shown()).toEqual(["failed: chunk missing"]); // thrown where the pane renders: the nearest boundary draws it

  router.goto("/acme/inbox/compose");
  expect(logLoads.filter((path) => path === inboxLayout)).toHaveLength(2); // retried by the next navigation into the pane
  expect(tabs.modules(inbox)).toBeUndefined(); // the failure is cleared while the new load runs
  release(inboxLayout);
  await settled();
  expect(tabs.modules(inbox)).toBeDefined();
});

test("tabs in a layout take the order of its items, a layout without <Tabs> gets a bar of the pane keys, and a mismatch between items and panes is said once", async () => {
  withInsets(24);
  const errors: string[] = [];
  const logged = console.error;
  console.error = (...args: unknown[]) => { errors.push(args.map(String).join(" ")); };
  (globalThis as { __DEV__?: boolean }).__DEV__ = true;
  try {
    treeGlobals.__treeTabs = [{ key: "inbox", title: "Inbox" }, { key: "ghost", title: "Ghost" }];
    const m = await load("tree-fixture.svelte");
    treeGlobals.__treeRouters = {};
    treeGlobals.__treeTabs = [{ key: "inbox", title: "Inbox" }, { key: "ghost", title: "Ghost" }];
    const app = m.startSurface(90, m.Fixture, { initial: "/acme/inbox" }) as TreeApp;
    await turns(m);
    expect(ofKind(host.roots[90], "tab").map((pane) => parseNativeID(String(pane.props.nativeID))?.pairs.k)).toEqual(["inbox", "home"]); // the items' order, then the pane without an item
    expect(selectedIndex(90)).toBe("0");
    expect(errors).toHaveLength(2);
    expect(errors[0]).toContain("items without a pane");
    expect(errors[0]).toContain("ghost");
    expect(errors[1]).toContain("panes without an item");
    expect(errors[1]).toContain("home");
    app.root().goto("/acme/home");
    await turns(m);
    expect(selectedIndex(90)).toBe("1");
    expect(errors).toHaveLength(2); // not again

    errors.length = 0;
    delete treeGlobals.__treeTabs;
    const bare = await load("tree-fixture.svelte");
    host.reset();
    bare.startSurface(91, bare.Fixture, { initial: "/acme/home", bareTabs: true });
    await turns(bare);
    expect(ofKind(host.roots[91], "tab").map((pane) => parseNativeID(String(pane.props.nativeID))?.pairs.t)).toEqual(["home", "inbox"]);
    expect(errors).toEqual([]);
  } finally { console.error = logged; }
});

test("a press on the tab bar selects the pane at once through the router's tabs node, and the layout's onSelect still reports", async () => {
  withInsets(24);
  const { router, settled, tree } = await mountTree(92, { initial: "/acme/home" });
  const tabs = () => ofKind(tree(), "tabs")[0];
  host.emit(tabs().target, "topSelect", { key: "inbox", index: 1 });
  await settled();
  expect(selectedIndex(92)).toBe("1");
  expect(treeGlobals.__treeSelections).toEqual(["inbox"]);
  expect(pathsOf(paneRouter("/acme/inbox"))).toEqual(["/acme/inbox"]); // the pane mounted lazily on selection
  // The owner can override it by navigating.
  router.goto("/acme/home");
  await settled();
  expect(selectedIndex(92)).toBe("0");
  expect(paneRouter("/acme/home").active()).toBe(true);
  expect(paneRouter("/acme/inbox").active()).toBe(false);
});

test("the back key reaches the pane before the root: screens below the tabs on the root stack stay while the pane has screens to pop", async () => {
  withInsets(24);
  const { router, settled, hardwareBack } = await mountTree(93, { initial: "/workspaces" });
  router.goto("/acme/home/thread/1");
  await settled();
  expect(pathsOf(router)).toEqual(["/workspaces", "/acme"]);
  expect(hardwareBack()).toBe(true);
  expect(pathsOf(paneRouter("/acme/home"))).toEqual(["/acme/home"]);
  expect(pathsOf(router)).toEqual(["/workspaces", "/acme"]);
  expect(hardwareBack()).toBe(true);
  expect(pathsOf(router)).toEqual(["/workspaces"]);
});

test("a nested stack navigator is a screen of its parent: the stack inside it starts with the route, its first back pops the screen, and a new visit starts a new stack", async () => {
  withInsets(24);
  const { router, settled, hardwareBack, tree } = await mountTree(94, { initial: "/acme/home" });
  router.goto("/acme/flow/start");
  await settled();
  expect(pathsOf(router)).toEqual(["/acme", "/acme/flow"]);
  const flow = paneRouter("/acme/flow/start");
  expect(flow.scope).toBe("(workspace)/[slug]/flow");
  expect(pathsOf(flow)).toEqual(["/acme/flow/start"]); // no base page: the stack starts with the route that opened it
  expect(router.current.url.pathname).toBe("/acme/flow/start");
  expect(ofTestID(tree(), "content-layout")).toHaveLength(4); // around the tabs screen, its home page, the flow screen and its page: a content layout wraps every screen below it

  flow.goto("/acme/flow/done");
  await settled();
  expect(pathsOf(flow)).toEqual(["/acme/flow/start", "/acme/flow/done"]);
  expect(pathsOf(router)).toEqual(["/acme", "/acme/flow"]);
  expect(hardwareBack()).toBe(true);
  expect(pathsOf(flow)).toEqual(["/acme/flow/start"]);
  expect(hardwareBack()).toBe(true); // one screen in the stack: the screen of the flow pops
  expect(pathsOf(router)).toEqual(["/acme"]);

  router.goto("/acme/flow/done");
  await settled();
  expect(pathsOf(paneRouter("/acme/flow/done"))).toEqual(["/acme/flow/done"]); // a new visit, a new stack
  expect(pathsOf(flow)).toEqual(["/acme/flow/start"]); // the old one went with its screen
});

test("the first screen of a nested stack navigator can go back when its own screen has one below it; a pane's base and the root's first screen cannot", async () => {
  withInsets(24);
  const arrows = (router: TreeRouter) => router.screens.filter((screen) => !screen.leaving).map((screen) => screen.canGoBack);
  const { router, settled } = await mountTree(101, { initial: "/acme/home" });
  expect(arrows(paneRouter("/acme/home"))).toEqual([false]); // a pane's base: its first back does not pop the pane
  router.goto("/acme/flow/start");
  await settled();
  const flow = paneRouter("/acme/flow/start");
  expect(arrows(router)).toEqual([false, true]);
  expect(arrows(flow)).toEqual([true]); // its first back pops the flow's screen from the root, where the tabs are below it
  flow.goto("/acme/flow/done");
  await settled();
  expect(arrows(flow)).toEqual([true, true]);
  flow.back();
  flow.back();
  await settled();
  expect(arrows(router)).toEqual([false]);
  router.goto("/acme/flow/inner/step");
  await settled();
  expect(pathsOf(router)).toEqual(["/acme", "/acme/flow"]);
  expect(arrows(paneRouter("/acme/flow/inner/step"))).toEqual([true]); // the inner flow is the flow's first screen, and the flow can go back: so can the inner one, by popping the whole flow

  const first = await mountTree(102, { initial: "/acme/flow/start" }); // the flow is the root's first screen: nothing to go back to
  expect(pathsOf(first.router)).toEqual(["/acme/flow"]);
  expect(arrows(first.router)).toEqual([false]);
  expect(arrows(paneRouter("/acme/flow/start"))).toEqual([false]);
  paneRouter("/acme/flow/start").goto("/acme/flow/done");
  await first.settled();
  expect(arrows(paneRouter("/acme/flow/done"))).toEqual([false, true]);
});

test("a pane's stack keeps the exit contract of its own: a popped screen stays until the stack reports its exit, or until the timeout, with the same warning", async () => {
  withInsets(24);
  const warnings: unknown[][] = [];
  const warn = console.warn;
  console.warn = (...args: unknown[]) => { warnings.push(args); };
  jest.useFakeTimers();
  try {
    const { router, settled, tree } = await mountTree(95, { initial: "/acme/home" });
    router.goto("/acme/home/thread/1");
    await settled();
    const home = paneRouter("/acme/home");
    expect(home.back()).toBe(true);
    await settled();
    const screens = () => tabScreens(tree())[0];
    expect(home.screens.map((screen) => screen.leaving)).toEqual([false, true]);
    expect(screens().map(activityOf)).toEqual(["2", "0"]);
    expect(ofKind(tree(), "stack")[0].children.map(activityOf)).toEqual(["2"]); // the root stack is not involved
    host.emit(screens()[1].target, "topExited", {});
    await settled();
    expect(home.screens).toHaveLength(1);
    expect(screens()).toHaveLength(1);

    home.goto("/acme/home/thread/2");
    await settled();
    home.back();
    await settled();
    expect(home.screens).toHaveLength(2);
    jest.advanceTimersByTime(EXIT_TIMEOUT_MS + 1);
    await settled();
    expect(home.screens).toHaveLength(1);
    expect(screens()).toHaveLength(1);
    expect(warnings).toHaveLength(1);
  } finally { console.warn = warn; }
});

test("the tabs screen resolves to its first pane; replaceState replaces the pane's top, reset keeps the pane's index page and the tabs screen", async () => {
  withInsets(24);
  const { router, settled } = await mountTree(96, { initial: "/acme" });
  expect(pathsOf(router)).toEqual(["/acme"]);
  expect(selectedIndex(96)).toBe("0");
  expect(pathsOf(paneRouter("/acme/home"))).toEqual(["/acme/home"]);

  router.goto("/acme/home/thread/1");
  router.goto("/acme/home/thread/2", { replaceState: true });
  await settled();
  const home = paneRouter("/acme/home");
  expect(pathsOf(home)).toEqual(["/acme/home", "/acme/home/thread/2"]);
  router.goto("/acme/home/thread/3");
  router.goto("/acme/home/thread/4", { reset: true });
  await settled();
  expect(pathsOf(home)).toEqual(["/acme/home", "/acme/home/thread/4"]);
  expect(home.entries[0].key).toBeLessThan(home.entries[1].key);
  router.goto("/acme/home", { reset: true });
  await settled();
  expect(pathsOf(home)).toEqual(["/acme/home"]);
  expect(pathsOf(router)).toEqual(["/acme"]);
  router.goto("/workspaces", { reset: true }); // a root page: the root stack is the owner and keeps nothing else
  await settled();
  expect(pathsOf(router)).toEqual(["/workspaces"]);
});

test("a goto to an href the owner stack already holds pops to that entry, from the same pane or another; replaceState and reset do not", async () => {
  withInsets(24);
  const { router, settled } = await mountTree(133, { initial: "/acme/home" });
  const home = paneRouter("/acme/home");
  router.goto("/acme/home/thread/1");
  router.goto("/acme/home/thread/2");
  router.goto("/acme/home/thread/3");
  await settled();
  expect(pathsOf(home)).toEqual(["/acme/home", "/acme/home/thread/1", "/acme/home/thread/2", "/acme/home/thread/3"]);
  const second = home.entries[2];
  router.goto("/acme/home/thread/2");
  await settled();
  expect(pathsOf(home)).toEqual(["/acme/home", "/acme/home/thread/1", "/acme/home/thread/2"]);
  expect(home.entries[2]).toBe(second); // the entry itself stays: nothing remounts
  router.goto("/acme/home/thread/2");
  expect(pathsOf(home)).toHaveLength(3); // the top: nothing

  router.goto("/acme/inbox"); // another pane: the tab is selected, then the stack there has its base
  router.goto("/acme/inbox/compose");
  await settled();
  expect(selectedIndex(133)).toBe("1");
  expect(pathsOf(paneRouter("/acme/inbox"))).toEqual(["/acme/inbox", "/acme/inbox/compose"]);
  router.goto("/acme/home/thread/1"); // from the inbox pane back to a screen deep in the home stack
  await settled();
  expect(selectedIndex(133)).toBe("0");
  expect(pathsOf(home)).toEqual(["/acme/home", "/acme/home/thread/1"]);
  router.goto("/acme/inbox"); // the inbox base: selected, and its sheet popped
  await settled();
  expect(selectedIndex(133)).toBe("1");
  expect(pathsOf(paneRouter("/acme/inbox"))).toEqual(["/acme/inbox"]);

  router.goto("/acme/home/thread/1", { replaceState: true });
  await settled();
  expect(pathsOf(home)).toEqual(["/acme/home", "/acme/home/thread/1"]); // the top: the replacement of an entry by its own href is nothing, as before
  router.goto("/acme/home", { replaceState: true });
  await settled();
  expect(pathsOf(home)).toEqual(["/acme/home", "/acme/home"]); // replaceState keeps its meaning: the top is replaced
  router.goto("/acme/home", { reset: true });
  await settled();
  expect(pathsOf(home)).toEqual(["/acme/home"]);
});


test("a root <Router> that unmounts takes the screens still leaving with it, and a navigation while it is away drops what it replaces at once", async () => {
  withInsets(24);
  const { app, router, settled } = await mountTree(193, { initial: "/workspaces" });
  router.goto("/acme/home");
  await settled();
  router.goto("/workspaces", { reset: true });
  await settled();
  expect(router.screens.filter((screen) => screen.leaving).length).toBeGreaterThan(0); // the native stack has not reported their exit
  app.show(false);
  await settled();
  expect(router.screens.filter((screen) => screen.leaving)).toHaveLength(0);
  router.goto("/acme/home", { reset: true }); // nothing is on screen to take /workspaces away
  expect(router.screens.map((screen) => screen.leaving)).toEqual([false]);
  app.show(true);
  await settled();
  expect(pathsOf(router)).toEqual(["/acme"]);
});

test("a Screen in a router entry does not get a stack of its own: one stack per router, the pages' screens are its screens", async () => {
  withInsets(24);
  const { router, settled, tree } = await mountTree(132, { initial: "/acme/home" });
  router.goto("/acme/home/thread/1");
  router.goto("/acme/inbox");
  await settled();
  const stacks = ofKind(tree(), "stack");
  expect(stacks).toHaveLength(3); // the root's, the home pane's and the inbox pane's
  for (const stack of stacks) expect(stack.children.every((child) => parseNativeID(String(child.props.nativeID))?.kind === "screen")).toBe(true);
  expect(ofKind(tree(), "screen")).toHaveLength(ofKind(tree(), "header").length + 1); // a header per page, and the root's screen for the tabs
});

test("reset is a new root for the whole chain: the root keeps only the tabs screen, the instance it had, with its panes mounted; nothing below or above survives and no arrow shows at the base", async () => {
  withInsets(24);
  const arrows = (router: TreeRouter) => router.screens.filter((screen) => !screen.leaving).map((screen) => screen.canGoBack);
  const { router, settled, hardwareBack } = await mountTree(130, { initial: "/workspaces" });
  router.goto("/acme"); // the workspace over the list, as a link or a plain push leaves it
  await settled();
  expect(pathsOf(router)).toEqual(["/workspaces", "/acme"]);
  const tabs = router.entries[1];
  const home = paneRouter("/acme/home");
  const base = home.entries[0];

  host.calls.length = 0;
  router.goto("/acme", { reset: true }); // what the workspace list does to open a workspace
  await settled();
  expect(pathsOf(router)).toEqual(["/acme"]); // the list is gone
  expect(router.entries[0]).toBe(tabs); // the same tabs screen: nothing is created, nothing remounts
  expect(home.entries[0]).toBe(base);
  expect(paneRouter("/acme/home")).toBe(home);
  expect(host.calls.filter((call) => call.startsWith("create"))).toEqual([]);
  expect(arrows(router)).toEqual([false]); // the tabs screen is the root's only entry
  expect(arrows(home)).toEqual([false]); // a pane's base has no arrow either
  expect(hardwareBack()).toBe(false); // Android's back key leaves the app from the home pane's base
  expect(selectedIndex(130)).toBe("0");

  // A pane's stack, then a modal over the tabs; a reset from the modal to the other pane drops the modal and the stacks it names.
  router.goto("/acme/home/thread/1");
  router.goto("/account");
  await settled();
  expect(pathsOf(router)).toEqual(["/acme", "/account"]);
  expect(arrows(router)).toEqual([false, true]);
  router.goto("/acme/inbox/compose", { reset: true });
  await settled();
  expect(pathsOf(router)).toEqual(["/acme"]);
  expect(router.entries[0]).toBe(tabs);
  expect(selectedIndex(130)).toBe("1");
  expect(pathsOf(paneRouter("/acme/inbox"))).toEqual(["/acme/inbox", "/acme/inbox/compose"]);
  expect(arrows(paneRouter("/acme/inbox"))).toEqual([false, true]); // the sheet's header can go back, the base cannot
  expect(pathsOf(home)).toEqual(["/acme/home", "/acme/home/thread/1"]); // a pane the chain does not name is left alone
  expect(arrows(router)).toEqual([false]);

  // A root page resets the root to itself: the workspace goes.
  router.goto("/workspaces", { reset: true });
  await settled();
  expect(pathsOf(router)).toEqual(["/workspaces"]);
  expect(hardwareBack()).toBe(false);
});

test("a reset that keeps a nested stack navigator's screen moves it to the root's base: its first screen no longer goes back", async () => {
  withInsets(24);
  const arrows = (router: TreeRouter) => router.screens.filter((screen) => !screen.leaving).map((screen) => screen.canGoBack);
  const { router, settled } = await mountTree(131, { initial: "/workspaces" });
  router.goto("/acme/flow/start");
  await settled();
  expect(pathsOf(router)).toEqual(["/workspaces", "/acme/flow"]);
  const flow = paneRouter("/acme/flow/start");
  const screen = router.entries[1];
  expect(arrows(flow)).toEqual([true]); // its first back pops the flow from the root, where the list is below it
  flow.goto("/acme/flow/done");
  await settled();
  flow.goto("/acme/flow/start", { reset: true });
  await settled();
  expect(pathsOf(router)).toEqual(["/acme/flow"]); // the list below it is gone, the flow is the root's base
  expect(router.entries[0]).toBe(screen);
  expect(pathsOf(flow)).toEqual(["/acme/flow/start"]);
  expect(paneRouter("/acme/flow/start")).toBe(flow);
  expect(arrows(router)).toEqual([false]);
  expect(arrows(flow)).toEqual([false]); // nothing below the flow to go back to
  flow.goto("/acme/flow/done");
  await settled();
  expect(arrows(flow)).toEqual([false, true]);
});
