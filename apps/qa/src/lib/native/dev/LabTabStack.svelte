<script lang="ts">
  import { untrack, type Component } from "svelte";
  import { Router, createRouter, type StackNode, type TabHandle } from "expo-svelte";
  import LabTabPage from "./LabTabPage.svelte";
  /** The pane of one tab in the screens lab: a stack of its own that answers the back key only while its tab is selected. */
  let { tab }: { tab: TabHandle } = $props();
  // The route table types a page as a component without props; the router passes `params` and `url` to every page.
  const page = () => Promise.resolve({ component: LabTabPage as unknown as Component, layouts: [] });
  // A pane belongs to one tab for its whole life, so the key is read once.
  const key = untrack(() => tab.key);
  const tree: StackNode = {
    kind: "stack", id: key, path: "/",
    routes: [
      { kind: "page", id: "level", path: "/[tab]/[depth]", presentation: "push", load: page },
      { kind: "page", id: "root", path: "/[tab]", presentation: "push", load: page },
    ],
  };
  const router = createRouter(tree, `/${key}`, { scope: key, active: () => tab.selected });
</script>

<Router {router} />
