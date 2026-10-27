<script lang="ts">
  import type { Snippet } from "svelte";
  import type {} from "../elements.d.ts";
  import resolveAssetSource from "react-native/Libraries/Image/resolveAssetSource";
  import type { TabIconSource, TabItem } from "../fabric/navigation.ts";

  /** One pane of a tab bar with its item's icon, badge and labels: what `Tabs` renders per item, and a tabs layout's panes per pane. */
  let { item, selected, barHeight, children }: { item: TabItem; selected: boolean; barHeight: number; children?: Snippet } = $props();

  const iconUri = (icon: TabIconSource | undefined) => icon === undefined ? undefined : resolveAssetSource(icon)?.uri;
  const view = $derived(typeof item.icon === "function" ? item.icon : undefined);
</script>

<native-tab
  nativeProps={{
    tabKey: item.key, title: item.title, barHeight, badge: item.badge, disabled: item.disabled, iconView: view !== undefined,
    icon: view ? undefined : iconUri(item.icon as TabIconSource | undefined), selectedIcon: iconUri(item.selectedIcon),
    accessibilityLabel: item.accessibilityLabel, testID: item.testID,
  }}
>
  {#if view}<native-tab-icon>{@render view(selected)}</native-tab-icon>{/if}
  {@render children?.()}
</native-tab>
