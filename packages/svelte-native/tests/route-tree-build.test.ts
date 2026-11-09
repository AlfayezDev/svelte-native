import { describe, expect, test } from "bun:test";
import { buildTree, fillPath, locate, matchPath, plan, resolve, type RouteFile, type StackNode } from "../src/route-tree.ts";

/** What the golden vectors (route-tree.test.ts) leave open: nested stack navigators, the other build errors, parameters, ordering. */
const file = (path: string, exports: RouteFile["exports"] = {}): RouteFile => ({ path, exports });
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
