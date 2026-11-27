<script>
  import Router from "../../../src/Router.svelte";
  import { createRouter } from "../../../src/router.svelte.ts";
  import { appTree } from "../../support/tree-app.ts";
  let { initial = "/workspaces", bareTabs = false, logLoads, hold, boundary = false, outerLoading = false, files, tabs, mounted = true } = $props();
  // `files` is another app's route files (the QA app's), `tabs` the items its tabs layout shows.
  if (tabs) globalThis.__treeTabs = tabs;
  const router = createRouter(appTree({ files, bareTabs, logLoads, hold }), initial);
  export function root() { return router; }
  // The session resets by unmounting the root <Router> while the app keeps its router.
  // `mounted: false` starts without the <Router>: the shell that opens the launch link first (`openLaunchURL`) mounts it with `show(true)`.
  let shown = $state(mounted);
  export function show(value) { shown = value; }
</script>
{#snippet loading(entry)}<native-text>outer loading {entry.url.pathname}</native-text>{/snippet}
{#snippet failed(error)}<native-text>failed: {error.message}</native-text>{/snippet}
{#snippet app()}
  {#if shown}{#if outerLoading}<Router {router} {loading} />{:else}<Router {router} />{/if}{/if}
{/snippet}
{#if boundary}<svelte:boundary {failed}>{@render app()}</svelte:boundary>{:else}{@render app()}{/if}
