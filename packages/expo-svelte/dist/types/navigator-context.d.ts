import type { Snippet } from "svelte";
import type { ScreenOptions, TabItem } from "./fabric/navigation.js";
import type { NativeLocation } from "./router.svelte-module.js";
/** Context keys between a navigator's router and the layout around it: `<Stack>` gives the screens of its navigator, `<Tabs>` gives the panes the router renders inside it. */
export declare const STACK_CONTEXT: unique symbol;
export declare const TABS_CONTEXT: unique symbol;
/** The options `<Stack>` lays under each screen of its navigator: a page's own `<Screen>` options win (`mergeScreenOptions`). */
export type StackDefaults = Pick<ScreenOptions, "header" | "animation" | "gestureEnabled" | "statusBar" | "navigationBar" | "style">;
/** What a `<Stack>` provides to the router rendering its screens: the defaults and the snippet shown while a route's modules load. */
export type StackContext = {
    readonly defaults: StackDefaults;
    readonly loading: Snippet<[NativeLocation]> | undefined;
};
/** What a `<Router>` provides to the navigators inside its screens: the snippet its own screens show while a route's modules load (a pane's layout is not loaded yet, so it cannot say its own). */
export declare const PLACEHOLDER_CONTEXT: unique symbol;
export type PlaceholderContext = {
    readonly loading: Snippet<[NativeLocation]> | undefined;
};
/** What a `<Tabs>` in a tabs layout provides to the panes the router renders inside it. */
export type TabsBar = {
    /** The pane keys in the bar's order: the layout's items first, then the panes it gave no item. */
    readonly order: readonly string[];
    item(key: string): TabItem;
    readonly selected: string;
    readonly barHeight: number;
    /** Whether the pane's content is mounted (a lazy pane mounts on first selection and then stays). */
    mounted(key: string): boolean;
};
