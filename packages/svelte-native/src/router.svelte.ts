/// <reference path="./fabric/react-native-internals.d.ts" />
/// <reference path="./kit/modules.d.ts" />
import { flushSync, fork, getContext, onDestroy, setContext, untrack } from "svelte";
import { SvelteMap, SvelteURL } from "svelte/reactivity";
import Platform from "react-native/Libraries/Utilities/Platform";
import BackHandler from "react-native/Libraries/Utilities/BackHandler";
import Linking from "react-native/Libraries/Linking/Linking";
import { hmrState, type NavigationState, type StackSnapshot } from "./hmr-state.ts";
import { linkRouter } from "./remote/router-link.ts";
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

/**
 * A navigation that is being got ready (`Router.prepare`). `commit()` does the navigation `goto(href, navigation)` does: when the screen was rendered in time and nothing has changed in the
 * stacks since, that screen comes on screen at once (its effects run then, once); otherwise (the call came before `ready`, another navigation or the exit of a screen happened in between,
 * a newer `prepare` took the screen, Svelte's async mode is off) the prepared screen is dropped and `commit()` is a plain `goto` from the stacks as they are then.
 *
 * `discard()` gives the navigation up: the screen that was rendered is released and `commit()` does nothing any more. It takes effect a task later, and a `commit()` made before then wins:
 * `Pressable` reports a press that lasted 130 ms or more as `onPressOut` and then `onPress` in one task, and `onPressOut` is where the navigation is discarded. After `commit()` or
 * `discard()` has taken effect, further calls do nothing. Disposing the router also makes all its handles inert, including superseded ones.
 *
 * Only forward navigations are prepared: the ones whose operations are pushes and tab selections. One that pops, replaces or resets removes screens, which a fork cannot
 * do for the native stack (the exit timer would be armed for a navigation that may never happen), so `ready` is `false` and `commit()` is a plain `goto`.
 * This is not an interactive or predictive-back API: native back progress and cancellation are not driven by a Svelte fork.
 *
 * `prepare` reads the stacks untracked and renders the screen in a timer task, so it may be called from an event handler, a timer or an effect. The rendering happens on the JavaScript thread, so
 * it can delay the next touch event by as long as the screen takes to render: prepare when the thread is otherwise idle. A prepared navigation that is neither committed nor discarded keeps
 * its screen in memory.
 */
export interface PreparedNavigation {
  /** Settles when the screen is rendered off screen (`true`), or when nothing will be: the navigation cannot be prepared, was committed or discarded first, a newer `prepare` took it, or its modules failed to load (`false`). Never rejects, and settles when the navigation is discarded even if a module never loads. */
  readonly ready: Promise<boolean>;
  /** Does the navigation. */
  commit(): void;
  /** Gives it up, a task later unless `commit()` comes first: the screen that was rendered is released, and nothing changed on screen. */
  discard(): void;
}

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
  /** `load`, and settles when the modules are loaded; rejects with what a failed load threw (`preloadCode` of `$app/navigation`). */
  preload(route: PageRoute | RouteNode): Promise<void>;
  /** The route's page and layouts once loaded, `undefined` while loading; throws what a failed load threw. */
  modules(route: PageRoute | RouteNode): RouteModules | undefined;
  /** Whether a load of the route's modules is in flight (started and neither loaded nor failed yet). */
  loading(route: PageRoute | RouteNode): boolean;
  /** Navigates anywhere in the tree: the plan selects tabs, pops covering screens and pushes where the route belongs. */
  goto(href: string, navigation?: NavigateOptions): void;
  /**
   * Gets `goto(href, navigation)` ready without doing it: the screen's modules load, and the screen is rendered off screen (Svelte's `fork`, so its effects wait and
   * nothing reaches the native stack) while the finger is still down. `commit()` then does the navigation, and puts the screen that is ready on screen; `discard()`
   * drops it. See `PreparedNavigation` for what is prepared and what is not.
   */
  prepare(href: string, navigation?: NavigateOptions): PreparedNavigation;
  /** Pops this navigator's top screen (a tabs router's: the selected pane's); at its base, the stack above gets to pop; `false` when nothing can (the app may leave). */
  back(): boolean;
  /** Replaces the first entry of this stack with a page of this navigator. */
  replaceBase(href: string): void;
  /** Opens a link (`https:` or the app's scheme) when a screen matches it; `navigation` is `goto`'s (the launch link is opened with `reset`). */
  openURL(href: string, navigation?: NavigateOptions): boolean;
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
 * Counts the changes to any stack or tab selection of the app. A read of the launch link that comes after the app went on without it compares the
 * count with the one from when it gave up: the link is opened only if nothing has navigated since, in the root stack or in any pane below it.
 */
let navigations = 0;
/**
 * Counts every write to the screens of any stack: a navigation, but also the exit of a popped screen (`exited`), `dropLeaving` and the exit timeout, which are no navigation and
 * do not count in `navigations`. A prepared navigation compares it: Svelte applies a fork's value over a write that was made while the fork was pending, so a screen that left in
 * between would come back with the fork's stack, and the screen the fork pushed would not show.
 */
let stackWrites = 0;

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
    stackWrites++;
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
      navigations++;
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
      stackWrites++;
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
    /** The stack is not on screen (its `<Router>` unmounted): the screens still leaving have no native stack to report their exit, so they go at once. */
    dropLeaving(): void {
      if (!screens.some((screen) => screen.leaving)) return;
      show(screens.filter((screen) => !screen.leaving));
      clearTimeout(exitTimer);
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
  /** The read of the launch link, once for the life of the router (`readLaunch`). */
  let launchURL: Promise<string | null> | undefined;
  /** The launch link is dealt with: it was opened, it was the one a restored state had opened already, or the app went on without it. It is never opened again. */
  let launchDone = false;
  /** The navigation count when the first read of the launch link failed: a later read that succeeds is the launch's only while nothing has navigated since. */
  let readFailedAt: number | undefined;
  /** An answer that came after the wait and that `accept` refused for the moment, with the navigation count it came at: the next call to `openLaunchURL` takes it up as if it had come in time. */
  let lateLink: { url: string; at: number } | undefined;
  /**
   * Whether the root `<Router>` is mounted. A screen that leaves stays on screen until the native stack reports its exit, which a screen that is
   * not on a native stack cannot: a navigation before the first mount (the launch link, opened ahead by `openLaunchURL`) or while the
   * `<Router>` is unmounted (a shell that waits for its session) drops the screens it replaces at once.
   */
  let shown = false;
  /** The launch link this router (or the one whose state it adopted) has acted on; reactive so that the state saved for a restart follows it. */
  let launched = $state.raw<string | undefined>(undefined);

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
    return { kind: "tabs", get selected() { return selected; }, select(key) { if (panes.has(key)) { selected = key; navigations++; } }, panes };
  }

  // A route's modules load when the route is first needed: a navigation loads what it pushes right away, a screen
  // that renders loads its own (the first screen, a restored stack). A screen shows its `loading` snippet until they
  // arrive, and rethrows a failed load where it renders.
  const slots = new SvelteMap<object, Slot>();
  /** The load of each route that has one, settled (never rejected) when its slot has modules or an error: what `prepare` waits for. */
  const loads = new WeakMap<object, Promise<void>>();
  function load(route: PageRoute | RouteNode): void {
    const slot = slots.get(route);
    if (slot && !("error" in slot)) return;
    const loader = route.kind === "page" ? route.load : route.layout;
    if (!loader) throw new Error(`Route ${route.id} has no loader: a tree is linked to its code by the generated .svelte-native/routes.<variant>.ts`);
    const pending = loader(); // a route whose load failed tries again on its next navigation
    slots.set(route, { pending: true });
    loads.set(route, pending.then((modules) => { slots.set(route, { modules }); }, (error: unknown) => { slots.set(route, { error }); }));
  }
  /** `load`, then waits for it: settles when the route's modules are loaded, rejects with what a failed load threw. */
  async function preload(route: PageRoute | RouteNode): Promise<void> {
    load(route);
    await loads.get(route);
    modules(route);
  }
  function loading(route: PageRoute | RouteNode): boolean {
    const slot = slots.get(route);
    return slot !== undefined && "pending" in slot;
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
    const retire = shown ? undefined : false;
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
        if (index >= 0) stack.set(stack.entries.slice(0, index + 1), retire);
        continue;
      }
      const owner = at === target.chain.length - 1;
      const route = owner ? target.page : target.chain[at + 1].node;
      const params = owner ? target.params : matchPath(route.path, new URL(operation.href, BASE).pathname) ?? target.params;
      const base = target.chain[at - 1]?.select === undefined ? undefined : stack.entries[0];
      if (operation.op === "reset" && base && hrefOf(base) === operation.href) {
        stack.set([base], retire);
        continue;
      }
      // A reset above the owner keeps the instance of the screen it keeps (its navigator's panes and stacks stay mounted), and drops the rest.
      const present = owner || operation.op !== "reset" ? undefined : stack.entries[lastIndexOfHref(stack.entries, operation.href)];
      if (present?.route === route) {
        stack.set(base ? [base, present] : [present], retire);
        continue;
      }
      const kept = stack.entries;
      const index = operation.op === "push" ? kept.length : operation.op === "replace" ? kept.length - 1 : base ? 1 : 0;
      const next = entryFor(route, operation.href, params, operation.presentation, index > 0 || stack.baseBack);
      if (eager) load(route);
      stack.set(operation.op === "push" ? [...kept, next] : operation.op === "replace" ? [...kept.slice(0, -1), next] : base ? [base, next] : [next], retire);
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

  function openLaunch(router: Router, url: string): void {
    launchDone = true;
    if (disposed || !router.active() || url === launched) return;
    launched = url;
    router.openURL(url, { reset: true });
  }
  /**
   * The launch link is not opened: a read that failed was asked again after the app went on, or an answer came after it navigated. It is still
   * the link the app was launched with, so it is recorded as the one acted on: the state saved for a restart carries it, and the intent Android
   * delivers again after the process died (or a hot remount replays) is not taken for a new launch over the screens it restores.
   */
  function dropLaunch(url: string): void {
    launchDone = true;
    lateLink = undefined;
    launched ??= url;
  }
  /** Whether a link read now is the launch's only by name: the first read failed, and the app has navigated since. */
  const staleRead = () => readFailedAt !== undefined && navigations !== readFailedAt;
  /**
   * The link the app was launched with, read once: the platform gets `LAUNCH_URL_TIMEOUT_MS` to answer, and after that the app goes on as if
   * there were no link (`null`), so a start that waits for it cannot wait for ever. An answer that comes later is still the launch's, and is
   * opened (if `accept`, the first caller's, allows it; else it waits for the next call) when nothing has navigated since the wait ended and the
   * read was not a stale retry, and then only once. A read that fails, even by throwing at once, rejects and is asked again by the next call
   * (`openLaunchURL` checks that the app has not gone on meanwhile).
   */
  function readLaunch(router: Router, accept: ((url: string) => boolean) | undefined): Promise<string | null> {
    if (launchURL) return launchURL;
    let failedAt: number | undefined;
    const read = new Promise<string | null>((resolve, reject) => {
      let waiting = true;
      let gaveUpAt = -1;
      const timer = setTimeout(() => { waiting = false; gaveUpAt = navigations; resolve(null); }, LAUNCH_URL_TIMEOUT_MS);
      const failed = (error: unknown) => {
        clearTimeout(timer);
        if (!waiting) return;
        waiting = false;
        failedAt = navigations;
        reject(error);
      };
      let answer: Promise<string | null>;
      try { answer = Linking.getInitialURL(); } catch (error) { failed(error); return; }
      answer.then((url) => {
        clearTimeout(timer);
        if (waiting) { waiting = false; resolve(url); return; }
        if (!url || launchDone) return;
        if (navigations !== gaveUpAt || staleRead()) dropLaunch(url);
        else if (accept && !accept(url)) lateLink = { url, at: gaveUpAt };
        else openLaunch(router, url);
      }, failed);
    });
    // After the assignment below, so that a read that failed before it (a throw at once) is forgotten too.
    read.catch(() => {
      if (launchURL === read) launchURL = undefined;
      if (failedAt !== undefined) readFailedAt ??= failedAt;
    });
    launchURL = read;
    return read;
  }

  /**
   * The screen the user sees when `target` is that same screen with another search or hash (the same page at the same path, so the same parameters), unless the navigation is a `reset`
   * or explicitly chooses a presentation: those go through the normal navigation plan. Otherwise going there does not add a screen: `navigate` changes that screen's `url` in place. A new screen for `?tab=2` would be a remount of the very page the user is on.
   */
  function inPlace(target: Resolution, navigation: Navigation): NativeLocation | undefined {
    if (navigation.reset || navigation.presentation !== undefined) return undefined;
    const top = root.entries.at(-1);
    const shown = top && deepest(top);
    return shown && shown.route === target.page && shown.url.pathname === new URL(target.href, BASE).pathname ? shown : undefined;
  }

  /** Untracked, like `prepare`: an effect that navigates (`$effect(() => { if (!signedIn) goto("/sign-in") })`) must not depend on the stacks the navigation reads and writes. */
  function navigate(href: string, navigation: Navigation): void {
    untrack(() => {
      const target = resolved(href);
      const shown = inPlace(target, navigation);
      if (shown) {
        const { search, hash } = new URL(target.href, BASE);
        if (shown.url.search !== search) shown.url.search = search;
        if (shown.url.hash !== hash) shown.url.hash = hash;
        navigations++;
        return;
      }
      apply(plan(stateOf(target), target, navigation), target, true);
      // A navigation passes through the navigators of its chain: the layout of each is loaded if it is not, and again if its load failed (a pane's layout is no route of any stack, so nothing else would).
      for (const { node } of target.chain) if (node.layout) load(node);
    });
  }

  /** The navigation of this tree that is being prepared, if any. A newer `prepare` takes its screen (two forks on the one stack would each hold a stack the other has not seen); the router's disposal drops it. */
  let preparing: { supersede(): void; drop(): void } | undefined;
  let warnedAsync = false;
  /** The base page of the pane a tabs navigator on the way shows: a pane mounts its stack on its first selection, and a fork that renders it needs the page's modules too. */
  const paneBases = (target: Resolution): PageRoute[] => target.chain.flatMap(({ node, select }) => {
    if (node.kind !== "tabs") return [];
    const pane = node.panes.find((candidate) => candidate.key === select) ?? node.panes[0];
    const page = pane && indexPage(pane.stack);
    return page ? [page] : [];
  });
  function prepare(href: string, navigation: Navigation = {}): PreparedNavigation {
    if (disposed) return { ready: Promise.resolve(false), commit() {}, discard() {} };
    const target = resolved(href);
    preparing?.supersede();
    // Untracked: an effect that calls `prepare` must not depend on the stacks it reads.
    const { forward, routes } = untrack(() => {
      const operations = plan(stateOf(target), target, navigation);
      const forward = !inPlace(target, navigation) && operations.length > 0 && operations.every((operation) => operation.op === "push" || operation.op === "select");
      // What `navigate` loads, and what the screens it makes render, loaded now: a fork renders the screens at once, and a module that arrives after it would render its page later, outside the fork,
      // with its effects running at once (or, for a pane base, never: the pane stays on its loading placeholder).
      const routes: (PageRoute | RouteNode)[] = [target.page, ...paneBases(target), ...target.chain.map(({ node }) => node).filter((node) => node.layout)];
      if (forward) for (const route of routes) load(route);
      return { forward, routes };
    });
    const base = navigations;
    let settled = false;
    let superseded = false;
    let forked: ReturnType<typeof fork> | undefined;
    let writesAtFork = 0;
    let pendingDiscard: ReturnType<typeof setTimeout> | undefined;
    let resolveReady: (prepared: boolean) => void = () => {};
    const ready = new Promise<boolean>((done) => { resolveReady = done; });
    const handle = {
      supersede(): void {
        superseded = true;
        forked?.discard();
        forked = undefined;
        resolveReady(false);
      },
      drop(): void {
        clearTimeout(pendingDiscard);
        settle();
        forked?.discard();
        forked = undefined;
      },
    };
    preparing = handle;
    /** Committed or discarded: nothing more happens to this handle. `ready` settles `false` if it had not settled (a call that settles it twice does nothing). */
    function settle(): void {
      settled = true;
      if (preparing === handle) preparing = undefined;
      resolveReady(false);
    }
    function discard(): void {
      if (settled || pendingDiscard !== undefined) return;
      // A task later, and `commit()` cancels it: a press of 130 ms or more is `onPressOut` (the discard) and then `onPress` (the commit) in the same task.
      pendingDiscard = setTimeout(() => {
        pendingDiscard = undefined;
        if (settled) return;
        settle();
        forked?.discard();
        forked = undefined;
      }, 0);
    }
    function commit(): void {
      if (settled) return;
      // Superseded handles are no longer `preparing`, but must not outlive their store.
      if (disposed) { handle.drop(); return; }
      clearTimeout(pendingDiscard);
      pendingDiscard = undefined;
      settle();
      if (forked && navigations === base && stackWrites === writesAtFork) {
        // The counts were put back after the fork (a discarded one is no navigation), and are counted now.
        navigations++;
        stackWrites++;
        forked.commit().catch((error: unknown) => { console.error("[Svelte router] a prepared navigation failed to commit", error); });
      } else {
        // Not ready, or something changed since: the navigation is made from the stacks as they are now.
        forked?.discard();
        navigate(href, navigation);
      }
      forked = undefined;
    }
    void (async () => {
      if (!forward) return resolveReady(false);
      await Promise.all(routes.map((route) => loads.get(route)));
      // A task later: what the touch itself changed (a pressed state) reaches the screen before the JavaScript thread renders a screen.
      await new Promise<void>((done) => setTimeout(done, 0));
      if (disposed || settled || superseded || navigations !== base || !routes.every((route) => { const slot = slots.get(route); return slot !== undefined && "modules" in slot; })) return resolveReady(false);
      try {
        flushSync(); // a fork needs no change pending
        const before = navigations;
        const writes = stackWrites;
        try { forked = fork(() => navigate(href, navigation)); } finally { navigations = before; stackWrites = writes; }
        writesAtFork = writes;
        resolveReady(true);
      } catch (error) {
        if (!(error instanceof Error && error.message.includes("experimental_async_required"))) console.error("[Svelte router] a navigation could not be prepared", error);
        else if (!warnedAsync) {
          warnedAsync = true;
          console.warn("[Svelte router] prepare() needs Svelte's async mode, which the app has not turned on (withSvelteNative(config, { async: true }), see REFERENCE.md, Router: prepare); navigations are made when committed, as goto does");
        }
        resolveReady(false);
      }
    })();
    return { ready, commit, discard };
  }

  return {
    tree, root, load, preload, modules, loading, snapshot: () => snapshot(root), state: (): NavigationState => ({ stack: snapshot(root), launch: launched }), resolved,
    navigate,
    prepare,
    /**
     * Puts the first screen on the root stack (it loads when it renders, not here), from a saved state when there is one. Returns why the saved state was
     * refused (the app starts from `initial` then), or undefined when there was none or it was used.
     */
    start(initial: string, saved?: NavigationState): string | undefined {
      let rejected: string | undefined;
      if (saved && !saved.stack.entries.length) rejected = "the saved state has no screens";
      else if (saved) {
        try {
          root.set(restoreEntries(tree, saved.stack), false);
          launched = saved.launch;
          return undefined;
        } catch (error) { rejected = `the saved state names a route that no longer exists (${error instanceof Error ? error.message : String(error)})`; }
      }
      const target = resolved(initial);
      apply(plan({}, target, {}), target, false);
      return rejected;
    },
    replaceBase(stack: StackState, node: StackNode, href: string) {
      const target = resolved(href);
      if (target.chain[target.chain.length - 1].node !== node) throw new Error(`${href} is not a page of this navigator`);
      const base = entryFor(target.page, target.href, target.params, target.page.presentation, stack.baseBack);
      load(target.page);
      stack.set([base, ...stack.entries.slice(1)]);
    },
    openURL(router: Router, href: string, navigation: Navigation = {}): boolean {
      const url = URL.parse(href);
      if (!url || url.hostname === "expo-development-client") return false;
      const path = url.protocol === "https:" || url.protocol === "http:"
        ? url.pathname : `${url.hostname ? `/${url.hostname}` : ""}${url.pathname}`;
      if (!resolve(tree, path)) return false;
      router.goto(`${path}${url.search}${url.hash}`, navigation);
      return true;
    },
    /**
     * Opens the link the app was launched with, once for the life of the router: a remount of its `<Router>` (a session reset) does not open it again.
     * A direct load has no history, so it is a `reset` (like SvelteKit's first page): the link's screen is the base of the stack and has no back arrow.
     * Later links are plain `goto`s. A router that adopted a saved state also adopted the link that state was opened with: an Activity that is recreated
     * or restored after its process died reports the intent it was started with again, and that is no new launch (a different link is, and wins).
     * Resolves with the link once it has been opened (`null` when there is none, or the platform has not answered yet). `accept` can refuse the
     * link for now (the lab shell opens only a lab link ahead of its `<Router>`): it is then left for the next call, which is the `<Router>`'s.
     */
    async openLaunchURL(router: Router, accept?: (url: string) => boolean): Promise<string | null> {
      let url = await readLaunch(router, accept);
      if (!url && lateLink && !launchDone) {
        const late = lateLink;
        lateLink = undefined;
        if (late.at === navigations) url = late.url; else dropLaunch(late.url);
      }
      if (!url || launchDone) return url;
      // A read that failed and was asked again after the app went on (a sign-out remounts the <Router>) would open a link that is long stale.
      if (staleRead()) { dropLaunch(url); return url; }
      if (accept && !accept(url)) return url;
      openLaunch(router, url);
      return url;
    },
    /** The root `<Router>` mounted or unmounted: while it is mounted a screen that a navigation replaces leaves through the native stack. */
    markShown(value: boolean) {
      shown = value;
      // Not here, after the teardown that calls this. Svelte runs an effect's teardown with `is_destroying_effect` set (`execute_effect_teardown`,
      // internal/client/reactivity/effects.js), and `get()` then answers a source written in the current flush with its value from before the write
      // (internal/client/runtime.js, sources.js, batch.js): a navigation that unmounted this <Router> would read the stack as it was before that navigation,
      // and the drop would put the old screens back. A microtask reads the stack as the flush left it.
      if (!value) queueMicrotask(() => { if (!shown) root.dropLeaving(); });
    },
    dispose() { disposed = true; preparing?.drop(); root.dispose(); },
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
    preload: store.preload,
    modules: store.modules,
    loading: store.loading,
    goto(href, navigation = {}) { store.navigate(href, navigation); },
    prepare(href, navigation = {}) { return store.prepare(href, navigation); },
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
    openURL(href, navigation) { return store.openURL(router, href, navigation); },
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
  binding.store.markShown(true);
  binding.store.openLaunchURL(router).catch((error: unknown) => { console.error("[Svelte router] the launch link could not be read", error); });
  // Remote functions follow a server `redirect()` through this router and send its current URL as the page's (`remote/link.ts`).
  const linked = linkRouter(router);
  return () => { back.remove(); links.remove(); linked(); binding.store.markShown(false); };
}

/** How long the platform gets to answer for the launch link before the app starts as if it had none (an answer that comes later is still opened, see `readLaunch`). */
export const LAUNCH_URL_TIMEOUT_MS = 3000;

/**
 * Opens the link the app was launched with into the root router now, instead of when its `<Router>` mounts, and resolves with the link once it
 * has (`null` when there was none, when the platform has not answered within three seconds, or for a router that is not the root). The `<Router>`
 * that mounts afterwards starts on the link's screen and does not open it again: a shell that decides what to show by the launch link can wait
 * for this before it renders the navigator, so the router's first screen (the `initial` of `createRouter`, which the link replaces) is never
 * rendered. The platform is asked once, whoever asks. `accept` refuses a link for now (it stays for the `<Router>`'s own call); a read that
 * failed rejects and is asked again by the next call.
 */
export function openLaunchURL(router: Router, accept?: (url: string) => boolean): Promise<string | null> {
  const binding = bindings.get(router);
  return !binding || router.nested ? Promise.resolve(null) : binding.store.openLaunchURL(router, accept);
}

/** The app's root router while the component that created it lives. Reactive: what `page` (`$app/state`) follows, and `goto` (`$app/navigation`) drives, from any code. */
let appRoot = $state.raw<Router | undefined>(undefined);
/** The root routers whose components are alive, oldest first: `appRoot` is the last. Plain, not state: a teardown that reads a source written in the same batch gets its value from before the write. */
const liveRoots: Router[] = [];
/** The app's root router (the newest one `createRouter` made with the scope `"root"` whose component is alive), or `undefined` before the app creates it and after it is gone. A read inside an effect or a template follows it. */
export const rootRouter = (): Router | undefined => appRoot;

/**
 * The router of a tree: its root navigator's, which opens links and answers the back key. It registers in the component context
 * under `options.scope` (`"root"` for the outermost router, unnamed for a nested one) so `useRouter(scope)` finds it from any
 * screen below. `options.active` says whether the router currently owns the back key and links; a tab pane built by hand
 * passes its selection (default: always). The navigators below the root get their routers where their screens render.
 */
export function createRouter(tree: StackNode, initial = "/", options: RouterScopeOptions = {}): Router {
  if (!tree || typeof tree !== "object" || tree.kind !== "stack" || !Array.isArray(tree.routes)) {
    throw new Error(`createRouter takes the route tree, a root stack node ({ kind: "stack", id, path, routes }) such as the \`tree\` .svelte-native/routes.<variant>.ts exports, not ${Array.isArray(tree) ? "an array of routes (the form before the route tree)" : typeof tree}`);
  }
  const above = getContext<RouterContext | undefined>(contextKey);
  const scope = options.scope ?? (above ? undefined : "root");
  const store = createStore(tree);
  onDestroy(store.dispose);
  // A surface that stops and another that starts (a development remount, a recreated Android Activity) hand the previous
  // router's navigation state over, so neither sends the app back to its first screen. The root router takes the state the
  // stop recorded, else the one the host started the surface with (the process died: `options.restore`); the root adopting
  // the first also collects what the named routers had, and each of them takes its own the first time it is created (a tab
  // pane mounts on first selection).
  const hot = hmrState();
  hot.scopes ??= new SvelteMap();
  hot.scopeRestore ??= new SvelteMap();
  const { scopes, scopeRestore } = hot as Required<typeof hot>;
  let restored: NavigationState | undefined;
  const superseded = scope === "root" && hot.restore !== undefined;
  if (scope === "root") {
    restored = hot.restore ?? options.restore;
    if (hot.restore) for (const [name, saved] of scopes) scopeRestore.set(name, saved());
    hot.restore = undefined;
  } else if (scope !== undefined) {
    const named = scopeRestore.get(scope);
    restored = named && { stack: named };
    scopeRestore.delete(scope);
  }
  const rejected = store.start(initial, restored);
  // The state the host started the surface with: used, refused (a route that is gone), or never looked at because a stopped surface left a fresher one. `launchSurface` tells the host once the surface has started.
  if (scope === "root" && options.restore !== undefined) hot.adoption = superseded ? { rejected: "a stopped surface left a fresher state" } : rejected === undefined ? { restored: true } : { rejected };
  if (scope === "root") {
    hot.navigation = store.state;
    // Every change of the stacks writes the state for the host to keep (a settled navigation: effects run once per batch of changes, after the flush that made them).
    let written = "";
    $effect(() => {
      const json = JSON.stringify(store.state());
      if (json === written) return;
      written = json;
      hot.save?.(json);
    });
  } else if (scope !== undefined) scopes.set(scope, store.snapshot);
  const router = makeRouter({ store, node: tree, scope, above, navigator: { kind: "stack", stack: store.root }, active: options.active ?? (() => true) });
  if (scope === "root") {
    liveRoots.push(router);
    appRoot = router;
    // The newest router that is still alive is the app's: a surface that starts before another one stops (a remount of the app shell) keeps the registration, and the one that stops last leaves none.
    onDestroy(() => {
      const at = liveRoots.indexOf(router);
      if (at >= 0) liveRoots.splice(at, 1);
      appRoot = liveRoots.at(-1);
    });
  }
  return router;
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

/** A link to another site or app: a scheme (`https:`, `mailto:`, `tel:`, the app's own) or a protocol-relative `//host`. */
const EXTERNAL_LINK = /^(?:[a-z][a-z\d+.-]*:|\/\/)/i;

/**
 * What a press of an `<a href>` calls (the lowering of HTML elements writes a `useLink()` call into the instance script, `lower-html.ts`): a path of the app goes to
 * the nearest router's `goto`, as SvelteKit's router follows a link, and any other link (`https:`, `mailto:`, `tel:`, the app's own scheme) is opened by the platform
 * (`Linking.openURL`). Call it while the component initializes, as `useRouter`; unlike `useRouter` it does not throw without a router above, because a link to another site needs none
 * (a press of an app link without one does). A link that is only a hash (`#top`), or none, does nothing: there is no page to scroll.
 */
export function useLink(): (href?: string) => void {
  const router = nearestRouter();
  return (href) => {
    // No `href` (an `<a>` without one, or `href={undefined}`) is no link: a press does nothing.
    if (typeof href !== "string" || href === "" || href.startsWith("#")) return;
    if (EXTERNAL_LINK.test(href)) {
      Linking.openURL(href.startsWith("//") ? `https:${href}` : href).catch((error: unknown) => { console.warn(`[Svelte router] the platform could not open ${href}`, error); });
      return;
    }
    if (!router) throw new Error(`<a href="${href}"> goes to a screen of the app, which needs a router above it`);
    router.goto(href);
  };
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
