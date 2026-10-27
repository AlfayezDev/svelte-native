import { getContext, onDestroy, setContext } from "svelte";
import { SvelteMap, SvelteURL } from "svelte/reactivity";
import Platform from "react-native/Libraries/Utilities/Platform";
import BackHandler from "react-native/Libraries/Utilities/BackHandler";
import Linking from "react-native/Libraries/Linking/Linking";
import { hmrState, type StackSnapshot } from "./hmr-state.ts";
import { EXIT_REPORTED, EXIT_TIMEOUT_MS, type Presentation, type RouterScopeOptions } from "./fabric/navigation.ts";
import {
  fillPath, locate, matchPath, plan, resolve,
  type Navigation, type Operation, type PageRoute, type Resolution, type RouteModules, type RouteNode, type StackNode, type State, type TabsNode,
} from "./route-tree.ts";

export type { Pane, PageRoute, RouteModules, RouteNode, StackNode, TabsNode } from "./route-tree.ts";
export type NavigateOptions = Navigation;
export type NativeLocation = {
  key: number;
  /** The page this entry shows, or the navigator whose layout it shows. */
  route: PageRoute | RouteNode;
  url: URL;
  params: Record<string, string>;
  /** The screen's presentation: the one `goto` was given, else the page's, else `push`. Fixed for the life of the entry. */
  presentation: Presentation;
  /** The state of the navigator this entry is the screen of (navigator routes only); it lives and dies with the entry. */
  navigator?: NavigatorState;
};
/** One screen of a router's native stack: a live entry, or a popped one the stack is still taking away (`leaving`). */
export type RouterScreen = { entry: NativeLocation; canGoBack: boolean; leaving: boolean };

const contextKey = Symbol("svelte-native-router");
/** The router context: each router links to the one above it, so `useRouter(scope)` can walk up to a named ancestor. */
type RouterContext = { router: Router; scope: string | undefined; parent: RouterContext | undefined };
/** A navigator's router: one per stack or tabs node, created where its screens render (the root's by `createRouter`). */
export interface Router {
  readonly scope: string | undefined;
  /** The navigator this router drives. */
  readonly node: StackNode | TabsNode;
  /** Whether another router is above this one (a tab's or a nested navigator's own): only the outermost router answers the back key and links (`connectHost`). */
  readonly nested: boolean;
  /** Whether this router currently answers the back key and links: a tab's stack while its tab is selected, and nothing under a screen that covers it. */
  active(): boolean;
  /** The live stack, bottom first: what `back`, `goto` and `current` work on (for tabs, the selected pane's). */
  readonly entries: readonly NativeLocation[];
  /** The stack the native side holds: `entries` plus the popped ones still leaving, in place; what the router renders. */
  readonly screens: readonly RouterScreen[];
  /** The deepest shown entry: through the top screen's navigator, to the page the user sees. */
  readonly current: NativeLocation;
  /** The selected pane of a tabs router (`undefined` for a stack). */
  readonly selected: string | undefined;
  /** Selects a pane of a tabs router; `goto` does it as well when a route lies in another pane. */
  select(key: string): void;
  /** Starts loading a route's modules unless they are loaded or loading (a screen calls it when it renders). */
  load(route: PageRoute | RouteNode): void;
  /** The route's page and layouts once loaded, `undefined` while loading; throws what a failed load threw. */
  modules(route: PageRoute | RouteNode): RouteModules | undefined;
  /** Navigates anywhere in the tree: the plan selects tabs, pops covering screens and pushes where the route belongs. */
  goto(href: string, navigation?: NavigateOptions): void;
  /** Pops this navigator's top screen (a tabs router's: the selected pane's); at its base, the stack above gets to pop; `false` when nothing can (the app may leave). */
  back(): boolean;
  /** Replaces the first entry of this stack with a page of this navigator. */
  replaceBase(href: string): void;
  /** Opens a link (`https:` or the app's scheme) when a screen matches it. */
  openURL(href: string): boolean;
  /** The user dismissed the screen natively (after its transition): it and the ones above it are dropped at once. */
  dismissed(key: number): void;
  /** The native stack finished taking a popped screen away: its page unmounts now. */
  exited(key: number): void;
}
type Slot = { pending: true } | { modules: RouteModules } | { error: unknown };
type StackState = ReturnType<typeof createStack>;
type TabsState = { readonly kind: "tabs"; readonly selected: string; select(key: string): void; readonly panes: ReadonlyMap<string, StackState> };
type NavigatorState = { kind: "stack"; stack: StackState } | TabsState;
type Store = ReturnType<typeof createStore>;
/** What a router is bound to: the store of its tree, the state of its navigator, its place above, the screen that hosts a nested navigator, and the routers registered below it (oldest first). */
type Binding = { store: Store; stack?: StackState; tabs?: TabsState; above?: Router; entry?: NativeLocation; inner: Router[] };
const bindings = new WeakMap<Router, Binding>();

const BASE = "https://native.invalid";
const hrefOf = (entry: NativeLocation) => `${entry.url.pathname}${entry.url.search}${entry.url.hash}`;
function lastIndexOfHref(entries: readonly NativeLocation[], href: string): number {
  for (let index = entries.length - 1; index >= 0; index--) if (hrefOf(entries[index]) === href) return index;
  return -1;
}
/** The base entry of a pane's stack: its index page. */
const indexPage = (stack: StackNode) => stack.routes.find((route): route is PageRoute => route.kind === "page" && route.path === stack.path);

function release(entry: NativeLocation): void {
  const navigator = entry.navigator;
  if (navigator?.kind === "stack") navigator.stack.dispose();
  else if (navigator) for (const stack of navigator.panes.values()) stack.dispose();
}

/**
 * The native stack of one navigator. A popped entry stays in it, inactive, until the stack reports that its exit transition
 * ended (SPEC.md "Screen exit"), so the unmount of the page (the whole subtree) is not part of the transition's frames.
 * Platforms whose stack animates a removal itself (`EXIT_REPORTED` false) drop the entry at once. `screens` is what the router
 * renders: the entries and the ones on their way out, each at the place it had, so nothing moves in the native stack when one leaves.
 * A screen can go back when another is below it, or when `baseBack` says the first one can: a nested stack navigator's first
 * screen goes back by popping its own screen from the stack above (a pane's base does not).
 */
function createStack(reportsExit: boolean, initial: readonly NativeLocation[] = [], baseBack = false) {
  const canGoBackAt = (index: number) => index > 0 || baseBack;
  let entries = $state.raw<readonly NativeLocation[]>(initial);
  let screens = $state.raw<readonly RouterScreen[]>(initial.map((entry, index) => ({ entry, canGoBack: canGoBackAt(index), leaving: false })));
  let exitTimer: ReturnType<typeof setTimeout> | undefined;
  /** Makes `next` the screens, and frees the navigators of the entries that are gone. */
  function show(next: readonly RouterScreen[]) {
    const gone = screens.filter((screen) => !next.some((kept) => kept.entry === screen.entry));
    screens = next;
    for (const screen of gone) release(screen.entry);
  }
  const stack = {
    /** Whether the first screen of this stack can go back. */
    get baseBack() { return baseBack; },
    /** The live stack, bottom first: what `back`, `goto` and `current` work on. */
    get entries() { return entries; },
    get screens() { return screens; },
    /** Makes `next` the live stack. `retire` keeps what it removes on screen until it reports its exit; the user's own dismissal has happened natively already (no `retire`). */
    set(next: readonly NativeLocation[], retire = reportsExit): void {
      let retired = false;
      const list: RouterScreen[] = [];
      for (const screen of screens) {
        if (screen.leaving) list.push(screen);
        else if (next.includes(screen.entry)) {
          const canGoBack = canGoBackAt(next.indexOf(screen.entry));
          // A kept entry can move down the stack (a reset keeps one screen): the first screen of a nested stack navigator goes back through its own screen.
          if (screen.entry.navigator?.kind === "stack") screen.entry.navigator.stack.setBaseBack(canGoBack);
          list.push(canGoBack === screen.canGoBack ? screen : { ...screen, canGoBack });
        } else if (retire) { list.push({ ...screen, leaving: true }); retired = true; }
      }
      // A new entry goes right after the one below it in the stack, so a screen pushed while another leaves sits under it.
      next.forEach((entry, index) => {
        if (list.some((screen) => screen.entry === entry)) return;
        list.splice(index === 0 ? 0 : list.findIndex((screen) => screen.entry === next[index - 1]) + 1, 0, { entry, canGoBack: canGoBackAt(index), leaving: false });
      });
      entries = next;
      show(list);
      if (retired) {
        clearTimeout(exitTimer);
        exitTimer = setTimeout(() => {
          console.warn(`[Svelte router] ${screens.filter((screen) => screen.leaving).length} screen(s) did not report their exit within ${EXIT_TIMEOUT_MS} ms; removing them`);
          show(screens.filter((screen) => !screen.leaving));
        }, EXIT_TIMEOUT_MS);
      }
    },
    /** Whether the first screen of this stack can go back changed: its own screen moved in the stack above (see `set`). */
    setBaseBack(value: boolean): void {
      if (value === baseBack) return;
      baseBack = value;
      screens = screens.map((screen) => {
        const index = entries.indexOf(screen.entry);
        if (screen.leaving || index < 0) return screen;
        const canGoBack = canGoBackAt(index);
        if (screen.entry.navigator?.kind === "stack") screen.entry.navigator.stack.setBaseBack(canGoBack);
        return canGoBack === screen.canGoBack ? screen : { ...screen, canGoBack };
      });
    },
    /** The user dismissed the screen natively (after its transition): it and the ones above it are gone already, so they are dropped at once. */
    dismissed(key: number): void {
      const index = entries.findIndex((entry) => entry.key === key);
      if (index > 0) stack.set(entries.slice(0, index), false);
    },
    /** The native stack finished taking a popped screen away: its page unmounts now. */
    exited(key: number): void {
      if (!screens.some((screen) => screen.leaving && screen.entry.key === key)) return;
      show(screens.filter((screen) => screen.entry.key !== key));
      if (!screens.some((screen) => screen.leaving)) clearTimeout(exitTimer);
    },
    /** The stack's component is gone: its exit timer and those of the navigators it still holds stop. */
    dispose(): void {
      clearTimeout(exitTimer);
      for (const screen of screens) release(screen.entry);
    },
  };
  return stack;
}

/** The state of one tree: its root stack, the entries and navigators below it, and the loaded modules of its routes. */
function createStore(tree: StackNode) {
  let nextKey = 0;
  const reportsExit = EXIT_REPORTED[Platform.OS === "ios" ? "ios" : "android"];
  const root = createStack(reportsExit);
  let disposed = false;
  let launchRead = false;

  /** `canGoBack` is whether the entry's own screen will have one below it: a nested stack navigator's first screen takes it for its own. */
  function entryFor(route: PageRoute | RouteNode, href: string, params: Record<string, string>, presentation: Presentation, canGoBack: boolean): NativeLocation {
    const entry: NativeLocation = { key: ++nextKey, route, url: new SvelteURL(href, BASE), params, presentation };
    if (route.kind === "stack") entry.navigator = { kind: "stack", stack: createStack(reportsExit, [], canGoBack) };
    else if (route.kind === "tabs") entry.navigator = tabsFor(route, params);
    return entry;
  }
  /** A tabs navigator starts on its first pane, every pane's stack on the pane's index page. */
  function tabsFor(node: TabsNode, params: Record<string, string>): TabsState {
    let selected = $state.raw(node.panes[0]?.key ?? "");
    const panes = new Map(node.panes.map(({ key, stack }) => {
      const page = indexPage(stack);
      const href = fillPath(stack.path, params);
      return [key, createStack(reportsExit, page ? [entryFor(page, href, matchPath(page.path, href) ?? params, "push", false)] : [])];
    }));
    return { kind: "tabs", get selected() { return selected; }, select(key) { if (panes.has(key)) selected = key; }, panes };
  }

  // A route's modules load when the route is first needed: a navigation loads what it pushes right away, a screen
  // that renders loads its own (the first screen, a restored stack). A screen shows its `loading` snippet until they
  // arrive, and rethrows a failed load where it renders.
  const slots = new SvelteMap<object, Slot>();
  function load(route: PageRoute | RouteNode): void {
    const slot = slots.get(route);
    if (slot && !("error" in slot)) return;
    const loader = route.kind === "page" ? route.load : route.layout;
    if (!loader) throw new Error(`Route ${route.id} has no loader: a tree is linked to its code by the generated .svelte-native/routes.ts`);
    const pending = loader(); // a route whose load failed tries again on its next navigation
    slots.set(route, { pending: true });
    pending.then((modules) => slots.set(route, { modules }), (error: unknown) => slots.set(route, { error }));
  }
  function modules(route: PageRoute | RouteNode): RouteModules | undefined {
    const slot = slots.get(route);
    if (slot && "error" in slot) throw slot.error;
    return slot && "modules" in slot ? slot.modules : undefined;
  }

  /** The navigator state of every step of the target's chain that exists yet, root first; a navigator that is not on its stack has none, and nothing below it. */
  function instances(target: Resolution): (NavigatorState | undefined)[] {
    const found: (NavigatorState | undefined)[] = [{ kind: "stack", stack: root }];
    for (let at = 1; at < target.chain.length; at++) {
      const above = found[at - 1];
      const { node } = target.chain[at];
      if (!above) found.push(undefined);
      else if (above.kind === "tabs") {
        const stack = above.panes.get(target.chain[at - 1].select ?? "");
        found.push(stack && { kind: "stack", stack });
      } else {
        const entry = above.stack.entries[lastIndexOfHref(above.stack.entries, fillPath(node.path, target.params))];
        found.push(entry?.route === node ? entry.navigator : undefined);
      }
    }
    return found;
  }
  function stateOf(target: Resolution): State {
    const state: Record<string, State[string]> = {};
    instances(target).forEach((instance, at) => {
      if (instance) state[target.chain[at].node.id] = instance.kind === "stack" ? { entries: instance.stack.entries.map(hrefOf) } : { selected: instance.selected };
    });
    return state;
  }

  function apply(operations: readonly Operation[], target: Resolution, eager: boolean): void {
    for (const operation of operations) {
      const at = target.chain.findIndex((step) => step.node.id === operation.node);
      const instance = instances(target)[at];
      if (operation.op === "select") {
        if (instance?.kind === "tabs") instance.select(operation.pane);
        continue;
      }
      if (instance?.kind !== "stack") throw new Error(`Navigator ${operation.node} has no stack to ${operation.op} ${operation.href} on`);
      const { stack } = instance;
      if (operation.op === "popTo") {
        const index = lastIndexOfHref(stack.entries, operation.href);
        if (index >= 0) stack.set(stack.entries.slice(0, index + 1));
        continue;
      }
      const owner = at === target.chain.length - 1;
      const route = owner ? target.page : target.chain[at + 1].node;
      const params = owner ? target.params : matchPath(route.path, new URL(operation.href, BASE).pathname) ?? target.params;
      const base = target.chain[at - 1]?.select === undefined ? undefined : stack.entries[0];
      if (operation.op === "reset" && base && hrefOf(base) === operation.href) {
        stack.set([base]);
        continue;
      }
      // A reset above the owner keeps the instance of the screen it keeps (its navigator's panes and stacks stay mounted), and drops the rest.
      const present = owner || operation.op !== "reset" ? undefined : stack.entries[lastIndexOfHref(stack.entries, operation.href)];
      if (present?.route === route) {
        stack.set(base ? [base, present] : [present]);
        continue;
      }
      const kept = stack.entries;
      const index = operation.op === "push" ? kept.length : operation.op === "replace" ? kept.length - 1 : base ? 1 : 0;
      const next = entryFor(route, operation.href, params, operation.presentation, index > 0 || stack.baseBack);
      if (eager) load(route);
      stack.set(operation.op === "push" ? [...kept, next] : operation.op === "replace" ? [...kept.slice(0, -1), next] : base ? [base, next] : [next]);
    }
  }
  const unresolved = (href: string) => new Error(`No native screen for ${new URL(href, BASE).pathname}`);
  function resolved(href: string): Resolution {
    const target = resolve(tree, href);
    if (!target) throw unresolved(href);
    return target;
  }

  function snapshot(stack: StackState): StackSnapshot {
    return {
      entries: stack.entries.map((entry) => {
        const navigator = entry.navigator;
        const saved = { route: entry.route.id, href: hrefOf(entry), presentation: entry.presentation };
        if (navigator?.kind === "stack") return { ...saved, stack: snapshot(navigator.stack) };
        if (navigator) return { ...saved, tabs: { selected: navigator.selected, panes: Object.fromEntries([...navigator.panes].map(([key, pane]) => [key, snapshot(pane)])) } };
        return saved;
      }),
    };
  }
  function restoreEntries(node: StackNode, saved: StackSnapshot, baseBack = false): NativeLocation[] {
    return saved.entries.map((row, index) => {
      const hit = locate(node, row.href, row.route);
      if (!hit) throw unresolved(row.href);
      const canGoBack = index > 0 || baseBack;
      const entry = entryFor(hit.route, row.href, hit.params, row.presentation, canGoBack);
      const navigator = entry.navigator;
      if (navigator?.kind === "stack" && hit.route.kind === "stack" && row.stack) navigator.stack.set(restoreEntries(hit.route, row.stack, canGoBack), false);
      if (navigator?.kind === "tabs" && hit.route.kind === "tabs" && row.tabs) {
        for (const pane of hit.route.panes) {
          const savedPane = row.tabs.panes[pane.key];
          if (savedPane) navigator.panes.get(pane.key)?.set(restoreEntries(pane.stack, savedPane), false);
        }
        navigator.select(row.tabs.selected);
      }
      return entry;
    });
  }

  return {
    tree, root, load, modules, snapshot: () => snapshot(root), resolved,
    navigate(href: string, navigation: Navigation) {
      const target = resolved(href);
      apply(plan(stateOf(target), target, navigation), target, true);
      // A navigation passes through the navigators of its chain: the layout of each is loaded if it is not, and again if its load failed (a pane's layout is no route of any stack, so nothing else would).
      for (const { node } of target.chain) if (node.layout) load(node);
    },
    /** Puts the first screen on the root stack (it loads when it renders, not here), from a saved state when there is one. */
    start(initial: string, saved?: StackSnapshot) {
      if (saved?.entries.length) {
        try {
          root.set(restoreEntries(tree, saved), false);
          return;
        } catch { /* a route that no longer exists: start from the initial screen */ }
      }
      const target = resolved(initial);
      apply(plan({}, target, {}), target, false);
    },
    replaceBase(stack: StackState, node: StackNode, href: string) {
      const target = resolved(href);
      if (target.chain[target.chain.length - 1].node !== node) throw new Error(`${href} is not a page of this navigator`);
      const base = entryFor(target.page, target.href, target.params, target.page.presentation, stack.baseBack);
      load(target.page);
      stack.set([base, ...stack.entries.slice(1)]);
    },
    openURL(router: Router, href: string): boolean {
      const url = URL.parse(href);
      if (!url || url.hostname === "expo-development-client") return false;
      const path = url.protocol === "https:" || url.protocol === "http:"
        ? url.pathname : `${url.hostname ? `/${url.hostname}` : ""}${url.pathname}`;
      if (!resolve(tree, path)) return false;
      router.goto(`${path}${url.search}${url.hash}`);
      return true;
    },
    /** Opens the link the app was launched with, once for the life of the router: a remount of its `<Router>` (a session reset) does not open it again. */
    openLaunchURL(router: Router): void {
      if (launchRead) return;
      launchRead = true;
      void Linking.getInitialURL().then((url) => { if (url && !disposed && router.active()) router.openURL(url); });
    },
    dispose() { disposed = true; root.dispose(); },
  };
}

/** The deepest entry shown from `entry`: through a tabs navigator's selected pane, through a stack navigator's top. */
function deepest(entry: NativeLocation): NativeLocation {
  const navigator = entry.navigator;
  const next = !navigator ? undefined : navigator.kind === "stack" ? navigator.stack.entries.at(-1) : navigator.panes.get(navigator.selected)?.entries.at(-1);
  return next ? deepest(next) : entry;
}

type Spec = { store: Store; node: StackNode | TabsNode; scope: string | undefined; above: RouterContext | undefined; navigator: NavigatorState; active: () => boolean; entry?: NativeLocation };

function makeRouter({ store, node, scope, above, navigator, active, entry }: Spec): Router {
  const stack = navigator.kind === "stack" ? navigator.stack : undefined;
  const tabs = navigator.kind === "tabs" ? navigator : undefined;
  /** The stack this router shows: its own, or for tabs the selected pane's. */
  const shown = () => stack ?? tabs?.panes.get(tabs.selected);
  const router: Router = {
    scope,
    node,
    nested: above !== undefined,
    active,
    get entries() { return shown()?.entries ?? []; },
    get screens() { return shown()?.screens ?? []; },
    get current() {
      const top = router.entries.at(-1);
      if (!top) throw new Error(`Navigator ${node.id} has no screen yet`);
      return deepest(top);
    },
    get selected() { return tabs?.selected; },
    select(key) {
      if (!tabs) throw new Error(`Navigator ${node.id} is a stack: select works on tabs`);
      if (!tabs.panes.has(key)) throw new Error(`Navigator ${node.id} has no pane ${key}`);
      tabs.select(key);
    },
    load: store.load,
    modules: store.modules,
    goto(href, navigation = {}) { store.navigate(href, navigation); },
    back() {
      // This router's own stack first (a tabs router's is the selected pane's), then the stacks above it: a pane at its base hands the pop up, it does not pop its sibling.
      const stacks = [shown()];
      for (let above = bindings.get(router)?.above; above; above = bindings.get(above)?.above) stacks.push(bindings.get(above)?.stack);
      const top = stacks.find((candidate) => candidate && candidate.entries.length > 1);
      if (!top) return false;
      top.set(top.entries.slice(0, -1));
      return true;
    },
    replaceBase(href) {
      if (!stack || node.kind !== "stack") throw new Error(`Navigator ${node.id} has no base entry to replace`);
      store.replaceBase(stack, node, href);
    },
    openURL(href) { return store.openURL(router, href); },
    dismissed(key) { stack?.dismissed(key); },
    exited(key) { stack?.exited(key); },
  };
  bindings.set(router, { store, stack, tabs, above: above?.router, entry, inner: [] });
  setContext(contextKey, { router, scope, parent: above } satisfies RouterContext);
  // The router is known to the one above while its component lives: the back key finds the innermost active router through them.
  const hosting = above && bindings.get(above.router);
  if (hosting) {
    hosting.inner.push(router);
    onDestroy(() => {
      const at = hosting.inner.indexOf(router);
      if (at >= 0) hosting.inner.splice(at, 1);
    });
  }
  return router;
}

/** The innermost active router below `router` (itself when none is): the newest active one at each level, as the back key would ask them. */
function innermost(router: Router): Router {
  const inner = bindings.get(router)?.inner ?? [];
  for (let at = inner.length - 1; at >= 0; at--) if (inner[at].active()) return innermost(inner[at]);
  return router;
}

/**
 * Connects the app's root router to the host while its `<Router>` is mounted: the Android back key and links. Only the outermost
 * router does, and it is the only one that registers anything: the key goes to the innermost active router (through tabs and
 * nested stacks, hand-made named routers included), and its `back()` hands the pop outward when it has nothing to pop. The link the
 * app was launched with is read once per router, however often its `<Router>` mounts. Returns what disconnects.
 */
export function connectHost(router: Router): () => void {
  const binding = bindings.get(router);
  if (!binding || router.nested) return () => {};
  const back = BackHandler.addEventListener("hardwareBackPress", () => router.active() && innermost(router).back());
  const links = Linking.addEventListener("url", ({ url }) => { if (router.active()) router.openURL(url); });
  binding.store.openLaunchURL(router);
  return () => { back.remove(); links.remove(); };
}

/**
 * The router of a tree: its root navigator's, which opens links and answers the back key. It registers in the component context
 * under `options.scope` (`"root"` for the outermost router, unnamed for a nested one) so `useRouter(scope)` finds it from any
 * screen below. `options.active` says whether the router currently owns the back key and links; a tab pane built by hand
 * passes its selection (default: always). The navigators below the root get their routers where their screens render.
 */
export function createRouter(tree: StackNode, initial = "/auth/login", options: RouterScopeOptions = {}): Router {
  if (!tree || typeof tree !== "object" || tree.kind !== "stack" || !Array.isArray(tree.routes)) {
    throw new Error(`createRouter takes the route tree, a root stack node ({ kind: "stack", id, path, routes }) such as the \`tree\` .svelte-native/routes.ts exports, not ${Array.isArray(tree) ? "an array of routes (the form before the route tree)" : typeof tree}`);
  }
  const above = getContext<RouterContext | undefined>(contextKey);
  const scope = options.scope ?? (above ? undefined : "root");
  const store = createStore(tree);
  onDestroy(store.dispose);
  // A development remount hands the previous router's navigation state over, so an edit does not send the app back to its
  // first screen. The root router takes the state the remount recorded; the root adopting it also collects what the named
  // routers had, and each of them takes its own the first time it is created (a tab pane mounts on first selection).
  const hot = hmrState();
  hot.scopes ??= new SvelteMap();
  hot.scopeRestore ??= new SvelteMap();
  const { scopes, scopeRestore } = hot as Required<typeof hot>;
  let restored: StackSnapshot | undefined;
  if (scope === "root") {
    restored = hot.restore;
    hot.restore = undefined;
    if (restored) for (const [name, saved] of scopes) scopeRestore.set(name, saved());
  } else if (scope !== undefined) {
    restored = scopeRestore.get(scope);
    scopeRestore.delete(scope);
  }
  store.start(initial, restored);
  if (scope === "root") hot.navigation = store.snapshot;
  else if (scope !== undefined) scopes.set(scope, store.snapshot);
  return makeRouter({ store, node: tree, scope, above, navigator: { kind: "stack", stack: store.root }, active: options.active ?? (() => true) });
}

function routerAbove(): RouterContext {
  const above = getContext<RouterContext | undefined>(contextKey);
  if (!above) throw new Error("A navigator needs a router above it");
  return above;
}

/** The router of the nested stack or tabs navigator whose screen `entry` is; call it while the screen's content initializes (it registers for `useRouter` below). */
export function enterNavigator(entry: NativeLocation): Router {
  const above = routerAbove();
  const hosting = bindings.get(above.router);
  const { navigator, route } = entry;
  if (!hosting?.stack || !navigator || route.kind === "page") throw new Error(`${entry.url.pathname} is not the screen of a navigator`);
  const stack = hosting.stack;
  return makeRouter({ store: hosting.store, node: route, scope: route.id, above, navigator, entry, active: () => above.router.active() && stack.entries.at(-1) === entry });
}

/** The router of a pane of the tabs navigator above: a stack of its own, active while its tab is selected. `host` is the screen of the tabs navigator, whose params and url the pane's layout is given. */
export function enterPane(key: string): { router: Router; host: NativeLocation } {
  const above = routerAbove();
  const hosting = bindings.get(above.router);
  const stack = hosting?.tabs?.panes.get(key);
  const pane = above.router.node.kind === "tabs" ? above.router.node.panes.find((candidate) => candidate.key === key) : undefined;
  const tabs = hosting?.tabs;
  if (!hosting || !tabs || !stack || !pane || !hosting.entry) throw new Error(`No pane ${key} in the navigator above`);
  const router = makeRouter({ store: hosting.store, node: pane.stack, scope: key, above, navigator: { kind: "stack", stack }, active: () => above.router.active() && tabs.selected === key });
  return { router, host: hosting.entry };
}

/** The nearest router above this component, if any: what `Tabs` asks to tell a tabs layout from a tab bar of a page. */
export function nearestRouter(): Router | undefined {
  return getContext<RouterContext | undefined>(contextKey)?.router;
}

/** The nearest router, or with `scope` the nearest one above that was created with that name (`"root"` is the outermost). */
export function useRouter(scope?: string): Router {
  let entry = getContext<RouterContext | undefined>(contextKey);
  if (!entry) throw new Error("Native router is missing above this screen");
  if (scope === undefined) return entry.router;
  while (entry && entry.scope !== scope) entry = entry.parent;
  if (!entry) throw new Error(`No native router named "${scope}" above this screen`);
  return entry.router;
}
