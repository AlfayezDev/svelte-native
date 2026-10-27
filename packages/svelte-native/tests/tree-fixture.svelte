<script>
  import Router from "../src/Router.svelte";
  import { createRouter } from "../src/router.svelte.ts";
  import { appTree } from "./tree-app.ts";
  let { initial = "/workspaces", bareTabs = false, logLoads, hold } = $props();
  const router = createRouter(appTree({ bareTabs, logLoads, hold }), initial);
  export function root() { return router; }
  // The session resets by unmounting the root <Router> while the app keeps its router.
  let shown = $state(true);
  export function show(value) { shown = value; }
</script>
{#if shown}<Router {router} />{/if}
