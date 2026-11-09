import type { Component } from "svelte";
import { buildTree, type PageRoute, type RouteFile, type RouteNode, type StackNode } from "../src/route-tree.ts";
import Page from "./tree-page.svelte";
import ContentLayout from "./tree-content-layout.svelte";
import TabsLayout from "./tree-tabs-layout.svelte";
import BareTabsLayout from "./tree-bare-tabs-layout.svelte";
import StackLayout from "./tree-stack-layout.svelte";

const file = (path: string, exports: RouteFile["exports"] = {}): RouteFile => ({ path, exports });

/** The app shape the route-tree contract describes (SPEC "Route tree: layouts as navigators"): pages at the root, a modal, a workspace with tabs (home and inbox, the inbox with a stack layout), a modal over them, and a flow (a stack navigator, with a stack navigator of its own). */
export const files: RouteFile[] = [
  file("+layout.mobile.svelte"),
  file("workspaces/+mobile.svelte"),
  file("(account)/account/+mobile.svelte", { presentation: "modal" }),
  file("(workspace)/[slug]/(tabs)/+layout.mobile.svelte", { navigator: "tabs" }),
  file("(workspace)/[slug]/(tabs)/home/+mobile.svelte"),
  file("(workspace)/[slug]/(tabs)/home/thread/[id]/+mobile.svelte"),
  file("(workspace)/[slug]/(tabs)/inbox/+layout.mobile.svelte", { navigator: "stack" }),
  file("(workspace)/[slug]/(tabs)/inbox/+mobile.svelte"),
  file("(workspace)/[slug]/(tabs)/inbox/compose/+mobile.svelte", { presentation: "sheet" }),
  file("(workspace)/[slug]/settings/[[section]]/+mobile.svelte", { presentation: "modal" }),
  file("(workspace)/[slug]/flow/+layout.mobile.svelte", { navigator: "stack" }),
  file("(workspace)/[slug]/flow/start/+mobile.svelte"),
  file("(workspace)/[slug]/flow/done/+mobile.svelte"),
  file("(workspace)/[slug]/flow/inner/+layout.mobile.svelte", { navigator: "stack" }),
  file("(workspace)/[slug]/flow/inner/step/+mobile.svelte"),
  file("(workspace)/+layout.mobile.svelte"),
];

/** A page and a navigator in one stack whose paths overlap: `/x/flow` is the navigator's own, yet navigating to it lands on the page `/x/[id]`. */
export const collidingFiles: RouteFile[] = [
  file("+layout.mobile.svelte"),
  file("x/flow/+layout.mobile.svelte", { navigator: "stack" }),
  file("x/flow/start/+mobile.svelte"),
  file("x/[id]/+mobile.svelte"),
];

type AppTreeOptions = { files?: RouteFile[]; bareTabs?: boolean; logLoads?: string[]; hold?: Record<string, ((error?: Error) => void)[]> };

/** The tree `buildTree` makes of `files` (the product shape by default), linked to the test components the way the generated table links the app's: a layout is a tabs bar, a stack or a content layout by what it exports. */
export function appTree({ files: source = files, bareTabs = false, logLoads, hold }: AppTreeOptions = {}): StackNode {
  const componentOf = (path: string): Component => {
    const layout = source.find((candidate) => candidate.path === path && path.endsWith("+layout.mobile.svelte"));
    if (!layout) return Page;
    return layout.exports.navigator === "tabs" ? (bareTabs ? BareTabsLayout : TabsLayout) : layout.exports.navigator === "stack" ? StackLayout : ContentLayout;
  };
  // With `hold`, a loader waits until the test calls the release it left there (given an error, the load fails with it).
  const loader = (path: string, around: readonly string[] = []) => () => {
    logLoads?.push(path);
    const modules = { component: componentOf(path), layouts: around.map(componentOf) };
    if (!hold) return Promise.resolve(modules);
    const releases = hold[path] ?? [];
    hold[path] = releases;
    return new Promise<typeof modules>((done, fail) => { releases.push((error) => (error ? fail(error) : done(modules))); });
  };
  const linkNode = <Node extends RouteNode>(node: Node): Node => {
    const linked = node.kind === "stack" ? { ...node, routes: node.routes.map(link) } : { ...node, panes: node.panes.map((pane) => ({ key: pane.key, stack: linkNode(pane.stack) })) };
    return node.layoutFile === undefined ? linked as Node : { ...linked, layout: loader(node.layoutFile, node.layouts) } as Node;
  };
  const link = (route: PageRoute | RouteNode): PageRoute | RouteNode => route.kind === "page" ? { ...route, load: loader(route.file ?? "", route.layouts) } : linkNode(route);
  return linkNode(buildTree(source));
}
