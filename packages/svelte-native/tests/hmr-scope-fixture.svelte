<script>
  import { createRouter } from "../src/router.svelte.ts";
  import Tab from "./hmr-scope-tab.svelte";
  let { label = "v1" } = $props();
  const routes = ["/", "/a"].map((path) => ({ id: path, path, load: () => Promise.resolve({ component: null, layouts: [] }) }));
  const router = createRouter(routes, "/");
  globalThis.__rootRouter = router;
</script>
<native-text>{label}:{router.entries.length}</native-text>
<Tab />
