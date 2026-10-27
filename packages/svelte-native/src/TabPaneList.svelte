<script lang="ts">
  import { getContext } from "svelte";
  import Tab from "./components/Tab.svelte";
  import NavigatorPane from "./NavigatorPane.svelte";
  import { useRouter } from "./router.svelte.ts";
  import { TABS_CONTEXT, type TabsBar } from "./fabric/navigation.ts";
  /** A `Tab` per pane of the tabs navigator with the pane's stack in it, in the bar's order; the enclosing `<Tabs>` decides the items, the selection and when a pane mounts. */
  const router = useRouter();
  const bar = getContext<TabsBar | undefined>(TABS_CONTEXT);
  if (!bar) throw new Error("The panes of a tabs navigator render inside its Tabs");
  const panes = router.node.kind === "tabs" ? router.node.panes : [];
</script>
{#each bar.order as key (key)}
  {@const pane = panes.find((candidate) => candidate.key === key)}
  {#if pane}
    <Tab item={bar.item(key)} selected={bar.selected === key} barHeight={bar.barHeight}>
      {#if bar.mounted(key)}<NavigatorPane {pane} />{/if}
    </Tab>
  {/if}
{/each}
