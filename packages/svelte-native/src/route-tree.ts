import type { Component } from "svelte";
import type { Presentation } from "./fabric/navigation.ts";

/**
 * The route tree (contract: SPEC.md "Route tree: layouts as navigators"): the pure core of the router. `buildTree` turns the
 * route files into the tree the generator writes, `resolve` finds the page and the chain of navigators for an href, and `plan`
 * turns a resolved target and the current navigation state into one operation per navigator. Nothing here touches Svelte or
 * React Native, so the generator (which runs under Node) imports it as well as the router.
 */

/** What loading a route yields: its component and the content layouts around it, outermost first. */
export type RouteModules = { component: Component; layouts: Component[] };
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
export type Pane = { key: string; stack: StackNode };
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
export type RouteFile = { path: string; exports: { presentation?: Presentation; navigator?: "stack" | "tabs" } };

const PAGE = "+mobile.svelte";
const LAYOUT = "+layout.mobile.svelte";
const isGroup = (segment: string) => segment.startsWith("(");
const pathOf = (directory: readonly string[]) => `/${directory.filter((segment) => !isGroup(segment)).join("/")}`;
/** Routes sort by how many fixed segments their path has: `/a/b` before `/a/[id]` before `/[x]`. */
const staticSegments = (path: string) => path.split("/").filter((part) => part !== "" && !part.startsWith("[")).length;

type Source = { path: string; directory: string[]; key: string; index: number; exports: RouteFile["exports"] };

export function buildTree(files: readonly RouteFile[]): StackNode {
  const pages = new Map<string, Source>();
  const layouts = new Map<string, Source>();
  files.forEach((file, index) => {
    const directory = file.path.split("/");
    const name = directory.pop();
    const source = { path: file.path, directory, key: directory.join("/"), index, exports: file.exports };
    if (name === PAGE) pages.set(source.key, source);
    else if (name === LAYOUT) layouts.set(source.key, source);
  });
  const everyDirectory = [...pages.values(), ...layouts.values()];
  const prefixes = (directory: readonly string[]) => Array.from({ length: directory.length + 1 }, (_, length) => directory.slice(0, length).join("/"));

  const navigators = new Map<string, Source & { navigator: "stack" | "tabs" }>();
  for (const layout of layouts.values()) {
    const navigator = layout.exports.navigator;
    if (!navigator) continue;
    if (layout.key === "") throw new Error(`${layout.path}: the root layout is the app shell and cannot be a navigator`);
    navigators.set(layout.key, { ...layout, navigator });
  }
  for (const layout of navigators.values()) {
    if (layout.navigator === "tabs" && prefixes(layout.directory).slice(0, -1).some((key) => navigators.get(key)?.navigator === "tabs")) {
      throw new Error(`${layout.path}: a tab bar inside a tab bar is not supported`);
    }
  }

  // The panes of every tabs node: its child directories, groups flattened.
  type PaneSource = { key: string; directory: string[]; first: number };
  const paneSources = new Map<string, PaneSource[]>();
  const paneDirectories = new Set<string>();
  for (const tabs of navigators.values()) {
    if (tabs.navigator !== "tabs") continue;
    const found = new Map<string, PaneSource>();
    for (const source of everyDirectory) {
      if (!source.key.startsWith(`${tabs.key}/`)) continue;
      const relative = source.directory.slice(tabs.directory.length);
      let groups = 0;
      while (groups < relative.length && isGroup(relative[groups])) groups++;
      if (groups === relative.length) {
        const isPage = pages.get(source.key) === source;
        if (isPage || navigators.has(source.key)) throw new Error(`${source.path}: a ${isPage ? "page" : "navigator layout"} directly under a tabs layout has no pane to show in; move it into a pane directory`);
        continue;
      }
      const key = relative[groups];
      const directory = tabs.directory.concat(relative.slice(0, groups + 1));
      const known = found.get(key);
      if (known && known.directory.join("/") !== directory.join("/")) throw new Error(`pane ${key} of ${tabs.key} is defined twice: ${known.directory.join("/")} and ${directory.join("/")}`);
      if (key.startsWith("[")) throw new Error(`${source.path}: a pane is a fixed directory, not a parameter`);
      if (known) known.first = Math.min(known.first, source.index);
      else found.set(key, { key, directory, first: source.index });
    }
    paneSources.set(tabs.key, [...found.values()].sort((a, b) => a.first - b.first));
    for (const pane of found.values()) paneDirectories.add(pane.directory.join("/"));
  }
  for (const layout of navigators.values()) {
    const page = pages.get(layout.key);
    if (page && !paneDirectories.has(layout.key)) {
      throw new Error(`${page.path}: a ${layout.navigator} layout is the screen of its directory; move the page into ${layout.navigator === "tabs" ? "a pane" : "a child directory"}`);
    }
  }

  const contentLayouts = (directory: readonly string[]) => prefixes(directory).slice(1).flatMap((key) => {
    const layout = layouts.get(key);
    return layout && !layout.exports.navigator ? [layout.path] : [];
  });

  // Every stack in the tree by directory: the root, nested stack layouts and the panes' stacks.
  const root: StackNode = { kind: "stack", id: "", path: "/", routes: [] };
  const rootLayout = layouts.get("");
  if (rootLayout) root.shellFile = rootLayout.path;
  const stacks = new Map<string, StackNode>([["", root]]);
  const nodes = new Map<string, RouteNode>();
  for (const layout of navigators.values()) {
    if (paneDirectories.has(layout.key)) continue;
    const common = { id: layout.key, path: pathOf(layout.directory), layoutFile: layout.path, layouts: contentLayouts(layout.directory.slice(0, -1)) };
    if (layout.navigator === "stack") {
      const node: StackNode = { kind: "stack", ...common, routes: [] };
      stacks.set(layout.key, node);
      nodes.set(layout.key, node);
    } else {
      nodes.set(layout.key, { kind: "tabs", ...common, panes: [] });
    }
  }
  for (const [tabsKey, found] of paneSources) {
    const tabs = nodes.get(tabsKey);
    if (tabs?.kind !== "tabs") continue;
    for (const source of found) {
      const key = source.directory.join("/");
      if (!pages.has(key)) throw new Error(`pane ${source.key} of ${tabsKey} has no index page (${PAGE})`);
      const stack: StackNode = { kind: "stack", id: key, path: pathOf(source.directory), routes: [] };
      const paneLayout = navigators.get(key);
      if (paneLayout) stack.layoutFile = paneLayout.path;
      stacks.set(key, stack);
      tabs.panes.push({ key: source.key, stack });
    }
  }

  const ownerOf = (directory: readonly string[], inclusive: boolean) => {
    const keys = prefixes(directory);
    for (let at = keys.length - (inclusive ? 1 : 2); at >= 0; at--) {
      const stack = stacks.get(keys[at]);
      if (stack) return stack;
    }
    return root;
  };
  const members = new Map<StackNode, { route: PageRoute | RouteNode; index: number }[]>();
  const add = (stack: StackNode, route: PageRoute | RouteNode, index: number) => {
    const list = members.get(stack) ?? [];
    list.push({ route, index });
    members.set(stack, list);
  };
  for (const page of pages.values()) {
    add(ownerOf(page.directory, true), {
      kind: "page", id: page.key, path: pathOf(page.directory), presentation: page.exports.presentation ?? "push",
      file: page.path, layouts: contentLayouts(page.directory),
    }, page.index);
  }
  for (const node of nodes.values()) {
    const layout = navigators.get(node.id);
    if (layout) add(ownerOf(layout.directory, false), node, layout.index);
  }
  for (const [stack, list] of members) {
    stack.routes = list.sort((a, b) => staticSegments(b.route.path) - staticSegments(a.route.path) || a.index - b.index).map(({ route }) => route);
    for (const route of stack.routes) {
      if (route.kind === "page") continue;
      const clash = stack.routes.find((other) => other !== route && other.path === route.path);
      if (clash) throw new Error(`${route.layoutFile}: ${route.path} is also the path of ${clash.kind === "page" ? clash.file : clash.layoutFile}; a navigator is a screen of its own`);
    }
  }
  return root;
}

// Resolution.

const patterns = new Map<string, { expression: RegExp; names: string[] }>();
const parameterName = (name: string) => name.replace(/^\.\.\./, "").split("=")[0];

function patternOf(path: string) {
  let known = patterns.get(path);
  if (known) return known;
  const names: string[] = [];
  const source = path.split("/").filter(Boolean).map((part) => {
    const optional = /^\[\[([^\]]+)\]\]$/.exec(part);
    const parameter = /^\[([^\]]+)\]$/.exec(part);
    if (optional || parameter) {
      const name = (optional ?? parameter)?.[1] ?? "";
      names.push(parameterName(name));
      return optional ? "(?:/([^/]+))?" : name.startsWith("...") ? "/(.*)" : "/([^/]+)";
    }
    return `/${part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`;
  }).join("");
  known = { expression: new RegExp(`^${source || "/"}/?$`), names };
  patterns.set(path, known);
  return known;
}

/** The parameters of `pathname` against a route path (`[id]`, `[[id]]`, `[...rest]`), or `null` when it does not match or has a bad escape. */
export function matchPath(path: string, pathname: string): Record<string, string> | null {
  const { expression, names } = patternOf(path);
  const match = expression.exec(pathname);
  if (!match) return null;
  try {
    return Object.fromEntries(names.flatMap((name, index) => match[index + 1] === undefined ? [] : [[name, decodeURIComponent(match[index + 1])]]));
  } catch (error) {
    if (error instanceof URIError) return null;
    throw error;
  }
}

/** The path of a route with its parameters in place: `/[slug]/inbox` with `{ slug: "acme" }` is `/acme/inbox`. */
export function fillPath(path: string, params: Readonly<Record<string, string>>): string {
  const parts = path.split("/").filter(Boolean).flatMap((part) => {
    const optional = /^\[\[([^\]]+)\]\]$/.exec(part);
    const parameter = /^\[([^\]]+)\]$/.exec(part);
    if (!optional && !parameter) return [part];
    const raw = (optional ?? parameter)?.[1] ?? "";
    const value = params[parameterName(raw)];
    if (value === undefined) return optional ? [] : [""];
    return [raw.startsWith("...") ? value.split("/").map(encodeURIComponent).join("/") : encodeURIComponent(value)];
  });
  return `/${parts.join("/")}`;
}

/** One navigator on the way to a page: for tabs, `select` is the pane the page is in. */
export type ChainStep = { node: RouteNode; select?: string };
/**
 * What an href names: a page, its parameters, and the navigators above it from the root down. `href` is the path, query and
 * hash the entry will carry; it is the page's own path when the href named a tabs screen (the first pane's index page).
 */
export type Resolution = { page: PageRoute; params: Record<string, string>; chain: ChainStep[]; href: string };

type Hit = { page: PageRoute; params: Record<string, string>; chain: ChainStep[]; canonical?: boolean };
const BASE = "https://native.invalid";

const baseOf = (stack: StackNode) => stack.routes.find((route): route is PageRoute => route.kind === "page" && route.path === stack.path);

function inStack(stack: StackNode, pathname: string): Hit | null {
  for (const route of stack.routes) {
    if (route.kind === "page") {
      const params = matchPath(route.path, pathname);
      if (params) return { page: route, params, chain: [{ node: stack }] };
    } else {
      const hit = inNode(route, pathname);
      if (hit) return { ...hit, chain: [{ node: stack }, ...hit.chain] };
    }
  }
  return null;
}

function inNode(node: RouteNode, pathname: string): Hit | null {
  if (node.kind === "stack") return inStack(node, pathname);
  for (const pane of node.panes) {
    const hit = inStack(pane.stack, pathname);
    if (hit) return { ...hit, chain: [{ node, select: pane.key }, ...hit.chain] };
  }
  // The tabs screen itself (its own path): its first pane's index page.
  const first = node.panes[0];
  const page = first && baseOf(first.stack);
  const params = page && matchPath(node.path, pathname);
  return first && page && params ? { page, params, chain: [{ node, select: first.key }, { node: first.stack }], canonical: true } : null;
}

/** The page `href` names and the chain of navigators above it, or `null` when no page matches. Query and hash do not take part in matching. */
export function resolve(tree: StackNode, href: string): Resolution | null {
  const url = new URL(href, BASE);
  const hit = inStack(tree, url.pathname);
  if (!hit) return null;
  const rest = `${url.search}${url.hash}`;
  return { page: hit.page, params: hit.params, chain: hit.chain, href: `${hit.canonical ? fillPath(hit.page.path, hit.params) : url.pathname}${rest}` };
}

/**
 * The route of `stack` an entry shows: the one with the `id` it was recorded with when that route is still there and still matches
 * the href (a page and a navigator of one stack can share a path: only the id says which it was), else the first route whose own
 * path matches, a page or the screen of a navigator.
 */
export function locate(stack: StackNode, href: string, id?: string): { route: PageRoute | RouteNode; params: Record<string, string> } | null {
  const { pathname } = new URL(href, BASE);
  const known = id === undefined ? undefined : stack.routes.find((route) => route.id === id);
  const knownParams = known && matchPath(known.path, pathname);
  if (known && knownParams) return { route: known, params: knownParams };
  for (const route of stack.routes) {
    const params = matchPath(route.path, pathname);
    if (params) return { route, params };
  }
  return null;
}

// Navigation plan.

export type Navigation = { replaceState?: boolean; reset?: boolean; presentation?: Presentation };
/** The navigation state `plan` reads: a stack's entry hrefs (bottom first) or a tabs node's selected pane, by node id. */
export type NodeState = { entries: readonly string[] } | { selected: string };
export type State = Readonly<Record<string, NodeState>>;
export type Operation =
  | { node: string; op: "select"; pane: string }
  | { node: string; op: "push" | "replace" | "reset"; href: string; presentation: Presentation }
  | { node: string; op: "popTo"; href: string };

const entriesOf = (state: State, id: string): readonly string[] | undefined => {
  const node = state[id];
  return node && "entries" in node ? node.entries : undefined;
};

/**
 * The operations that take the app to `target`, one per navigator on its chain that has something to do, root first. A navigator
 * pushed by the plan starts empty: what the state says about the ones below it belongs to another instance. With `reset` every
 * navigator on the chain has something to do: each stack above the owner resets to its screen of the chain (an instance that is
 * already there stays), each tabs node selects the pane, and the owner resets to the target (keeping its base page in a pane).
 */
export function plan(state: State, target: Resolution, navigation: Navigation): Operation[] {
  const operations: Operation[] = [];
  const { chain, params } = target;
  let fresh = false;
  chain.forEach((step, at) => {
    const { node } = step;
    if (node.kind === "tabs") {
      const selected = fresh ? undefined : state[node.id];
      const shown = (selected && "selected" in selected ? selected.selected : undefined) ?? node.panes[0]?.key;
      if (step.select !== undefined && (navigation.reset || step.select !== shown)) operations.push({ node: node.id, op: "select", pane: step.select });
      return;
    }
    // A pane's stack starts with its index page.
    const inPane = at > 0 && chain[at - 1].select !== undefined;
    const entries = (fresh ? undefined : entriesOf(state, node.id)) ?? (inPane ? [fillPath(node.path, params)] : []);
    if (at === chain.length - 1) {
      const presentation = navigation.presentation ?? target.page.presentation;
      // A goto to an href the owner already holds goes back to that entry instead of stacking a copy of it (Expo Router's `navigate`).
      if (!navigation.reset && !navigation.replaceState) {
        const held = entries.lastIndexOf(target.href);
        if (held >= 0) {
          if (held < entries.length - 1) operations.push({ node: node.id, op: "popTo", href: target.href });
          return;
        }
      }
      if (!navigation.reset && entries[entries.length - 1] === target.href) return;
      const op = navigation.reset ? "reset" : navigation.replaceState ? "replace" : "push";
      operations.push({ node: node.id, op, href: target.href, presentation });
      return;
    }
    const screen = fillPath(chain[at + 1].node.path, params);
    const index = entries.lastIndexOf(screen);
    if (navigation.reset) {
      // A reset is a new root for the whole chain: the stack keeps only this screen (the instance it has, when it has one).
      operations.push({ node: node.id, op: "reset", href: screen, presentation: "push" });
      if (index < 0) fresh = true;
      return;
    }
    if (index < 0) {
      operations.push({ node: node.id, op: "push", href: screen, presentation: "push" });
      fresh = true;
    } else if (index < entries.length - 1) {
      operations.push({ node: node.id, op: "popTo", href: screen });
    }
  });
  return operations;
}
