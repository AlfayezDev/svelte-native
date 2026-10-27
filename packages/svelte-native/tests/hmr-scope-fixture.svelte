<script>
  import { createRouter } from "../src/router.svelte.ts";
  import Tab from "./hmr-scope-tab.svelte";
  import { page, stackOf } from "./tree.ts";
  let { label = "v1" } = $props();
  const routes = stackOf(["/", "/a"].map((path) => page(path, path, () => Promise.resolve({ component: null, layouts: [] }))));
  const router = createRouter(routes, "/");
  globalThis.__rootRouter = router;
</script>
<native-text>{label}:{router.entries.length}</native-text>
<Tab />
