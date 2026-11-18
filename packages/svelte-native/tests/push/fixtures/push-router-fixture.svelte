<script>
  import Router from "../../../src/Router.svelte";
  import { createRouter } from "../../../src/router.svelte.ts";
  import "../../../src/push/load.ts"; // what `app.ts` imports
  import { registerHooks } from "../../../src/app-hooks.ts";
  import { appTree } from "../../support/tree-app.ts";
  // What the generated `.svelte-native/hooks.ts` does before the app's layout loads: register the hooks file's exports (the push client starts when they have `push`).
  let { initial = "/acme/home", hooks = {}, mounted = true } = $props();
  registerHooks(hooks);
  const router = createRouter(appTree(), initial);
  export function root() { return router; }
  // The session resets by unmounting the root <Router> while the app keeps its router; `mounted: false` is a process with no screen yet (a background launch).
  let shown = $state(mounted);
  export function show(value) { shown = value; }
</script>
{#if shown}<Router {router} />{/if}
