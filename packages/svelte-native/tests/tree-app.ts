import type { Component } from "svelte";
import { buildTree, type PageRoute, type RouteFile, type RouteNode, type StackNode } from "../src/route-tree.ts";
import Page from "./tree-page.svelte";
import ContentLayout from "./tree-content-layout.svelte";
import TabsLayout from "./tree-tabs-layout.svelte";
import BareTabsLayout from "./tree-bare-tabs-layout.svelte";
import StackLayout from "./tree-stack-layout.svelte";

const file = (path: string, exports: RouteFile["exports"] = {}): RouteFile => ({ path, exports });

/** The product shape the contract describes: pages at the root, a modal, a workspace with tabs (home and inbox, the inbox with a stack layout) and a modal over them. */
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
  file("(workspace)/+layout.mobile.svelte"),
];

/** The tree `buildTree` makes of `files`, linked to the test components the way the generated table links the app's. */
export function appTree({ bareTabs = false, logLoads, hold }: { bareTabs?: boolean; logLoads?: string[]; hold?: Record<string, (() => void)[]> } = {}): StackNode {
  const layouts: Record<string, Component> = {
    "(workspace)/+layout.mobile.svelte": ContentLayout,
    "(workspace)/[slug]/(tabs)/+layout.mobile.svelte": bareTabs ? BareTabsLayout : TabsLayout,
    "(workspace)/[slug]/(tabs)/inbox/+layout.mobile.svelte": StackLayout,
    "(workspace)/[slug]/flow/+layout.mobile.svelte": StackLayout,
  };
  const componentOf = (path: string): Component => layouts[path] ?? Page;
  // With `hold`, a loader waits until the test calls the release it left there.
  const loader = (path: string, around: readonly string[] = []) => () => {
    logLoads?.push(path);
    const modules = { component: componentOf(path), layouts: around.map(componentOf) };
    return hold ? new Promise<typeof modules>((done) => { (hold[path] ??= []).push(() => done(modules)); }) : Promise.resolve(modules);
  };
  const linkNode = <Node extends RouteNode>(node: Node): Node => {
    const linked = node.kind === "stack" ? { ...node, routes: node.routes.map(link) } : { ...node, panes: node.panes.map((pane) => ({ key: pane.key, stack: linkNode(pane.stack) })) };
    return node.layoutFile === undefined ? linked as Node : { ...linked, layout: loader(node.layoutFile, node.layouts) } as Node;
  };
  const link = (route: PageRoute | RouteNode): PageRoute | RouteNode => route.kind === "page" ? { ...route, load: loader(route.file ?? "", route.layouts) } : linkNode(route);
  return linkNode(buildTree(files));
}
