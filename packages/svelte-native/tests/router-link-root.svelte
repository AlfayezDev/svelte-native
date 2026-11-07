<script>
  import Router from "../src/Router.svelte";
  import { createRouter } from "../src/router.svelte.ts";
  import Page from "./route-page.svelte";
  import { page, stackOf } from "./tree.ts";
  let { name } = $props();
  // A root router of its own: this component is not below another router.
  const router = createRouter(stackOf(["/", "/a"].map((path) => page(`${name}${path}`, path, () => Promise.resolve({ component: Page, layouts: [] })))), "/");
  (globalThis.__linkRoots ??= {})[name] = router;
</script>
<Router {router} />
