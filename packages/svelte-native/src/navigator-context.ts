import type { Snippet } from "svelte";
import type { ScreenOptions, TabItem } from "./fabric/navigation.ts";
import type { NativeLocation } from "./router.svelte.ts";

/** Context keys between a navigator's router and the layout around it: `<Stack>` gives the screens of its navigator, `<Tabs>` gives the panes the router renders inside it. */
export const STACK_CONTEXT = Symbol.for("svelte-native.stack");
export const TABS_CONTEXT = Symbol.for("svelte-native.tabs");

/** The options `<Stack>` lays under each screen of its navigator: a page's own `<Screen>` options win (`mergeScreenOptions`). */
export type StackDefaults = Pick<ScreenOptions, "header" | "animation" | "gestureEnabled" | "statusBar" | "navigationBar" | "style">;
/** What a `<Stack>` provides to the router rendering its screens: the defaults and the snippet shown while a route's modules load. */
export type StackContext = { readonly defaults: StackDefaults; readonly loading: Snippet<[NativeLocation]> | undefined };
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
