<script lang="ts" module>
  export const navigator = "tabs";
</script>
<script lang="ts">
  import type { Snippet } from "svelte";
  import { Tabs, View, type TabItem } from "@rasheed/svelte-native";
  import { theme } from "#lib/native/state.svelte.ts";

  /**
   * The route-tree lab (`/__dev/tree`): a tabs navigator whose panes are the directories below, `home/` and `inbox/`.
   * The items are keyed by the pane keys the layout is given; a pane without an item gets its key as its title.
   */
  let { panes, children }: { panes: readonly { key: string }[]; children: Snippet } = $props();

  // A 24 px asset (a data URI) for the home tab; the inbox tab draws its icon from a snippet.
  const disc = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABgAAAAYCAYAAADgdz34AAAAcklEQVR42mNgGAkgHojXAPEDIP4NxQ+gYvGUGgwy6D8B/IAciyYRYTA6nkRLw4m2JJ4Cw2EYb3A9oIIFD2jpery+WENFC9bQKnjwBtNvKlrwe0AsoHkQ0TySaZ5MaZ7R6FJU0Lywo0txTZcKhy5V5tAAABEGOLR+xGf5AAAAAElFTkSuQmCC";
  const known: Record<string, TabItem> = {
    home: { key: "home", title: "Home", icon: { uri: disc } },
    inbox: { key: "inbox", title: "Inbox", icon: square, badge: 3 },
  };
  const items = $derived(panes.map((pane) => known[pane.key] ?? { key: pane.key, title: pane.key }));
  $effect(() => {
    const unknown = panes.filter((pane) => !(pane.key in known)).map((pane) => pane.key);
    if (unknown.length > 0) console.warn(`[route tree lab] no tab item for the pane(s) ${unknown.join(", ")}`);
  });
</script>

{#snippet square(selected: boolean)}
  <View style={{ width: 18, height: 18, borderRadius: 4, backgroundColor: "#000000", opacity: selected ? 1 : 0.6 }} />
{/snippet}

<Tabs {items} tint={theme.foreground}>{@render children()}</Tabs>
