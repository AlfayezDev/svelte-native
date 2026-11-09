<script lang="ts" module>
  export const navigator = "tabs";
</script>
<script lang="ts">
  import type { Snippet } from "svelte";
  import { Tabs, type TabItem } from "@rasheed/svelte-native";
  let { panes, children }: { panes: readonly { key: string }[]; children: Snippet } = $props();
  const items = $derived<TabItem[]>(panes.map((pane) => ({ key: pane.key, title: pane.key })));
</script>
<Tabs {items}>{@render children()}</Tabs>
