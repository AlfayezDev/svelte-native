<script lang="ts">
  import Router from "../../../src/Router.svelte";
  import { createRouter } from "../../../src/router.svelte.ts";
  import Page from "./transitions-flip-page.svelte";
  import { page, stackOf } from "../../tree.ts";
  const home = page("home", "/", () => Promise.resolve({ component: Page, layouts: [] }));
  const router = createRouter(stackOf([home]), "/");
  // The page's modules are there when the router mounts (a link opened ahead of the `<Router>`, a stack restored after a prepared navigation): its screen renders with the stack, not a flush later.
  router.load(home);
  const loaded = $derived(router.modules(home) !== undefined);
</script>

{#if loaded}<Router {router} />{/if}
