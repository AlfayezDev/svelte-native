<script>
  import Router from "../../../src/Router.svelte";
  import { createRouter } from "../../../src/router.svelte.ts";
  import Page from "../../support/fixtures/route-page.svelte";
  import Layout from "../../support/fixtures/route-layout.svelte";
  import { page, stackOf } from "../../support/tree.ts";
  let { withLoading = false, initial = "/" } = $props();
  const definitions = [
    { id: "home", path: "/", layouts: 0 },
    { id: "section", path: "/a", layouts: 1 },
    { id: "item", path: "/b/[id]", layouts: 0, presentation: "modal" },
  ];
  const loads = [];
  const waiting = {};
  const routes = definitions.map((definition) => page(definition.id, definition.path, () => {
    loads.push(definition.id);
    return new Promise((resolve, reject) => {
      (waiting[definition.id] ??= []).push({
        resolve: () => resolve({ component: Page, layouts: Array.from({ length: definition.layouts }, () => Layout) }),
        reject,
      });
    });
  }, definition.presentation));
  const router = createRouter(stackOf(routes), initial);
  export function loadLog() { return [...loads]; }
  export function release(id) { waiting[id].shift().resolve(); }
  export function fail(id, message) { waiting[id].shift().reject(new Error(message)); }
  export function goto(href, options) { router.goto(href, options); }
  export function back() { return router.back(); }
  export function stack() { return router.entries.map((entry) => entry.url.pathname); }
  export function modulesOf(id) {
    try { return router.modules(routes.find((route) => route.id === id)) ? "ready" : "loading"; } catch (error) { return `failed: ${error.message}`; }
  }
</script>
{#snippet loading(entry)}<native-text>loading {entry.route.id}</native-text>{/snippet}
{#snippet failed(error)}<native-text>failed: {error.message}</native-text>{/snippet}
<svelte:boundary {failed}>
  {#if withLoading}<Router {router} {loading} />{:else}<Router {router} />{/if}
</svelte:boundary>
