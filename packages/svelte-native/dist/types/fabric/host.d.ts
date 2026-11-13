import type { Adoption } from "../hmr-state.js";
import { type Component } from "./deps-svelte.js";
/** A style whose values are all numbers, strings and booleans: none can be a shared value, and no key is an animation or transition. */
export declare function plainStyle(style: unknown): boolean;
/**
 * Once the animation layer is loaded: whether a node that has never been through it can need it (`animationProps` returns the attributes
 * as they are for any other node, and building one costs a pass over them): the attributes it reads, a CSS key beside the style or in it,
 * or a style value that could be a shared value.
 */
export declare function mayAnimate(attributes: Record<string, unknown>): boolean;
/**
 * How many nodes a commit has to attach to the animation layer for the first time for the engine to be told (`animatedBatch`). Registering a node costs
 * the UI runtime about 0.8 ms on the A16's coldest core (0.6 for the animation the app starts on its shared value, 0.17 for the descriptor and the mapper),
 * the whole commit is one UI-thread message, and a message over about half a frame period (6 ms at 90 Hz) delays the frame behind it: eight nodes is the
 * first commit that can. One animated button, a row's icon or a handful of badges stay below it.
 */
export declare const BULK_ANIMATED_NODES = 8;
/** What a `ref` attribute on a host element receives. */
export type HostHandle = {
    readonly tag: number;
    measure(callback: (x: number, y: number, width: number, height: number, pageX: number, pageY: number) => void): void;
    measureInWindow(callback: (x: number, y: number, width: number, height: number) => void): void;
    dispatchCommand(name: string, args?: unknown[]): void;
    /**
     * Where the element is in the document: the index among the siblings at each level, from the root down. Two positions compare as the
     * elements do in the document (the first index that differs decides), which is how a component that has no native view tells which of
     * its kind comes first (`components/svg/registry.ts`). Read when asked, from the tree as it is then.
     */
    position(): number[];
    /** `scrollTo`, `scrollToEnd`, `focus`, `blur` and `setNativeProps` keep React Native's instance signatures. */
    scrollTo(options?: {
        x?: number;
        y?: number;
        animated?: boolean;
    } | number, deprecatedY?: number, deprecatedAnimated?: boolean): void;
    scrollToEnd(options?: {
        animated?: boolean;
    }): void;
    focus(): void;
    blur(): void;
    setNativeProps(props: Record<string, unknown>): void;
};
/** Hands the root router's navigation state to the host, which keeps it for a restart of the process (Android: the Activity's saved instance state; iOS: a file it writes when the app goes to the background). Nothing happens without either module. */
export declare function saveNavigation(json: string): void;
/**
 * The state the previous process left, when the host keeps it in its own way (iOS) and not in `initialProps.navigation` (Android): the JSON of a
 * record that is fresh and that the router can read (`freshNavigation`: the system's say, the build, the attempts, the age), once. A record that is not used is
 * cleared at once, the host being told why; one that is used is cleared by `navigationAdopted` when the surface has started, with what the router did with it.
 * Restoring is best effort: a host that throws leaves the app on its first screen.
 */
export declare function hostNavigation(): string | undefined;
/**
 * The surface started with the state `hostNavigation` gave it: the host can forget it (a start that dies before this is counted, and a state that failed twice is
 * dropped) and write down what the root router made of it (`adoption`, which it left in `hmrState()`): `restored` when it took the state, `dropped` with its reason
 * when it refused it (a route that is gone) or when no router asked for it.
 */
export declare function navigationAdopted(adoption: Adoption | undefined): void;
/** Whether the host's window went away because the user left (Back, a swipe from Recents) and not because it is being recreated: Android's `Activity.isFinishing`. */
export declare function hostFinishing(): boolean;
export declare function fabricStats(): {
    waiting: number;
    engineInstalled: boolean;
    animationLoaded: boolean;
    gesturesLoaded: boolean;
    gestures: {
        records: number;
        handlers: number;
        eventHandlers: number;
    } | null;
    flushes: number;
    lastFlushMs: number;
    lastCreated: number;
    lastCloned: number;
    lastCompleted: number;
    payloadMs: number;
    createMs: number;
    appendMs: number;
    completeMs: number;
};
/**
 * Spike instrumentation: the cost of the Fabric binding itself, per call, measured without Svelte.
 * Nodes created here are never committed; they are released when garbage collected.
 */
export declare function microbench(count?: number): Record<string, number> | null;
/** Commits every pending change in one Fabric transaction per root. */
export declare function flush(): void;
/** Mounts a Svelte component as the content of a Fabric surface and returns the component's exports. */
export declare function startSurface<Props extends Record<string, unknown>>(rootTag: number, App: Component<Props>, props: Props): Record<string, unknown>;
export declare function stopSurface(rootTag: number): void;
