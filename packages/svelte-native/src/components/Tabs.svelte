<script lang="ts">
  import { setContext, untrack, type Snippet } from "svelte";
  import type {} from "../elements.d.ts";
  import Platform from "react-native/Libraries/Utilities/Platform";
  import { createNativeProps } from "../native-props.ts";
  import { connectInsets, insets } from "../insets.svelte.ts";
  import { nearestRouter } from "../router.svelte.ts";
  import Tab from "./Tab.svelte";
  import { PANE_CONTEXT, SCREEN_CONTEXT, TAB_BAR, type HeaderMetrics, type NavigationPlatform, type TabHandle, type TabItem } from "../fabric/navigation.ts";
  import { TABS_CONTEXT, type TabsBar } from "../navigator-context.ts";

  /**
   * Bottom tab bar with one live pane per tab (contract: SPEC.md "Screen API contract" and "Route tree"). Two modes:
   *
   * - Component mode (`content`, `selected`): `selected` is the truth: a press switches the bar at once and reports `onSelect(key)`,
   *   and the next props decide (an unchanged `selected` puts the bar back). The pane of a tab is what `content` renders.
   * - Navigator mode (no `content`, inside a tabs layout): the router's tabs node owns the selection and the panes are the
   *   layout's `children`. A press selects at once and the owner can override it by navigating; `onSelect` still reports.
   *   `items` are keyed by the pane keys, in the order of the bar.
   *
   * Panes mount on first selection when `lazy` and then stay mounted, hidden by the engine, so each keeps its own stack.
   */
  let { items, selected, onSelect, content, children, lazy = true, tint, inactiveTint, background, labels = "always" }: {
    items: readonly TabItem[];
    selected?: string;
    onSelect?: (key: string) => void;
    content?: Snippet<[tab: TabHandle]>;
    children?: Snippet;
    lazy?: boolean;
    /** Color of the selected tab's icon and label. */
    tint?: string;
    inactiveTint?: string;
    background?: string;
    labels?: "always" | "never";
  } = $props();

  // The mode is a fact of where the component sits and cannot change while it lives.
  const componentMode = untrack(() => content !== undefined);
  const owner = componentMode ? undefined : nearestRouter();
  const tabsRouter = owner?.node.kind === "tabs" ? owner : undefined;
  if (!componentMode && !tabsRouter) throw new Error("Tabs outside a tabs layout needs `selected` and `content`");

  // A pane's screens are not nested in the screen that holds the tabs: its own stack renders its own `native-screen`s.
  setContext(SCREEN_CONTEXT, undefined);
  // A pane ends at the tab bar, which covers the bottom inset: a toolbar inside it needs none of its own.
  setContext(PANE_CONTEXT, true);
  connectInsets();
  const platform: NavigationPlatform = Platform.OS === "ios" ? "ios" : "android";

  const paneKeys = $derived(tabsRouter?.node.kind === "tabs" ? tabsRouter.node.panes.map((pane) => pane.key) : undefined);
  const order = $derived(paneKeys
    ? [...items.map((item) => item.key).filter((key) => paneKeys.includes(key)), ...paneKeys.filter((key) => !items.some((item) => item.key === key))]
    : items.map((item) => item.key));
  const current = $derived((tabsRouter ? tabsRouter.selected : selected) ?? "");

  let seen = $state.raw<readonly string[]>([]);
  $effect.pre(() => { if (!seen.includes(current)) seen = [...seen, current]; });
  const mounted = (key: string) => !lazy || seen.includes(key) || current === key;
  let count = $state(0);
  function select(event: { nativeEvent: { key: string } }) {
    count += 1;
    tabsRouter?.select(event.nativeEvent.key);
    onSelect?.(event.nativeEvent.key);
  }
  let measured = $state<HeaderMetrics | null>(null);
  const barHeight = $derived(measured?.height ?? TAB_BAR[platform] + insets.bottom);
  function metrics(event: { nativeEvent: HeaderMetrics }) { measured = event.nativeEvent; }

  const resolveTabs = createNativeProps();
  const tabsProps = $derived(resolveTabs({
    selectedIndex: Math.max(0, order.indexOf(current)),
    selectCount: count,
    tint, inactiveTint, background, labels, barHeight,
    onSelect: select,
    onMetrics: metrics,
  }));

  if (tabsRouter) {
    const bar: TabsBar = {
      get order() { return order; },
      item: (key) => items.find((item) => item.key === key) ?? { key, title: key },
      get selected() { return current; },
      get barHeight() { return barHeight; },
      mounted,
    };
    setContext(TABS_CONTEXT, bar);
    // A mismatch between the layout's items and the directory's panes is a mistake to fix while developing; it is said once per kind.
    const said: string[] = [];
    $effect(() => {
      if (!paneKeys || typeof __DEV__ === "undefined" || !__DEV__) return;
      const withoutPane = items.filter((item) => !paneKeys.includes(item.key)).map((item) => item.key);
      const withoutItem = paneKeys.filter((key) => !items.some((item) => item.key === key));
      for (const [kind, keys] of [["item", withoutPane], ["pane", withoutItem]] as const) {
        const message = kind === "item"
          ? `[Svelte tabs] items without a pane (their keys are not directories of ${tabsRouter.node.id}): ${keys.join(", ")}`
          : `[Svelte tabs] panes without an item (shown with their key as title): ${keys.join(", ")}`;
        if (keys.length > 0 && !said.includes(message)) { said.push(message); console.error(message); }
      }
    });
  }
</script>

<native-tabs nativeProps={tabsProps}>
  {#if tabsRouter}
    {@render children?.()}
  {:else}
    {#each items as item (item.key)}
      {@const tab: TabHandle = { key: item.key, get selected() { return current === item.key; } }}
      <Tab {item} selected={current === item.key} {barHeight}>
        {#if mounted(item.key)}{@render content?.(tab)}{/if}
      </Tab>
    {/each}
  {/if}
</native-tabs>
