import { describe, expect, test } from "bun:test";
import { buildTree, plan, resolve, type RouteNode, type RouteFile } from "../src/route-tree.ts";

/**
 * Golden vectors of the route tree contract (SPEC.md "Route tree: layouts as navigators"). `buildTree` takes the route files
 * (paths relative to `src/routes`, with what their module scripts export) and gives the tree the generator writes; `resolve`
 * and `plan` are the router's pure core. The loaders are not part of the vectors: they are compared by the file they load.
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
    expect(inbox && inbox.routes.map((route) => [route.path, route.kind === "page" ? route.presentation : route.kind])).toEqual([["/[slug]/inbox/compose", "sheet"], ["/[slug]/inbox", "push"]]);
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
