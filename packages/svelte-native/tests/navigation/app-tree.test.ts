import { expect, test } from "bun:test";
import { routeFiles } from "../../src/build.ts";
import { parseNativeID } from "../../src/fabric/navigation.ts";
import { type PageRoute, type RouteNode, buildTree, resolve as resolveHref } from "../../src/route-tree.ts";
import { type Visitor, enforceGate } from "../support/fixtures/stand-in-app/src/lib/gate.ts";
import { type FakeNode, type TreeRouter, handlersOf, ofKind, pathsOf, paneRouter, treeGlobals, withInsets, navigationWorld } from "./support/world.ts";
import { appRoutes, neverAnswers, sendLink, trouble, standInWorld } from "./support/stand-in.ts";

/**
 * The route tree of the stand-in app (`tests/support/fixtures/stand-in-app`, an app of this package's own): the files under its `src/routes`, built by
 * the generator's reader, linked to the test components of the fixtures (a tabs bar, a stack, a page that registers its router). The app has
 * the shape the router was built for: a root stack with pages, a modal and a tabs navigator (a project, with a home pane and a settings pane),
 * behind a gate that keeps the root navigator on a screen the visitor may see, and a development lab under `/__dev`. The tests pin that shape,
 * drive the navigation an app does through it, and mount the app's own root layout and session for the launch links of the lab (the first start of
 * the lab, a restart on it, a link while it runs). That a store build's Metro stub fails a lab call that is not behind the flag is `compiler/lab-stub.test.ts`.
 */
const world = navigationWorld();
const { host, selectedIndex, mountTree } = world;
const { labStart } = standInWorld(world);

const appFiles = () => routeFiles(appRoutes, { lab: true });
/** The production variant's route files (`APP_VARIANT=production`): discovery leaves the lab out. */
const productionFiles = () => routeFiles(appRoutes, { lab: false });
const outline = (route: PageRoute | RouteNode, depth = 0): string[] => {
  const pad = "  ".repeat(depth);
  if (route.kind === "page") return [`${pad}page ${route.path}${route.presentation === "push" ? "" : ` (${route.presentation})`}`];
  if (route.kind === "stack") return [`${pad}stack ${route.path}`, ...route.routes.flatMap((child) => outline(child, depth + 1))];
  return [`${pad}tabs ${route.path} [${route.panes.map((pane) => pane.key).join(", ")}]`, ...route.panes.flatMap((pane) => [`${pad}  pane ${pane.key}`, ...outline(pane.stack, depth + 2)])];
};

test("the stand-in app's tree: the root stack's pages and presentations, a project as a tabs node with a home pane and a settings pane, the preferences modal at the root", async () => {
  const tree = buildTree(await appFiles());
  expect(tree.shellFile).toBe("+layout.mobile.svelte"); // the app shell wraps the root navigator
  // The lab (/__dev) is a development surface of its own; the app is the rest.
  const app = tree.routes.filter((route) => !route.path.startsWith("/__dev"));
  expect(app.flatMap((route) => outline(route))).toEqual([
    "page /projects/new",
    "page /preferences (modal)",
    "page /sign-in",
    "page /projects",
    "page /setup",
    "tabs /[slug] [home, settings]",
    "  pane home",
    "    stack /[slug]/home",
    "      page /[slug]/home",
    "  pane settings",
    "    stack /[slug]/settings",
    "      page /[slug]/settings/[section]",
    "      page /[slug]/settings",
  ]);
  const project = tree.routes.find((route) => route.kind === "tabs" && route.path === "/[slug]");
  expect(project?.kind === "tabs" && project.layoutFile).toBe("(project)/[slug]/+layout.mobile.svelte");
  expect(outline(tree).filter((line) => line.trim().startsWith("tabs")).map((line) => line.trim())).toEqual(["tabs /__dev/tree [home, inbox]", "tabs /[slug] [home, settings]"]);
  // Only the preferences are a modal, and it is a page of the root stack (one indent): it covers the project's tab bar.
  expect(outline(tree).filter((line) => /\((modal|transparentModal|formSheet)\)/.test(line))).toEqual(["  page /preferences (modal)"]);
  expect(outline(tree).filter((line) => line.includes("(sheet)")).map((line) => line.trim())).toEqual(["page /__dev/tree/inbox/compose (sheet)"]); // the lab's sheet, in the lab's pane
  // A root-level path never lands in the project: /projects and /preferences are pages of the root stack.
  expect(resolveHref(tree, "/projects")?.chain.map((step) => step.node.id)).toEqual([""]);
  expect(resolveHref(tree, "/preferences")?.chain.map((step) => step.node.id)).toEqual([""]);
  expect(resolveHref(tree, "/acme")?.page.path).toBe("/[slug]/home");
  expect(resolveHref(tree, "/acme/settings")?.chain.map((step) => `${step.node.id || "root"}${step.select ? `:${step.select}` : ""}`)).toEqual(["root", "(project)/[slug]:settings", "(project)/[slug]/settings"]);
  expect(resolveHref(tree, "/acme/settings/devices")?.params).toEqual({ slug: "acme", section: "devices" });
});

const projectTabs = [{ key: "home", title: "Home" }, { key: "settings", title: "Settings" }];
const mountApp = async (surface: number, initial: string) => mountTree(surface, { initial, files: await appFiles(), tabs: projectTabs });

// What each shown header says of its back arrow, by title (the stub pages title themselves with their path).
const backFlags = (nodes: FakeNode[]) => Object.fromEntries(ofKind(nodes, "header").map((node) => {
  const pairs = parseNativeID(String(node.props.nativeID))?.pairs ?? {};
  return [decodeURIComponent(String(pairs.t)), pairs.bk === "1"];
}));
const arrows = (router: TreeRouter) => router.screens.filter((screen) => !screen.leaving).map((screen) => screen.canGoBack);

test("sign-in, the projects, a project's home pane, project settings selects the settings tab, the preferences are a modal over the tabs", async () => {
  withInsets(24);
  const { router, settled, hardwareBack, tree } = await mountApp(120, "/sign-in");
  expect(pathsOf(router)).toEqual(["/sign-in"]);
  router.goto("/projects", { reset: true }); // what the gate does for a signed-in visitor
  await settled();
  expect(pathsOf(router)).toEqual(["/projects"]);

  // The list opens a project: reset is a new root, so the tabs screen is the root's only entry (and its base).
  router.goto("/acme", { reset: true });
  await settled();
  expect(pathsOf(router)).toEqual(["/acme"]);
  expect(router.entries[0].params).toEqual({ slug: "acme" });
  expect(router.current.url.pathname).toBe("/acme/home"); // the deepest shown entry: the home pane's base
  expect(selectedIndex(120)).toBe("0");
  expect(paneRouter("/acme/home").scope).toBe("home");
  expect(treeGlobals.__treePanes).toEqual([{ key: "home" }, { key: "settings" }]);
  expect(ofKind(tree(), "tab").map((pane) => String(parseNativeID(String(pane.props.nativeID))?.pairs.k))).toEqual(["home", "settings"]);
  expect(arrows(router)).toEqual([false]); // no back arrow on the tabs screen,
  expect(backFlags(tree())).toMatchObject({ "/acme/home": false }); // nor on the home pane's base
  expect(hardwareBack()).toBe(false); // and the back key leaves the app

  // "Manage project" is goto(`/${slug}/settings`) from the home pane: it selects the settings tab, nothing is pushed on the root.
  paneRouter("/acme/home").goto("/acme/settings");
  await settled();
  expect(selectedIndex(120)).toBe("1");
  expect(treeGlobals.__treeTabsRouter?.selected).toBe("settings");
  expect(pathsOf(router)).toEqual(["/acme"]);
  expect(router.current.url.pathname).toBe("/acme/settings");
  expect(pathsOf(paneRouter("/acme/settings"))).toEqual(["/acme/settings"]);

  // A section is a page pushed within the settings pane; the tab bar stays, and the section has the back arrow.
  paneRouter("/acme/settings").goto("/acme/settings/devices");
  await settled();
  expect(pathsOf(paneRouter("/acme/settings"))).toEqual(["/acme/settings", "/acme/settings/devices"]);
  expect(paneRouter("/acme/settings/devices").entries[1].params).toEqual({ slug: "acme", section: "devices" });
  expect(router.current.url.pathname).toBe("/acme/settings/devices");
  expect(selectedIndex(120)).toBe("1");
  expect(arrows(paneRouter("/acme/settings"))).toEqual([false, true]);
  expect(backFlags(tree())).toMatchObject({ "/acme/settings": false, "/acme/settings/devices": true });

  // The preferences are a root page presented as a modal over the tabs, from either pane.
  paneRouter("/acme/settings").goto("/preferences");
  await settled();
  expect(pathsOf(router)).toEqual(["/acme", "/preferences"]);
  expect(router.entries[1].presentation).toBe("modal");
  expect(router.current.url.pathname).toBe("/preferences");
  expect(ofKind(tree(), "screen").map((screen) => parseNativeID(String(screen.props.nativeID))?.pairs.p).filter((value) => value === "modal")).toHaveLength(1);
  expect(treeGlobals.__treeTabsRouter?.selected).toBe("settings"); // the tabs are still there under the modal
  expect(backFlags(tree())["/preferences"]).toBe(false); // a modal gets no arrow: its page's Close button is the way out

  // Back closes the modal first, then pops the section; the selected tab never changes.
  expect(hardwareBack()).toBe(true);
  await settled();
  expect(pathsOf(router)).toEqual(["/acme"]);
  expect(router.current.url.pathname).toBe("/acme/settings/devices");
  expect(hardwareBack()).toBe(true);
  await settled();
  expect(pathsOf(paneRouter("/acme/settings"))).toEqual(["/acme/settings"]);
  expect(selectedIndex(120)).toBe("1");
  expect(router.current.url.pathname).toBe("/acme/settings");
  expect(hardwareBack()).toBe(false); // the settings pane's base: back does not switch to the home tab, and nothing is below the tabs
  await settled();
  expect(selectedIndex(120)).toBe("1");
});

test("project settings from Home, twice, and with a section open, leaves the settings pane at its base", async () => {
  withInsets(24);
  const { router, settled } = await mountApp(127, "/acme/home");
  paneRouter("/acme/home").goto("/acme/settings"); // the Manage project button
  await settled();
  expect(selectedIndex(127)).toBe("1");
  paneRouter("/acme/settings").goto("/acme/settings/profile");
  await settled();
  expect(pathsOf(paneRouter("/acme/settings"))).toEqual(["/acme/settings", "/acme/settings/profile"]);
  paneRouter("/acme/settings").goto("/acme/settings/profile"); // the section's own row again: nothing
  paneRouter("/acme/home").goto("/acme/settings"); // back on Home, the button again: the tab is selected and the open section is popped
  await settled();
  expect(selectedIndex(127)).toBe("1");
  expect(pathsOf(paneRouter("/acme/settings"))).toEqual(["/acme/settings"]);
  paneRouter("/acme/home").goto("/acme/settings");
  await settled();
  expect(pathsOf(paneRouter("/acme/settings"))).toEqual(["/acme/settings"]);
  expect(pathsOf(router)).toEqual(["/acme"]);
});

test("back at the base of the settings pane does not switch to the home tab, whether the tabs were opened by a link, by the list's reset, or over the list", async () => {
  withInsets(24);
  const alone = await mountApp(121, "/acme/settings");
  expect(pathsOf(alone.router)).toEqual(["/acme"]);
  expect(alone.router.entries[0].params).toEqual({ slug: "acme" }); // opened by a link: the tabs screen is the base of the root stack
  expect(selectedIndex(121)).toBe("1");
  expect(alone.hardwareBack()).toBe(false);
  await alone.settled();
  expect(selectedIndex(121)).toBe("1");
  expect(paneRouter("/acme/settings").back()).toBe(false);
  expect(alone.router.back()).toBe(false);
  expect(selectedIndex(121)).toBe("1");
  expect(alone.router.current.url.pathname).toBe("/acme/settings");

  // Opened from the list with a reset (what the list and the creation of a project do): nothing is left below the project.
  const opened = await mountApp(122, "/projects");
  opened.router.goto("/acme/settings", { reset: true });
  await opened.settled();
  expect(pathsOf(opened.router)).toEqual(["/acme"]);
  expect(selectedIndex(122)).toBe("1");
  expect(opened.hardwareBack()).toBe(false);
  expect(selectedIndex(122)).toBe("1");

  // Pushed over the list (a link while the list is shown): the key pops the project, still without switching tabs on the way.
  const below = await mountApp(123, "/projects");
  below.router.goto("/acme/settings");
  await below.settled();
  expect(pathsOf(below.router)).toEqual(["/projects", "/acme"]);
  expect(selectedIndex(123)).toBe("1");
  below.router.goto("/acme/home");
  await below.settled();
  expect(selectedIndex(123)).toBe("0"); // navigating selects; only that does
  below.router.goto("/acme/settings");
  await below.settled();
  expect(below.hardwareBack()).toBe(true);
  await below.settled();
  expect(pathsOf(below.router)).toEqual(["/projects"]);
});

const entered = (patch: Partial<Visitor> = {}): Visitor => ({ user: { id: "u1" }, needsSetup: false, projects: [{ slug: "acme" }], ...patch });
const gate = (router: TreeRouter, visitor: Visitor, lab = false) => enforceGate(visitor, router as unknown as Parameters<typeof enforceGate>[1], lab);

test("the gate on the app's tree: sign-in, setup and projects by the shown path, the lab only in lab builds", async () => {
  withInsets(24);
  // Signed out: everything but the sign-in goes to it, from a project and from a modal over one.
  const out = await mountApp(124, "/acme/home");
  expect(out.router.current.url.pathname).toBe("/acme/home");
  gate(out.router, entered({ user: null }));
  await out.settled();
  expect(pathsOf(out.router)).toEqual(["/sign-in"]);
  gate(out.router, entered({ user: null })); // nothing to do on the sign-in
  expect(pathsOf(out.router)).toEqual(["/sign-in"]);

  // A visitor who has not finished the setup is held on it, and may open the preferences modal from there.
  gate(out.router, entered({ needsSetup: true }));
  await out.settled();
  expect(pathsOf(out.router)).toEqual(["/setup"]);
  out.router.goto("/preferences");
  await out.settled();
  expect(pathsOf(out.router)).toEqual(["/setup", "/preferences"]);
  gate(out.router, entered({ needsSetup: true }));
  expect(pathsOf(out.router)).toEqual(["/setup", "/preferences"]);

  // A setup that is done leaves the setup and the sign-in for the projects.
  out.router.back();
  await out.settled();
  gate(out.router, entered());
  await out.settled();
  expect(pathsOf(out.router)).toEqual(["/projects"]);
  out.router.goto("/sign-in");
  await out.settled();
  gate(out.router, entered());
  await out.settled();
  expect(pathsOf(out.router)).toEqual(["/projects"]);

  // The lab is a lab build's: elsewhere a signed-in visitor goes to the projects, nobody to the sign-in.
  out.router.goto("/__dev/tree/inbox");
  await out.settled();
  expect(out.router.current.url.pathname).toBe("/__dev/tree/inbox");
  gate(out.router, entered(), true);
  expect(out.router.current.url.pathname).toBe("/__dev/tree/inbox");
  gate(out.router, entered(), false);
  await out.settled();
  expect(pathsOf(out.router)).toEqual(["/projects"]);
  out.router.goto("/__dev");
  await out.settled();
  gate(out.router, entered({ user: null }), false);
  await out.settled();
  expect(pathsOf(out.router)).toEqual(["/sign-in"]);
});

test("the gate sends the visitor to the projects when their project is no longer theirs; the preferences modal above it stays", async () => {
  withInsets(24);
  const { router, settled } = await mountApp(125, "/projects");
  router.goto("/acme", { reset: true });
  await settled();
  expect(pathsOf(router)).toEqual(["/acme"]);
  expect(router.entries[0].params.slug).toBe("acme"); // the project is the root's base
  gate(router, entered());
  expect(pathsOf(router)).toEqual(["/acme"]); // still theirs: nothing happens
  gate(router, entered({ projects: [{ slug: "other" }] }));
  await settled();
  expect(pathsOf(router)).toEqual(["/projects"]);

  // The preferences modal that removed the project stays up: the list replaces the project under it.
  router.goto("/acme", { reset: true });
  router.goto("/preferences");
  await settled();
  expect(pathsOf(router)).toEqual(["/acme", "/preferences"]);
  const modal = router.entries[1];
  gate(router, entered({ projects: [] }));
  await settled();
  expect(pathsOf(router)).toEqual(["/projects", "/preferences"]);
  expect(router.entries[1]).toBe(modal);
  expect(router.current.url.pathname).toBe("/preferences");
  router.back(); // the modal's Close
  await settled();
  expect(pathsOf(router)).toEqual(["/projects"]);

  // A project pushed over the list (a link) is dealt with when it is the shown one.
  router.goto("/acme");
  await settled();
  expect(pathsOf(router)).toEqual(["/projects", "/acme"]);
  gate(router, entered());
  expect(pathsOf(router)).toEqual(["/projects", "/acme"]);
  gate(router, entered({ projects: [] }));
  await settled();
  expect(pathsOf(router)).toEqual(["/projects"]);
});

const labPaths = (route: PageRoute | RouteNode): string[] => [
  route.path, ...(route.kind === "page" ? [] : route.kind === "stack" ? route.routes.flatMap(labPaths) : route.panes.flatMap((pane) => labPaths(pane.stack))),
];

test("the production variant's tree is the app's tree without the lab: no /__dev route, the same screens otherwise", async () => {
  const files = await productionFiles();
  expect(files.filter((file) => file.path.includes("__dev"))).toEqual([]);
  const production = buildTree(files);
  expect(labPaths(production).filter((path) => path.includes("__dev"))).toEqual([]);
  // The lab's tree is the production tree plus the /__dev routes.
  const full = buildTree(await appFiles());
  expect(labPaths(full).filter((path) => path.includes("__dev")).length).toBeGreaterThan(8);
  expect(full.routes.filter((route) => !route.path.startsWith("/__dev")).flatMap((route) => outline(route))).toEqual(production.routes.flatMap((route) => outline(route)));
  expect(production.shellFile).toBe(full.shellFile);
  expect(outline(production).filter((line) => line.trim().startsWith("tabs")).map((line) => line.trim())).toEqual(["tabs /[slug] [home, settings]"]);
  // The lab's own pages are not found; /__dev alone reads as a project slug (a single segment names a project), which the gate sends back.
  for (const href of ["/__dev/screen", "/__dev/screens", "/__dev/tree/inbox", "/__dev/foreign", "/__dev/smoke", "/__dev/gestures"]) expect([href, resolveHref(production, href)]).toEqual([href, null]);
  expect(resolveHref(production, "/__dev")?.params).toEqual({ slug: "__dev" });
  expect(resolveHref(full, "/__dev")?.page.path).toBe("/__dev");
});

test("in the production variant a deep link to the lab ends where an unknown project does: the projects for a visitor, the sign-in for nobody", async () => {
  withInsets(24);
  const launch = globalThis as { __initialURL?: string };
  const mountProduction = async (surface: number, initial: string) => mountTree(surface, { initial, files: await productionFiles(), tabs: projectTabs });
  // A link while the app runs (`standin://__dev`): the lab's pages are not in the tree, so the screens of the lab are ignored,
  const running = await mountProduction(140, "/projects");
  for (const link of ["standin://__dev/screens", "standin://__dev/tree/inbox", "standin://__dev/smoke", "standin-lab://__dev/foreign"]) expect([link, running.router.openURL(link)]).toEqual([link, false]);
  expect(pathsOf(running.router)).toEqual(["/projects"]);
  // and the bare /__dev is a project that is not the visitor's, which the gate (a lab branch for a build without a lab) turns into the list.
  expect(running.router.openURL("standin://__dev")).toBe(true);
  await running.settled();
  expect(pathsOf(running.router)).toEqual(["/projects", "/__dev"]);
  gate(running.router, entered(), false);
  await running.settled();
  expect(pathsOf(running.router)).toEqual(["/projects"]);

  // The link the app was launched with (a QA run opens the lab this way): the same end for a signed-in visitor, the sign-in for nobody.
  launch.__initialURL = "standin://__dev";
  const visitor = await mountProduction(141, "/sign-in");
  await visitor.settled();
  expect(pathsOf(visitor.router)).toEqual(["/__dev"]); // opened with reset: the base of the root stack
  expect(visitor.router.current.url.pathname).toBe("/__dev/home");
  gate(visitor.router, entered(), false);
  await visitor.settled();
  expect(pathsOf(visitor.router)).toEqual(["/projects"]);
  const nobody = await mountProduction(142, "/sign-in");
  await nobody.settled();
  expect(pathsOf(nobody.router)).toEqual(["/__dev"]);
  gate(nobody.router, entered({ user: null }), false);
  await nobody.settled();
  expect(pathsOf(nobody.router)).toEqual(["/sign-in"]);

  // A lab link of a build that has the lab opens the lab (the contrast).
  launch.__initialURL = "standin-lab://__dev/screens";
  const lab = await mountTree(143, { initial: "/sign-in", files: await appFiles(), tabs: projectTabs });
  await lab.settled();
  expect(pathsOf(lab.router)).toEqual(["/__dev/screens"]);
  gate(lab.router, entered(), true);
  expect(pathsOf(lab.router)).toEqual(["/__dev/screens"]);
});

test("a launch by a lab link renders the lab at once, without the session, whatever the session's start does", async () => {
  withInsets(24);
  const launch = globalThis as { __initialURL?: string };
  const backends: [string, () => Promise<void>][] = [
    ["not answering", neverAnswers],
    ["failing", async () => { throw new TypeError("Network request failed"); }],
    ["up", async () => {}],
  ];
  launch.__initialURL = "standin:///__dev";
  for (const [index, [backend, start]] of backends.entries()) {
    const app = await labStart(170 + index, { start });
    // The lab's first screen is the only one rendered: the sign-in (the router's first screen) needs the session and never is, and none was started.
    expect([backend, app.texts()]).toEqual([backend, ["Lab home"]]);
    expect([backend, pathsOf(app.router)]).toEqual([backend, ["/__dev"]]);
    expect([backend, app.starts()]).toEqual([backend, 0]);
    expect([backend, app.sessions()]).toEqual([backend, 0]);
    expect([backend, app.errors, app.warnings]).toEqual([backend, [], []]);
    expect([backend, (globalThis as { __initialURLReads?: number }).__initialURLReads]).toEqual([backend, 1]); // the host is asked for the link once, by the lab start and the <Router> together
    expect([backend, app.router.screens.map((screen) => screen.canGoBack)]).toEqual([backend, [false]]); // the launch link is the base of the stack
    expect(app.hardwareBack()).toBe(false);
  }
});

test("without a lab link the lab app starts as any app does: the session first", async () => {
  withInsets(24);
  const hung = await labStart(173, { start: neverAnswers });
  expect(hung.starts()).toBe(1);
  expect(hung.texts()).toEqual([]); // the spinner
  expect(hung.sessions()).toBe(0);
  // A start that fails shows its message in place of the spinner, and no session was opened.
  const failed = await labStart(172, { start: async () => { throw new Error("The backend is down."); } });
  expect(failed.starts()).toBe(1);
  expect(failed.texts()).toEqual(["The backend is down."]);
  expect(failed.sessions()).toBe(0);
  // A link to an app screen is no lab launch either: the session is opened and the router is where the link says.
  const launch = globalThis as { __initialURL?: string };
  launch.__initialURL = "standin:///projects";
  const linked = await labStart(174);
  for (let turn = 0; turn < 4; turn++) await linked.settled();
  expect(linked.starts()).toBe(1);
  expect(linked.texts()).toContain("Your projects"); // (the sign-in the gate left is still going out, with the clock stopped)
  expect(pathsOf(linked.router)).toEqual(["/projects"]);
});

test("a restart that restored the lab's screens starts the lab on its own although no link came with it; one that restored the sign-in under it does not", async () => {
  withInsets(24);
  const saved = (...hrefs: string[]) => JSON.stringify({ stack: { entries: hrefs.map((href) => ({ href, presentation: "push" })) } });
  const restored = await labStart(178, { start: neverAnswers, navigation: saved("/__dev") });
  expect(restored.texts()).toEqual(["Lab home"]);
  expect(pathsOf(restored.router)).toEqual(["/__dev"]);
  expect(restored.starts()).toBe(0);
  expect(restored.sessions()).toBe(0);
  expect(restored.errors).toEqual([]);
  // The visitor went from the sign-in to the lab: the sign-in is on the stack under it, and needs the session, so the app starts it.
  const below = await labStart(179, { start: neverAnswers, navigation: saved("/sign-in", "/__dev") });
  expect(below.starts()).toBe(1);
  expect(below.sessions()).toBe(0);
  expect(below.texts()).toEqual([]);
});

test("a lab start by a deep link ends where the same link opened on the running lab ends: the same screen, a base with no back arrow, nothing leaving", async () => {
  withInsets(24);
  const launch = globalThis as { __initialURL?: string };
  const ends = (app: { router: TreeRouter }) => ({ paths: pathsOf(app.router), arrows: app.router.screens.map((screen) => screen.canGoBack), leaving: app.router.screens.map((screen) => screen.leaving) });
  const links: [string, string][] = [["standin-lab:///__dev/screens?mode=sheet", "/__dev/screens?mode=sheet"], ["standin-lab://__dev/screen", "/__dev/screen"]];
  for (const [index, [link, path]] of links.entries()) {
    launch.__initialURL = link;
    const cold = await labStart(184 + index * 2);
    const coldEnds = ends(cold);
    await cold.close();
    launch.__initialURL = "standin-lab:///__dev";
    const warm = await labStart(185 + index * 2);
    sendLink(link);
    await warm.settled();
    const warmEnds = ends(warm);
    await warm.close();
    expect([link, coldEnds]).toEqual([link, { paths: [path], arrows: [false], leaving: [false] }]); // the launch link is the base of the stack
    // The warm link is a plain goto: it stacks on the lab. The screen on top is the cold start's.
    expect([link, warmEnds.paths]).toEqual([link, ["/__dev", path]]);
  }
});

test("a link to an app screen opened into a lab start starts the session and shows that screen; the lab never waited for it", async () => {
  withInsets(24);
  const launch = globalThis as { __initialURL?: string };
  launch.__initialURL = "standin-lab:///__dev";
  const app = await labStart(182);
  const turns = async () => { for (let turn = 0; turn < 3; turn++) await app.settled(); };
  expect(app.texts()).toEqual(["Lab home"]);
  expect(app.starts()).toBe(0);
  sendLink("standin:///projects");
  await turns();
  expect(app.starts()).toBe(1);
  expect(app.sessions()).toBe(1);
  expect(app.texts()).toEqual(["Lab home", "Your projects"]); // the lab's screen stays mounted under the pushed one
  expect(app.errors).toEqual([]);
  expect(trouble(app.texts(), app.errors)).toEqual([]);
  expect(pathsOf(app.router)).toEqual(["/__dev", "/projects"]); // a later link is a plain goto: the screen stacks on the lab
  // The router listens for links again (its <Router> mounted anew inside the session): a lab link opens the lab's screen on top.
  expect(handlersOf("__linkHandlers")).toHaveLength(1);
  sendLink("standin-lab:///__dev/screens");
  await turns();
  expect(pathsOf(app.router)).toEqual(["/__dev", "/projects", "/__dev/screens"]);
  expect(app.starts()).toBe(1);
});

test("a lab start that goes on to an app screen waits for the session with the spinner, and the lab alone never starts one", async () => {
  withInsets(24);
  const launch = globalThis as { __initialURL?: string };
  launch.__initialURL = "standin-lab:///__dev";
  const app = await labStart(183, { start: neverAnswers });
  const turns = async () => { for (let turn = 0; turn < 3; turn++) await app.settled(); };
  expect(app.texts()).toEqual(["Lab home"]);
  app.router.goto("/__dev/screens");
  await turns();
  expect(app.starts()).toBe(0); // the lab's own screens ask for nothing
  app.router.goto("/projects");
  await turns();
  expect(app.starts()).toBe(1);
  expect(app.texts()).toEqual([]); // the spinner: the screen needs the session, which is not there yet
  expect(app.sessions()).toBe(0);
});
