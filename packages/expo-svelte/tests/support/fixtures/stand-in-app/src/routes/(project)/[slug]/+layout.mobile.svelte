<script lang="ts" module>
  export const navigator = "tabs";
</script>
<script lang="ts">
  import type { Snippet } from "svelte";
  import { Tabs, type TabItem } from "expo-svelte";
  /** A project: a tabs navigator whose panes are the directories below, `home/` and `settings/`, in this order. */
  let { panes, children }: { panes: readonly { key: string }[]; children: Snippet } = $props();
  const titles: Record<string, string> = { home: "Home", settings: "Settings" };
  const items = $derived<TabItem[]>(panes.map((pane) => ({ key: pane.key, title: titles[pane.key] ?? pane.key })));
</script>
<Tabs {items}>{@render children()}</Tabs>
