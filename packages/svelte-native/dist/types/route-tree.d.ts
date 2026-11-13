import type { Component } from "svelte";
import type { Presentation } from "./fabric/navigation.js";
/**
 * The route tree (contract: SPEC.md "Route tree: layouts as navigators"): the pure core of the router. `buildTree` turns the
 * route files into the tree the generator writes, `resolve` finds the page and the chain of navigators for an href, and `plan`
 * turns a resolved target and the current navigation state into one operation per navigator. Nothing here touches Svelte or
 * React Native, so the generator (which runs under Node) imports it as well as the router.
 */
/** What loading a route yields: its component and the content layouts around it, outermost first. */
export type RouteModules = {
    component: Component;
    layouts: Component[];
};
/** Imports a route's code. The router calls it once per route, when the route is first needed. */
export type Loader = () => Promise<RouteModules>;
/**
 * A tree is data (what `buildTree` returns: the files each route comes from) plus loaders (what the generated table adds, and
 * what a hand-written tree must give). The files are optional because the router never reads them, the loaders because
 * `buildTree` has no code to load; the router names the route in the error when a loader is missing.
 */
export type PageRoute = {
    kind: "page";
    id: string;
    path: string;
    presentation: Presentation;
    /** The page file and the content layouts above it (outermost first, the root layout excluded), relative to `src/routes`. */
    file?: string;
    layouts?: string[];
    load?: Loader;
};
export type StackNode = {
    kind: "stack";
    id: string;
    path: string;
    routes: (PageRoute | RouteNode)[];
    /** The navigator layout of a nested stack, or the options layout of a pane's stack. */
    layoutFile?: string;
    /** The content layouts around a nested navigator's screen; a pane's stack is no screen and has none. */
    layouts?: string[];
    layout?: Loader;
    /** The root only: the root layout, the app shell around the root navigator. */
    shellFile?: string;
};
export type Pane = {
    key: string;
    stack: StackNode;
};
export type TabsNode = {
    kind: "tabs";
    id: string;
    path: string;
    panes: Pane[];
    layoutFile?: string;
    layouts?: string[];
    layout?: Loader;
};
export type RouteNode = StackNode | TabsNode;
/** A route file as the generator reads it: its path under `src/routes` and the literals its module script exports. */
export type RouteFile = {
    path: string;
    exports: {
        presentation?: Presentation;
        navigator?: "stack" | "tabs";
    };
};
export declare function buildTree(files: readonly RouteFile[]): StackNode;
/** The parameters of `pathname` against a route path (`[id]`, `[[id]]`, `[...rest]`), or `null` when it does not match or has a bad escape. */
export declare function matchPath(path: string, pathname: string): Record<string, string> | null;
/** The path of a route with its parameters in place: `/[slug]/inbox` with `{ slug: "acme" }` is `/acme/inbox`. */
export declare function fillPath(path: string, params: Readonly<Record<string, string>>): string;
/** One navigator on the way to a page: for tabs, `select` is the pane the page is in. */
export type ChainStep = {
    node: RouteNode;
    select?: string;
};
/**
 * What an href names: a page, its parameters, and the navigators above it from the root down. `href` is the path, query and
 * hash the entry will carry; it is the page's own path when the href named a tabs screen (the first pane's index page).
 */
export type Resolution = {
    page: PageRoute;
    params: Record<string, string>;
    chain: ChainStep[];
    href: string;
};
/** The origin every route URL of the app is built on (`page.url`, `NativeLocation.url`): a native screen has no real one. */
export declare const BASE = "https://native.invalid";
/** The page `href` names and the chain of navigators above it, or `null` when no page matches. Query and hash do not take part in matching. */
export declare function resolve(tree: StackNode, href: string): Resolution | null;
/**
 * The route of `stack` an entry shows: the one with the `id` it was recorded with when that route is still there and still matches
 * the href (a page and a navigator of one stack can share a path: only the id says which it was), else the first route whose own
 * path matches, a page or the screen of a navigator.
 */
export declare function locate(stack: StackNode, href: string, id?: string): {
    route: PageRoute | RouteNode;
    params: Record<string, string>;
} | null;
export type Navigation = {
    replaceState?: boolean;
    reset?: boolean;
    presentation?: Presentation;
};
/** The navigation state `plan` reads: a stack's entry hrefs (bottom first) or a tabs node's selected pane, by node id. */
export type NodeState = {
    entries: readonly string[];
} | {
    selected: string;
};
export type State = Readonly<Record<string, NodeState>>;
export type Operation = {
    node: string;
    op: "select";
    pane: string;
} | {
    node: string;
    op: "push" | "replace" | "reset";
    href: string;
    presentation: Presentation;
} | {
    node: string;
    op: "popTo";
    href: string;
};
/**
 * The operations that take the app to `target`, one per navigator on its chain that has something to do, root first. A navigator
 * pushed by the plan starts empty: what the state says about the ones below it belongs to another instance. With `reset` every
 * navigator on the chain has something to do: each stack above the owner resets to its screen of the chain (an instance that is
 * already there stays), each tabs node selects the pane, and the owner resets to the target (keeping its base page in a pane).
 */
export declare function plan(state: State, target: Resolution, navigation: Navigation): Operation[];
