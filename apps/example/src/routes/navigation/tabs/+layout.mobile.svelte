<script lang="ts" module>
  export const navigator = "tabs";
</script>

<script lang="ts">
  import type { Snippet } from "svelte";
  import { Tabs, View, type TabItem } from "@rasheed/svelte-native";
  import { theme } from "#lib/theme.svelte.ts";

  // A layout that exports `navigator = "tabs"` turns its folder into a tab bar: each folder below it (feed, profile) is a tab with a stack of
  // its own. `items` gives the bar its labels, icons and badges, by the folder's name. An icon is an image or a snippet; the bar draws it
  // as a template, in its own colours. The export is a literal in the module script because the route table is built from it.
  let { children }: { children: Snippet } = $props();
  const items: TabItem[] = [
    { key: "feed", title: "Feed", icon: circle, badge: 3 },
    { key: "profile", title: "Profile", icon: square },
  ];
</script>

{#snippet circle(selected: boolean)}
  <View style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: "#000000", opacity: selected ? 1 : 0.6 }} />
{/snippet}
{#snippet square(selected: boolean)}
  <View style={{ width: 18, height: 18, borderRadius: 4, backgroundColor: "#000000", opacity: selected ? 1 : 0.6 }} />
{/snippet}

<Tabs {items} tint={theme.colors.accent}>{@render children()}</Tabs>
