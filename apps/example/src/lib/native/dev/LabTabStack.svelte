<script lang="ts">
  import { untrack, type Component } from "svelte";
  import { Router, createRouter, type NativeRoute, type TabHandle } from "@rasheed/svelte-native";
  import LabTabPage from "./LabTabPage.svelte";
  /** The pane of one tab in the screens lab: a stack of its own that answers the back key only while its tab is selected. */
  let { tab }: { tab: TabHandle } = $props();
  // The route table types a page as a component without props; the router passes `params` and `url` to every page.
  const page = () => Promise.resolve({ component: LabTabPage as unknown as Component, layouts: [] });
  const routes: NativeRoute[] = [
    { id: "level", path: "/[tab]/[depth]", load: page },
    { id: "root", path: "/[tab]", load: page },
  ];
  // A pane belongs to one tab for its whole life, so the key is read once.
  const key = untrack(() => tab.key);
  const router = createRouter(routes, `/${key}`, { scope: key, active: () => tab.selected });
</script>

<Router {router} />
