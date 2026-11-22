import { describe, expect, test } from "bun:test";
import { buildTree, compareRoutes, fillPath, locate, matchPath, plan, resolve, type RouteNode, type RouteFile, type StackNode } from "../../src/route-tree.ts";

/**
 * Golden vectors of the route tree contract (SPEC.md "Route tree: layouts as navigators"). `buildTree` takes the route files
 * (paths relative to `src/routes`, with what their module scripts export) and gives the tree the generator writes; `resolve`
 * and `plan` are the router's pure core. The loaders are not part of the vectors: they are compared by the file they load. After the vectors: nested stack navigators, the
 * other build errors, paths and parameters, and ordering.
 */
const file = (path: string, exports: RouteFile["exports"] = {}): RouteFile => ({ path, exports });

const app: RouteFile[] = [
  file("+layout.mobile.svelte"),
  file("(public)/auth/login/+mobile.svelte"),
  file("onboarding/profile/+mobile.svelte"),
  file("workspaces/+mobile.svelte"),
  file("workspaces/create/+mobile.svelte"),
  file("(account)/account/+mobile.svelte", { presentation: "modal" }),
  file("(workspace)/[slug]/(tabs)/+layout.mobile.svelte", { navigator: "tabs" }),
  file("(workspace)/[slug]/(tabs)/home/+mobile.svelte"),
  file("(workspace)/[slug]/(tabs)/home/thread/[id]/+mobile.svelte"),
  file("(workspace)/[slug]/(tabs)/inbox/+layout.mobile.svelte", { navigator: "stack" }),
  file("(workspace)/[slug]/(tabs)/inbox/+mobile.svelte"),
  file("(workspace)/[slug]/(tabs)/inbox/compose/+mobile.svelte", { presentation: "sheet" }),
  file("(workspace)/[slug]/(tabs)/inbox/+error.mobile.svelte"),
  file("(workspace)/[slug]/settings/[[section]]/+mobile.svelte", { presentation: "modal" }),
  file("(workspace)/+layout.mobile.svelte"),
];

const loads = (node: RouteNode): unknown => JSON.parse(JSON.stringify(node, (key, value: unknown) => (key === "load" || key === "layout" ? undefined : value)));

describe("the tree the generator writes", () => {
  const tree = buildTree(app);

  test("the root is an implicit stack over the pages outside any navigator, most specific first", () => {
    expect(tree.kind).toBe("stack");
    expect(tree.id).toBe("");
    expect(tree.path).toBe("/");
    expect(tree.kind === "stack" && tree.routes.map((route) => route.path)).toEqual([
      "/auth/login", "/onboarding/profile", "/workspaces/create", "/workspaces", "/account", "/[slug]/settings/[[section]]", "/[slug]",
    ]);
  });

  test("a tabs layout directory is one route of its parent, with a pane per child directory", () => {
    const tabs = tree.kind === "stack" ? tree.routes.find((route) => route.path === "/[slug]") : undefined;
    expect(tabs?.kind).toBe("tabs");
    expect(tabs?.kind === "tabs" && tabs.id).toBe("(workspace)/[slug]/(tabs)");
    expect(tabs?.kind === "tabs" && tabs.panes.map((pane) => pane.key)).toEqual(["home", "inbox"]);
  });

  test("a pane is a stack whose base is its index page; a navigator layout in a pane sets its options, not another level", () => {
    const tabs = tree.kind === "stack" ? tree.routes.find((route) => route.kind === "tabs") : undefined;
    const home = tabs?.kind === "tabs" ? tabs.panes[0]?.stack : undefined;
    const inbox = tabs?.kind === "tabs" ? tabs.panes[1]?.stack : undefined;
    expect(home && loads(home)).toEqual({
      kind: "stack", id: "(workspace)/[slug]/(tabs)/home", path: "/[slug]/home",
      routes: [
        { kind: "page", id: "(workspace)/[slug]/(tabs)/home/thread/[id]", path: "/[slug]/home/thread/[id]", presentation: "push", file: "(workspace)/[slug]/(tabs)/home/thread/[id]/+mobile.svelte", layouts: ["(workspace)/+layout.mobile.svelte"] },
        { kind: "page", id: "(workspace)/[slug]/(tabs)/home", path: "/[slug]/home", presentation: "push", file: "(workspace)/[slug]/(tabs)/home/+mobile.svelte", layouts: ["(workspace)/+layout.mobile.svelte"] },
      ],
    });
    expect(inbox?.layoutFile).toBe("(workspace)/[slug]/(tabs)/inbox/+layout.mobile.svelte");
    expect(inbox?.routes.map((route) => [route.path, route.kind === "page" ? route.presentation : route.kind])).toEqual([["/[slug]/inbox/compose", "sheet"], ["/[slug]/inbox", "push"]]);
  });

  test("a content layout wraps the pages below it, outermost first; the root layout is the shell, not a layout of the pages", () => {
    const page = tree.kind === "stack" ? tree.routes.find((route) => route.path === "/[slug]/settings/[[section]]") : undefined;
    expect(page?.kind === "page" && page.layouts).toEqual(["(workspace)/+layout.mobile.svelte"]);
    const login = tree.kind === "stack" ? tree.routes.find((route) => route.path === "/auth/login") : undefined;
    expect(login?.kind === "page" && login.layouts).toEqual([]);
    expect(tree.layoutFile).toBeUndefined();
    expect(tree.shellFile).toBe("+layout.mobile.svelte");
  });

  test("build errors: a page next to a tabs layout, a pane without an index page, a page directly under the tabs, nested tab bars", () => {
    expect(() => buildTree([...app, file("(workspace)/[slug]/(tabs)/+mobile.svelte")])).toThrow("(workspace)/[slug]/(tabs)/+mobile.svelte: a tabs layout is the screen of its directory; move the page into a pane");
    expect(() => buildTree([...app, file("(workspace)/[slug]/(tabs)/search/results/+mobile.svelte")])).toThrow("pane search of (workspace)/[slug]/(tabs) has no index page (+mobile.svelte)");
    expect(() => buildTree([...app, file("(workspace)/[slug]/(tabs)/more/+layout.mobile.svelte", { navigator: "tabs" }), file("(workspace)/[slug]/(tabs)/more/a/+mobile.svelte")])).toThrow("(workspace)/[slug]/(tabs)/more/+layout.mobile.svelte: a tab bar inside a tab bar is not supported");
    expect(() => buildTree([file("+layout.mobile.svelte", { navigator: "tabs" }), file("a/+mobile.svelte")])).toThrow("+layout.mobile.svelte: the root layout is the app shell and cannot be a navigator");
  });

  test("a group directly under the tabs is flattened into panes", () => {
    const tree = buildTree([
      file("(tabs)/+layout.mobile.svelte", { navigator: "tabs" }),
      file("(tabs)/(main)/home/+mobile.svelte"),
      file("(tabs)/(main)/inbox/+mobile.svelte"),
      file("about/+mobile.svelte"),
    ]);
    const tabs = tree.kind === "stack" ? tree.routes.find((route) => route.kind === "tabs") : undefined;
    expect(tabs?.kind === "tabs" && tabs.path).toBe("/");
    expect(tabs?.kind === "tabs" && tabs.panes.map((pane) => [pane.key, pane.stack.path])).toEqual([["home", "/home"], ["inbox", "/inbox"]]);
    expect(tree.kind === "stack" && tree.routes.map((route) => route.path)).toEqual(["/about", "/"]);
  });
});

describe("resolving an href to a page and its chain of navigators", () => {
  const tree = buildTree(app);
  const chain = (href: string) => resolve(tree, href)?.chain.map((step) => [step.node.id, step.select ?? null]);

  test("a root page has the root alone on its chain", () => {
    expect(chain("/workspaces")).toEqual([["", null]]);
    expect(resolve(tree, "/workspaces/create?draft=1")?.page.id).toBe("workspaces/create");
    expect(resolve(tree, "/account")?.page.presentation).toBe("modal");
  });

  test("a page in a pane names the tabs node with the pane to select and the pane's stack as its owner", () => {
    expect(chain("/acme/inbox/compose")).toEqual([["", null], ["(workspace)/[slug]/(tabs)", "inbox"], ["(workspace)/[slug]/(tabs)/inbox", null]]);
    expect(resolve(tree, "/acme/home/thread/42")?.params).toEqual({ slug: "acme", id: "42" });
  });

  test("the tabs screen itself resolves to its first pane's index page", () => {
    const hit = resolve(tree, "/acme");
    expect(hit?.page.id).toBe("(workspace)/[slug]/(tabs)/home");
    expect(hit?.chain.map((step) => step.select ?? null)).toEqual([null, "home", null]);
  });

  test("no page, no match; a bad escape is no match", () => {
    // "/nowhere" is a workspace slug, so it is the tabs screen; a path no route has the shape of is nothing.
    expect(resolve(tree, "/a/b/c/d/e")).toBeNull();
    expect(resolve(tree, "/acme/inbox/compose/more")).toBeNull();
    expect(resolve(tree, "/acme/inbox/%E0%A4%A")).toBeNull();
  });
});

describe("the navigation plan", () => {
  const tree = buildTree(app);
  const state = {
    "": { entries: ["/workspaces", "/acme"] },
    "(workspace)/[slug]/(tabs)": { selected: "home" },
    "(workspace)/[slug]/(tabs)/home": { entries: ["/acme/home"] },
    "(workspace)/[slug]/(tabs)/inbox": { entries: ["/acme/inbox"] },
  };
  const target = (href: string) => { const hit = resolve(tree, href); if (!hit) throw new Error(href); return hit; };

  test("a push within the shown pane touches only the pane's stack", () => {
    expect(plan(state, target("/acme/home/thread/42"), {})).toEqual([
      { node: "(workspace)/[slug]/(tabs)/home", op: "push", href: "/acme/home/thread/42", presentation: "push" },
    ]);
  });

  test("a route of another pane selects the pane, then pushes in its stack; the page's own presentation applies", () => {
    expect(plan(state, target("/acme/inbox/compose"), {})).toEqual([
      { node: "(workspace)/[slug]/(tabs)", op: "select", pane: "inbox" },
      { node: "(workspace)/[slug]/(tabs)/inbox", op: "push", href: "/acme/inbox/compose", presentation: "sheet" },
    ]);
    expect(plan(state, target("/acme/inbox/compose"), { presentation: "modal" })[1]).toMatchObject({ presentation: "modal" });
  });

  test("a stack above the owner pops to the screen on the chain when it has it (a modal over the tabs goes away)", () => {
    const withModal = { ...state, "": { entries: ["/workspaces", "/acme", "/account"] } };
    expect(plan(withModal, target("/acme/inbox"), {})).toEqual([
      { node: "", op: "popTo", href: "/acme" },
      { node: "(workspace)/[slug]/(tabs)", op: "select", pane: "inbox" },
    ]);
  });

  test("a deep link into tabs that are not on the root stack pushes the tabs screen first", () => {
    const fresh = { "": { entries: ["/auth/login"] } };
    expect(plan(fresh, target("/acme/inbox/compose"), {})).toEqual([
      { node: "", op: "push", href: "/acme", presentation: "push" },
      { node: "(workspace)/[slug]/(tabs)", op: "select", pane: "inbox" },
      { node: "(workspace)/[slug]/(tabs)/inbox", op: "push", href: "/acme/inbox/compose", presentation: "sheet" },
    ]);
  });

  test("a goto to an href already in the owner stack pops to it instead of stacking a copy; replaceState and reset do not", () => {
    const deep = { ...state, "(workspace)/[slug]/(tabs)/home": { entries: ["/acme/home", "/acme/home/thread/1", "/acme/home/thread/2"] }, "(workspace)/[slug]/(tabs)": { selected: "inbox" } };
    expect(plan(deep, target("/acme/home/thread/1"), {})).toEqual([
      { node: "(workspace)/[slug]/(tabs)", op: "select", pane: "home" },
      { node: "(workspace)/[slug]/(tabs)/home", op: "popTo", href: "/acme/home/thread/1" },
    ]);
    expect(plan(deep, target("/acme/home"), {})[1]).toEqual({ node: "(workspace)/[slug]/(tabs)/home", op: "popTo", href: "/acme/home" }); // the pane's base too
    // The top is nothing to pop to (and the shown pane selects nothing).
    expect(plan({ ...deep, "(workspace)/[slug]/(tabs)": { selected: "home" } }, target("/acme/home/thread/2"), {})).toEqual([]);
    // A modal over the tabs goes first, as for any route of the tabs.
    const withModal = { ...deep, "": { entries: ["/workspaces", "/acme", "/account"] } };
    expect(plan(withModal, target("/acme/home/thread/1"), {}).map((operation) => operation.op)).toEqual(["popTo", "select", "popTo"]);
    // replaceState and reset are what they were.
    expect(plan(deep, target("/acme/home/thread/1"), { replaceState: true })[1]).toMatchObject({ op: "replace", href: "/acme/home/thread/1" });
    expect(plan(deep, target("/acme/home/thread/1"), { reset: true }).at(-1)).toMatchObject({ op: "reset", href: "/acme/home/thread/1" });
  });

  test("replaceState replaces the owner's top and touches no other stack", () => {
    const deep = { ...state, "(workspace)/[slug]/(tabs)/home": { entries: ["/acme/home", "/acme/home/thread/1"] } };
    expect(plan(deep, target("/acme/home/thread/2"), { replaceState: true })).toEqual([
      { node: "(workspace)/[slug]/(tabs)/home", op: "replace", href: "/acme/home/thread/2", presentation: "push" },
    ]);
  });

  test("reset is a new root for the whole chain: every stack above the owner resets to its screen, the root's op first, every tabs node selects, the owner keeps its base and the target", () => {
    const deep = { ...state, "(workspace)/[slug]/(tabs)/home": { entries: ["/acme/home", "/acme/home/thread/1"] } };
    expect(plan(deep, target("/acme/home/thread/2"), { reset: true })).toEqual([
      { node: "", op: "reset", href: "/acme", presentation: "push" },
      { node: "(workspace)/[slug]/(tabs)", op: "select", pane: "home" },
      { node: "(workspace)/[slug]/(tabs)/home", op: "reset", href: "/acme/home/thread/2", presentation: "push" },
    ]);
    // Another pane: the same, selecting that pane (the page's own presentation applies to the owner).
    expect(plan(state, target("/acme/inbox/compose"), { reset: true })).toEqual([
      { node: "", op: "reset", href: "/acme", presentation: "push" },
      { node: "(workspace)/[slug]/(tabs)", op: "select", pane: "inbox" },
      { node: "(workspace)/[slug]/(tabs)/inbox", op: "reset", href: "/acme/inbox/compose", presentation: "sheet" },
    ]);
    // From a modal over the tabs, and from the screens below them: the root keeps only the tabs screen.
    const withModal = { ...state, "": { entries: ["/workspaces", "/acme", "/account"] } };
    expect(plan(withModal, target("/acme"), { reset: true })).toEqual([
      { node: "", op: "reset", href: "/acme", presentation: "push" },
      { node: "(workspace)/[slug]/(tabs)", op: "select", pane: "home" },
      { node: "(workspace)/[slug]/(tabs)/home", op: "reset", href: "/acme/home", presentation: "push" },
    ]);
    // A deep link into tabs that are not on the stack: the root resets to a new tabs screen, which starts empty.
    expect(plan({ "": { entries: ["/auth/login"] } }, target("/acme/inbox/compose"), { reset: true })).toEqual([
      { node: "", op: "reset", href: "/acme", presentation: "push" },
      { node: "(workspace)/[slug]/(tabs)", op: "select", pane: "inbox" },
      { node: "(workspace)/[slug]/(tabs)/inbox", op: "reset", href: "/acme/inbox/compose", presentation: "sheet" },
    ]);
    // A root page is its own owner: the root resets to it and nothing else is on the chain.
    expect(plan(withModal, target("/workspaces"), { reset: true })).toEqual([{ node: "", op: "reset", href: "/workspaces", presentation: "push" }]);
  });

  test("the same href as the shown entry is a no-op unless reset, which resets the whole chain", () => {
    expect(plan(state, target("/acme/home"), {})).toEqual([]);
    expect(plan(state, target("/acme/home"), { reset: true })).toEqual([
      { node: "", op: "reset", href: "/acme", presentation: "push" },
      { node: "(workspace)/[slug]/(tabs)", op: "select", pane: "home" },
      { node: "(workspace)/[slug]/(tabs)/home", op: "reset", href: "/acme/home", presentation: "push" },
    ]);
  });

  test("a root page from inside a pane pushes on the root (a modal over the tabs)", () => {
    expect(plan(state, target("/account"), {})).toEqual([{ node: "", op: "push", href: "/account", presentation: "modal" }]);
  });
});

const paths = (tree: StackNode) => tree.routes.map((route) => route.path);
const target = (tree: StackNode, href: string) => { const hit = resolve(tree, href); if (!hit) throw new Error(`${href} resolves to nothing`); return hit; };

describe("a stack navigator below the root", () => {
  const tree = buildTree([
    file("+layout.mobile.svelte"),
    file("(app)/+layout.mobile.svelte"),
    file("(app)/[slug]/flow/+layout.mobile.svelte", { navigator: "stack" }),
    file("(app)/[slug]/flow/start/+mobile.svelte"),
    file("(app)/[slug]/flow/step/[n]/+mobile.svelte", { presentation: "modal" }),
    file("(app)/[slug]/+mobile.svelte"),
  ]);

  test("is one route of its parent, with the pages below it as its own and the content layouts above it around its screen", () => {
    expect(paths(tree)).toEqual(["/[slug]/flow", "/[slug]"]);
    const flow = tree.routes[0];
    expect(flow.kind === "stack" && flow.id).toBe("(app)/[slug]/flow");
    expect(flow.kind === "stack" && flow.layoutFile).toBe("(app)/[slug]/flow/+layout.mobile.svelte");
    expect(flow.kind === "stack" && flow.layouts).toEqual(["(app)/+layout.mobile.svelte"]);
    expect(flow.kind === "stack" && flow.routes.map((route) => route.path)).toEqual(["/[slug]/flow/start", "/[slug]/flow/step/[n]"]);
  });

  test("resolves with the nested stack on the chain; its screen is its own path", () => {
    const hit = resolve(tree, "/acme/flow/step/2");
    expect(hit?.chain.map((step) => step.node.id)).toEqual(["", "(app)/[slug]/flow"]);
    expect(hit?.params).toEqual({ slug: "acme", n: "2" });
    expect(resolve(tree, "/acme")?.chain.map((step) => step.node.id)).toEqual([""]);
    expect(resolve(tree, "/acme/flow")).toBeNull(); // the layout is the screen, not a page
    const state = { "": { entries: ["/acme"] } };
    expect(plan(state, target(tree, "/acme/flow/start"), {})).toEqual([
      { node: "", op: "push", href: "/acme/flow", presentation: "push" },
      { node: "(app)/[slug]/flow", op: "push", href: "/acme/flow/start", presentation: "push" },
    ]);
    // On its stack already: a second route in it only pushes there; from above it, the screen pops back to it first.
    const inside = { "": { entries: ["/acme", "/acme/flow"] }, "(app)/[slug]/flow": { entries: ["/acme/flow/start"] } };
    expect(plan(inside, target(tree, "/acme/flow/step/1"), {})).toEqual([{ node: "(app)/[slug]/flow", op: "push", href: "/acme/flow/step/1", presentation: "modal" }]);
    const above = { ...inside, "": { entries: ["/acme", "/acme/flow", "/acme"] } };
    expect(plan(above, target(tree, "/acme/flow/step/1"), {})[0]).toEqual({ node: "", op: "popTo", href: "/acme/flow" });
    // A reset resets the root to the navigator's screen and the nested stack to the target.
    expect(plan(inside, target(tree, "/acme/flow/step/1"), { reset: true })).toEqual([
      { node: "", op: "reset", href: "/acme/flow", presentation: "push" },
      { node: "(app)/[slug]/flow", op: "reset", href: "/acme/flow/step/1", presentation: "modal" },
    ]);
  });
});

describe("build errors", () => {
  test("a page next to a stack layout, a navigator in a group directly under tabs, a pane declared twice or by a parameter, nested tabs below a pane", () => {
    expect(() => buildTree([file("a/+layout.mobile.svelte", { navigator: "stack" }), file("a/+mobile.svelte")])).toThrow("a/+mobile.svelte: a stack layout is the screen of its directory; move the page into a child directory");
    expect(() => buildTree([file("t/+layout.mobile.svelte", { navigator: "tabs" }), file("t/(g)/+mobile.svelte")])).toThrow("t/(g)/+mobile.svelte: a page directly under a tabs layout has no pane to show in");
    expect(() => buildTree([file("t/+layout.mobile.svelte", { navigator: "tabs" }), file("t/(g)/x/+layout.mobile.svelte", { navigator: "stack" }), file("t/(g)/+layout.mobile.svelte", { navigator: "stack" })]))
      .toThrow("a navigator layout directly under a tabs layout has no pane to show in");
    expect(() => buildTree([file("t/+layout.mobile.svelte", { navigator: "tabs" }), file("t/(a)/home/+mobile.svelte"), file("t/(b)/home/+mobile.svelte")])).toThrow("pane home of t is defined twice");
    expect(() => buildTree([file("t/+layout.mobile.svelte", { navigator: "tabs" }), file("t/[x]/+mobile.svelte")])).toThrow("a pane is a fixed directory, not a parameter");
    expect(() => buildTree([file("t/+layout.mobile.svelte", { navigator: "tabs" }), file("t/home/+mobile.svelte"), file("t/home/deep/+layout.mobile.svelte", { navigator: "tabs" })])).toThrow("t/home/deep/+layout.mobile.svelte: a tab bar inside a tab bar is not supported");
  });

  test("a navigator whose path is another route's path of the same stack", () => {
    expect(() => buildTree([file("+mobile.svelte"), file("(g)/+layout.mobile.svelte", { navigator: "stack" }), file("(g)/x/+mobile.svelte")])).toThrow("(g)/+layout.mobile.svelte: / is also the path of +mobile.svelte");
  });
});

describe("paths", () => {
  test("match with parameters, optional parameters, rest parameters and trailing slashes; a bad escape in a parameter is no match", () => {
    expect(matchPath("/[slug]/settings/[[section]]", "/acme/settings")).toEqual({ slug: "acme" });
    expect(matchPath("/[slug]/settings/[[section]]", "/acme/settings/profile/")).toEqual({ slug: "acme", section: "profile" });
    expect(matchPath("/docs/[...rest]", "/docs/a/b%20c")).toEqual({ rest: "a/b c" });
    expect(matchPath("/a.b/[id=int]", "/a.b/7")).toEqual({ id: "7" });
    expect(matchPath("/a.b", "/axb")).toBeNull();
    expect(matchPath("/[id]", "/%E0%A4%A")).toBeNull();
  });

  test("fill with the same parameters, encoded, optional ones left out", () => {
    expect(fillPath("/[slug]/settings/[[section]]", { slug: "a b" })).toBe("/a%20b/settings");
    expect(fillPath("/[slug]/settings/[[section]]", { slug: "acme", section: "profile" })).toBe("/acme/settings/profile");
    expect(fillPath("/docs/[...rest]", { rest: "a/b c" })).toBe("/docs/a/b%20c");
    expect(fillPath("/", {})).toBe("/");
  });

  test("an entry href is located in its own stack: a page, or the screen of a navigator", () => {
    const tree = buildTree([file("a/+mobile.svelte"), file("t/+layout.mobile.svelte", { navigator: "tabs" }), file("t/home/+mobile.svelte")]);
    expect(locate(tree, "/a?x=1")?.route.id).toBe("a");
    expect(locate(tree, "/t")?.route.kind).toBe("tabs");
    expect(locate(tree, "/nowhere/else")).toBeNull();
  });

  test("an entry is located by the id of the route it was, so a page and a navigator that share a path come back as they were; an id that is gone falls back to the href", () => {
    const tree = buildTree([file("x/flow/+layout.mobile.svelte", { navigator: "stack" }), file("x/flow/start/+mobile.svelte"), file("x/[id]/+mobile.svelte")]);
    const navigated = resolve(tree, "/x/flow");
    expect(navigated?.page.id).toBe("x/[id]"); // the navigator's own path is no page: navigating to it lands on the page
    expect(locate(tree, "/x/flow")?.route.id).toBe("x/flow"); // by the href alone, the first route that matches: the navigator
    expect(locate(tree, "/x/flow", "x/[id]")).toMatchObject({ route: { id: "x/[id]", kind: "page" }, params: { id: "flow" } });
    expect(locate(tree, "/x/flow", "x/flow")?.route.kind).toBe("stack");
    expect(locate(tree, "/x/7", "renamed")).toMatchObject({ route: { id: "x/[id]" }, params: { id: "7" } });
    expect(locate(tree, "/x/7", "x/flow")?.route.id).toBe("x/[id]"); // the id's route no longer matches the href
  });
});

describe("order", () => {
  test("routes of equal specificity keep the order of the files, so a sorted file list gives a stable table", () => {
    const tree = buildTree([file("b/+mobile.svelte"), file("a/+mobile.svelte"), file("[x]/+mobile.svelte"), file("c/d/+mobile.svelte")]);
    expect(paths(tree)).toEqual(["/c/d", "/b", "/a", "/[x]"]);
  });

  test("panes follow the order of their files", () => {
    const tree = buildTree([file("t/+layout.mobile.svelte", { navigator: "tabs" }), file("t/zed/+mobile.svelte"), file("t/alpha/+mobile.svelte")]);
    const tabs = tree.routes[0];
    expect(tabs.kind === "tabs" && tabs.panes.map((pane) => pane.key)).toEqual(["zed", "alpha"]);
  });
});

describe("rest parameters", () => {
  test("take zero segments too, as in SvelteKit: one catch-all screen opens its base path and the paths below it (#80)", () => {
    expect(matchPath("/files/[...path]", "/files")).toEqual({ path: "" });
    expect(matchPath("/files/[...path]", "/files/")).toEqual({ path: "" });
    expect(matchPath("/files/[...path]", "/files/reports/2026")).toEqual({ path: "reports/2026" });
    expect(matchPath("/files/[...path]", "/filesx")).toBeNull();
    expect(matchPath("/a/[...rest]/z", "/a/z")).toEqual({ rest: "" });
    expect(matchPath("/a/[...rest]/z", "/a/b/z")).toEqual({ rest: "b" });
    expect(matchPath("/[...rest]", "/")).toEqual({ rest: "" });
    expect(fillPath("/files/[...path]", { path: "" })).toBe("/files");
    expect(fillPath("/a/[...rest]/z", { rest: "" })).toBe("/a/z");
    const tree = buildTree([file("files/[...path]/+mobile.svelte"), file("a/[...rest]/z/+mobile.svelte")]);
    expect(resolve(tree, "/files")?.params).toEqual({ path: "" });
    expect(resolve(tree, "/files")?.href).toBe("/files");
    expect(resolve(tree, "/a/z")?.params).toEqual({ rest: "" });
  });
});

describe("ranking", () => {
  test("when several routes match, the one SvelteKit's sort puts first wins: a required parameter over a rest, a leading fixed segment over a parameter (#82)", () => {
    // In the order a directory scan gives: the rest route and the parameter-first route come first.
    const tree = buildTree([
      file("[section]/account/edit/+mobile.svelte"),
      file("files/[...path]/+mobile.svelte"),
      file("files/[id]/+mobile.svelte"),
      file("settings/[area]/[action]/+mobile.svelte"),
    ]);
    expect(resolve(tree, "/files/report")?.page.id).toBe("files/[id]");
    expect(resolve(tree, "/files/a/b")?.page.id).toBe("files/[...path]");
    expect(resolve(tree, "/files")?.page.id).toBe("files/[...path]");
    expect(resolve(tree, "/settings/account/edit")?.page.id).toBe("settings/[area]/[action]");
    expect(resolve(tree, "/other/account/edit")?.page.id).toBe("[section]/account/edit");
  });

  test("ranks across navigators: a page in a nested stack outranks a root page that matches the same URL less specifically", () => {
    const tree = buildTree([file("[x]/q/r/+mobile.svelte"), file("n/+layout.mobile.svelte", { navigator: "stack" }), file("n/[id]/r/+mobile.svelte")]);
    const hit = resolve(tree, "/n/q/r");
    expect(hit?.page.id).toBe("n/[id]/r");
    expect(hit?.chain.map((step) => step.node.id)).toEqual(["", "n"]);
    expect(resolve(tree, "/m/q/r")?.page.id).toBe("[x]/q/r");
  });

  test("sorts as SvelteKit 3.3.0's sort_routes does (the expected orders are its output)", () => {
    const order = (paths: string[]) => paths.map((path) => ({ path, id: path.slice(1) })).sort(compareRoutes).map((route) => route.path);
    expect(order(["/[...rest]", "/[a]", "/a", "/[[a]]", "/a/b", "/[a]/b", "/[...rest]/x", "/a/[b]", "/[a=m]"]))
      .toEqual(["/a", "/a/b", "/a/[b]", "/[a=m]", "/[a]", "/[a]/b", "/[...rest]/x", "/[[a]]", "/[...rest]"]);
    expect(order(["/foo", "/foobar"])).toEqual(["/foobar", "/foo"]);
  });
});

describe("replacing across navigators", () => {
  const tree = buildTree([
    file("(tabs)/+layout.mobile.svelte", { navigator: "tabs" }),
    file("(tabs)/list/+mobile.svelte"),
    file("(tabs)/list/detail/+mobile.svelte"),
    file("(tabs)/settings/+mobile.svelte"),
    file("compose/+mobile.svelte", { presentation: "sheet" }),
  ]);
  const at = (href: string) => { const hit = resolve(tree, href); if (!hit) throw new Error(href); return hit; };

  test("a sheet opened by a link and replaced by a page in tabs that aren't there yet leaves no sheet under the tabs (#88)", () => {
    const linked = { "": { entries: ["/compose"] } };
    expect(plan(linked, at("/list"), { replaceState: true })).toEqual([{ node: "", op: "replace", href: "/", presentation: "push" }]);
    expect(plan(linked, at("/settings"), { replaceState: true })).toEqual([
      { node: "", op: "replace", href: "/", presentation: "push" },
      { node: "(tabs)", op: "select", pane: "settings" },
    ]);
    // The new pane's stack keeps its base: the target goes on top of it.
    expect(plan(linked, at("/list/detail"), { replaceState: true })).toEqual([
      { node: "", op: "replace", href: "/", presentation: "push" },
      { node: "(tabs)/list", op: "push", href: "/list/detail", presentation: "push" },
    ]);
    // A push is still a push.
    expect(plan(linked, at("/list"), {})).toEqual([{ node: "", op: "push", href: "/", presentation: "push" }]);
  });

  test("a replacement takes the shown screen only: once a pop above has taken it away, the new navigator is pushed", () => {
    const nested = buildTree([
      file("(tabs)/+layout.mobile.svelte", { navigator: "tabs" }),
      file("(tabs)/list/+mobile.svelte"),
      file("(tabs)/list/flow/+layout.mobile.svelte", { navigator: "stack" }),
      file("(tabs)/list/flow/start/+mobile.svelte"),
      file("home/+mobile.svelte"),
      file("compose/+mobile.svelte", { presentation: "sheet" }),
    ]);
    const hit = (href: string) => { const found = resolve(nested, href); if (!found) throw new Error(href); return found; };
    // The sheet is shown over the tabs: the pop takes it away, and the flow is pushed in the pane.
    const overTabs = { "": { entries: ["/", "/compose"] }, "(tabs)": { selected: "list" }, "(tabs)/list": { entries: ["/list"] } };
    expect(plan(overTabs, hit("/list/flow/start"), { replaceState: true })).toEqual([
      { node: "", op: "popTo", href: "/" },
      { node: "(tabs)/list", op: "push", href: "/list/flow", presentation: "push" },
      { node: "(tabs)/list/flow", op: "push", href: "/list/flow/start", presentation: "push" },
    ]);
    // The sheet is shown over another root page: the tabs replace the sheet, and the page below stays.
    const overHome = { "": { entries: ["/home", "/compose"] } };
    expect(plan(overHome, hit("/list/flow/start"), { replaceState: true })).toEqual([
      { node: "", op: "replace", href: "/", presentation: "push" },
      { node: "(tabs)/list", op: "push", href: "/list/flow", presentation: "push" },
      { node: "(tabs)/list/flow", op: "push", href: "/list/flow/start", presentation: "push" },
    ]);
  });
});
