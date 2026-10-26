<script>
  import Router from "../src/Router.svelte";
  import { createRouter } from "../src/router.svelte.ts";
  import Page from "./route-screen-page.svelte";
  import Nested from "./router-nested.svelte";
  let { nested = false } = $props();
  const routes = [
    { id: "home", path: "/", load: () => Promise.resolve({ component: Page, layouts: [] }) },
    { id: "section", path: "/a", load: () => Promise.resolve({ component: Page, layouts: [] }) },
    { id: "item", path: "/b/[id]", presentation: "modal", load: () => Promise.resolve({ component: Page, layouts: [] }) },
  ];
  const router = createRouter(routes, "/");
  export function goto(href, options) { router.goto(href, options); }
  export function stack() { return router.entries.map((entry) => `${entry.url.pathname}:${entry.presentation}`); }
  export function dismissedKey(index) { return router.entries[index]?.key; }
  export function scope() { return router.scope; }
</script>
<Router {router} />
{#if nested}<Nested />{/if}
