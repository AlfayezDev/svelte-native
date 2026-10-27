<script>
  import Router from "../src/Router.svelte";
  import { createRouter } from "../src/router.svelte.ts";
  import Page from "./route-screen-page.svelte";
  import Nested from "./router-nested.svelte";
  import { page, stackOf } from "./tree.ts";
  let { nested = false } = $props();
  const load = () => Promise.resolve({ component: Page, layouts: [] });
  const router = createRouter(stackOf([page("home", "/", load), page("section", "/a", load), page("item", "/b/[id]", load, "modal")]), "/");
  export function goto(href, options) { router.goto(href, options); }
  export function back() { return router.back(); }
  export function screens() { return router.screens.map(({ entry, canGoBack, leaving }) => `${entry.url.pathname}:${canGoBack ? "back" : "root"}:${leaving ? "leaving" : "live"}`); }
  export function exited(index) { router.exited(router.screens[index].entry.key); }
  export function stack() { return router.entries.map((entry) => `${entry.url.pathname}:${entry.presentation}`); }
  export function dismissedKey(index) { return router.entries[index]?.key; }
  export function scope() { return router.scope; }
</script>
<Router {router} />
{#if nested}<Nested />{/if}
