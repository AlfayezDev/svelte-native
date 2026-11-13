<script>
  import Router from "../src/Router.svelte";
  import { createRouter } from "../src/router.svelte.ts";
  import { page } from "../src/kit/state.ts";
  import { appTree } from "./tree-app.ts";
  let { initial = "/workspaces", logLoads } = $props();
  const router = createRouter(appTree({ logLoads }), initial);
  // What a component that reads `page` in an effect sees, each time it changes.
  const seen = (globalThis.__kitSeen = []);
  $effect(() => { seen.push(`${page.url.pathname} ${JSON.stringify(page.params)} ${page.route.id}`); });
  export function root() { return router; }
</script>
<Router {router} />
