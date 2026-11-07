<script>
  import Router from "../src/Router.svelte";
  import { createRouter } from "../src/router.svelte.ts";
  import Page from "./route-page.svelte";
  import { page, stackOf } from "./tree.ts";
  const tree = (name) => stackOf(["/", "/a", "/b"].map((path) => page(`${name}${path}`, path, () => Promise.resolve({ component: Page, layouts: [] }))));
  // The app's root router, and one created below it (another router is then above, as for a tab pane or a nested navigator): that one is nested.
  const router = createRouter(tree("root"), "/a");
  const inner = createRouter(tree("inner"), "/", { scope: "inner" });
  let root = $state(false);
  let inside = $state(false);
  let flipped = $state(false);
  export function routers() { return { root: router, inner }; }
  export function showRoot(value) { root = value; }
  export function showInner(value) { inside = value; }
  export function flip() { flipped = !flipped; }
</script>
{#if root}
  {#if flipped}<Router {router} />{:else}<Router {router} />{/if}
{/if}
{#if inside}<Router router={inner} />{/if}
