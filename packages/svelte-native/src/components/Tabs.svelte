<script lang="ts">
  import { setContext, type Snippet } from "svelte";
  import type {} from "../elements.d.ts";
  import Platform from "react-native/Libraries/Utilities/Platform";
  import resolveAssetSource from "react-native/Libraries/Image/resolveAssetSource";
  import { createNativeProps } from "../native-props.ts";
  import { connectInsets, insets } from "../insets.svelte.ts";
  import { PANE_CONTEXT, SCREEN_CONTEXT, TAB_BAR, type HeaderMetrics, type NavigationPlatform, type TabHandle, type TabIconSource, type TabItem } from "../fabric/navigation.ts";

  /**
   * Bottom tab bar with one live pane per tab (contract: SPEC.md "Screen API contract"). `selected` is the truth: a press
   * switches the bar at once and reports `onSelect(key)`, and the next props decide (an unchanged `selected` puts the bar back).
   * Panes mount on first selection when `lazy` and then stay mounted, hidden by the engine, so each keeps its own stack.
   */
  let { items, selected, onSelect, content, lazy = true, tint, inactiveTint, background, labels = "always" }: {
    items: readonly TabItem[];
    selected: string;
    onSelect?: (key: string) => void;
    content: Snippet<[tab: TabHandle]>;
    lazy?: boolean;
    /** Color of the selected tab's icon and label. */
    tint?: string;
    inactiveTint?: string;
    background?: string;
    labels?: "always" | "never";
  } = $props();

  // A pane's screens are not nested in the screen that holds the tabs: its own stack renders its own `native-screen`s.
  setContext(SCREEN_CONTEXT, undefined);
  // A pane ends at the tab bar, which covers the bottom inset: a toolbar inside it needs none of its own.
  setContext(PANE_CONTEXT, true);
  connectInsets();
  const platform: NavigationPlatform = Platform.OS === "ios" ? "ios" : "android";

  let seen = $state.raw<readonly string[]>([]);
  $effect.pre(() => { if (!seen.includes(selected)) seen = [...seen, selected]; });
  let count = $state(0);
  function select(event: { nativeEvent: { key: string } }) {
    count += 1;
    onSelect?.(event.nativeEvent.key);
  }
  let measured = $state<HeaderMetrics | null>(null);
  const barHeight = $derived(measured?.height ?? TAB_BAR[platform] + insets.bottom);
  function metrics(event: { nativeEvent: HeaderMetrics }) { measured = event.nativeEvent; }

  const iconUri = (icon: TabIconSource | undefined) => icon === undefined ? undefined : resolveAssetSource(icon)?.uri;
  const resolveTabs = createNativeProps();
  const tabsProps = $derived(resolveTabs({
    selectedIndex: Math.max(0, items.findIndex((item) => item.key === selected)),
    selectCount: count,
    tint, inactiveTint, background, labels, barHeight,
    onSelect: select,
    onMetrics: metrics,
  }));
</script>

<native-tabs nativeProps={tabsProps}>
  {#each items as item (item.key)}
    {@const tab: TabHandle = { key: item.key, get selected() { return selected === item.key; } }}
    {@const view = typeof item.icon === "function" ? item.icon : undefined}
    <native-tab
      nativeProps={{
        tabKey: item.key, title: item.title, barHeight, badge: item.badge, disabled: item.disabled, iconView: view !== undefined,
        icon: view ? undefined : iconUri(item.icon as TabIconSource | undefined), selectedIcon: iconUri(item.selectedIcon),
        accessibilityLabel: item.accessibilityLabel, testID: item.testID,
      }}
    >
      {#if view}<native-tab-icon>{@render view(selected === item.key)}</native-tab-icon>{/if}
      {#if !lazy || seen.includes(item.key) || selected === item.key}{@render content(tab)}{/if}
    </native-tab>
  {/each}
</native-tabs>
