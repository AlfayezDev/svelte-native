<script lang="ts">
  import { getContext } from "svelte";
  import Tabs from "./components/Tabs.svelte";
  import TabPaneList from "./TabPaneList.svelte";
  import { useRouter } from "./router.svelte.ts";
  import { TABS_CONTEXT, type TabsBar } from "./navigator-context.ts";
  /**
   * The children of a tabs layout: a tab per pane with the pane's stack in it. A layout that renders them inside its own
   * `<Tabs>` decides the items; one that does not gets a default bar whose titles are the pane keys.
   */
  const router = useRouter();
  const bar = getContext<TabsBar | undefined>(TABS_CONTEXT);
  const defaults = (router.node.kind === "tabs" ? router.node.panes : []).map(({ key }) => ({ key, title: key }));
</script>
{#if bar}
  <TabPaneList />
{:else}
  <Tabs items={defaults}><TabPaneList /></Tabs>
{/if}
