/// <reference path="./kit/modules.d.ts" />
import { type Presentation, type RouterScopeOptions } from "./fabric/navigation.js";
import { type Navigation, type PageRoute, type RouteModules, type RouteNode, type StackNode, type TabsNode } from "./route-tree.js";
export type { Pane, PageRoute, RouteModules, RouteNode, StackNode, TabsNode } from "./route-tree.js";
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
export type RouterScreen = {
    entry: NativeLocation;
    canGoBack: boolean;
    leaving: boolean;
};
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
type StackState = ReturnType<typeof createStack>;
type TabsState = {
    readonly kind: "tabs";
    readonly selected: string;
    select(key: string): void;
    readonly panes: ReadonlyMap<string, StackState>;
};
type NavigatorState = {
    kind: "stack";
    stack: StackState;
} | TabsState;
/**
 * The native stack of one navigator. A popped entry stays in it, inactive, until the stack reports that its exit transition
 * ended (SPEC.md "Screen exit"), so the unmount of the page (the whole subtree) is not part of the transition's frames.
 * Platforms whose stack animates a removal itself (`EXIT_REPORTED` false) drop the entry at once. `screens` is what the router
 * renders: the entries and the ones on their way out, each at the place it had, so nothing moves in the native stack when one leaves.
 * A screen can go back when another is below it, or when `baseBack` says the first one can: a nested stack navigator's first
 * screen goes back by popping its own screen from the stack above (a pane's base does not).
 */
declare function createStack(reportsExit: boolean, initial?: readonly NativeLocation[], baseBack?: boolean): {
    /** Whether the first screen of this stack can go back. */
    readonly baseBack: boolean;
    /** The live stack, bottom first: what `back`, `goto` and `current` work on. */
    readonly entries: readonly NativeLocation[];
    readonly screens: readonly RouterScreen[];
    /** Makes `next` the live stack. `retire` keeps what it removes on screen until it reports its exit; the user's own dismissal has happened natively already (no `retire`). */
    set(next: readonly NativeLocation[], retire?: boolean): void;
    /** Whether the first screen of this stack can go back changed: its own screen moved in the stack above (see `set`). */
    setBaseBack(value: boolean): void;
    /** The user dismissed the screen natively (after its transition): it and the ones above it are gone already, so they are dropped at once. */
    dismissed(key: number): void;
    /** The stack is not on screen (its `<Router>` unmounted): the screens still leaving have no native stack to report their exit, so they go at once. */
    dropLeaving(): void;
    /** The native stack finished taking a popped screen away: its page unmounts now. */
    exited(key: number): void;
    /** The stack's component is gone: its exit timer and those of the navigators it still holds stop. */
    dispose(): void;
};
/**
 * Connects the app's root router to the host while its `<Router>` is mounted: the Android back key and links. Only the outermost
 * router does, and it is the only one that registers anything: the key goes to the innermost active router (through tabs and
 * nested stacks, hand-made named routers included), and its `back()` hands the pop outward when it has nothing to pop. The link the
 * app was launched with is read once per router, however often its `<Router>` mounts. Returns what disconnects.
 */
export declare function connectHost(router: Router): () => void;
/** How long the platform gets to answer for the launch link before the app starts as if it had none (an answer that comes later is still opened, see `readLaunch`). */
export declare const LAUNCH_URL_TIMEOUT_MS = 3000;
/**
 * Opens the link the app was launched with into the root router now, instead of when its `<Router>` mounts, and resolves with the link once it
 * has (`null` when there was none, when the platform has not answered within three seconds, or for a router that is not the root). The `<Router>`
 * that mounts afterwards starts on the link's screen and does not open it again: a shell that decides what to show by the launch link can wait
 * for this before it renders the navigator, so the router's first screen (the `initial` of `createRouter`, which the link replaces) is never
 * rendered. The platform is asked once, whoever asks. `accept` refuses a link for now (it stays for the `<Router>`'s own call); a read that
 * failed rejects and is asked again by the next call.
 */
export declare function openLaunchURL(router: Router, accept?: (url: string) => boolean): Promise<string | null>;
/** The app's root router (the newest one `createRouter` made with the scope `"root"` whose component is alive), or `undefined` before the app creates it and after it is gone. A read inside an effect or a template follows it. */
export declare const rootRouter: () => Router | undefined;
/**
 * The router of a tree: its root navigator's, which opens links and answers the back key. It registers in the component context
 * under `options.scope` (`"root"` for the outermost router, unnamed for a nested one) so `useRouter(scope)` finds it from any
 * screen below. `options.active` says whether the router currently owns the back key and links; a tab pane built by hand
 * passes its selection (default: always). The navigators below the root get their routers where their screens render.
 */
export declare function createRouter(tree: StackNode, initial?: string, options?: RouterScopeOptions): Router;
/** The router of the nested stack or tabs navigator whose screen `entry` is; call it while the screen's content initializes (it registers for `useRouter` below). */
export declare function enterNavigator(entry: NativeLocation): Router;
/** The router of a pane of the tabs navigator above: a stack of its own, active while its tab is selected. `host` is the screen of the tabs navigator, whose params and url the pane's layout is given. */
export declare function enterPane(key: string): {
    router: Router;
    host: NativeLocation;
};
/** The nearest router above this component, if any: what `Tabs` asks to tell a tabs layout from a tab bar of a page. */
export declare function nearestRouter(): Router | undefined;
/**
 * What a press of an `<a href>` calls (the lowering of HTML elements writes a `useLink()` call into the instance script, `lower-html.ts`): a path of the app goes to
 * the nearest router's `goto`, as SvelteKit's router follows a link, and any other link (`https:`, `mailto:`, `tel:`, the app's own scheme) is opened by the platform
 * (`Linking.openURL`). Call it while the component initializes, as `useRouter`; unlike `useRouter` it does not throw without a router above, because a link to another site needs none
 * (a press of an app link without one does). A link that is only a hash (`#top`), or none, does nothing: there is no page to scroll.
 */
export declare function useLink(): (href?: string) => void;
/** The nearest router, or with `scope` the nearest one above that was created with that name (`"root"` is the outermost). */
export declare function useRouter(scope?: string): Router;
