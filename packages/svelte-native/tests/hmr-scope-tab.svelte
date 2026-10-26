<script>
  import { createRouter } from "../src/router.svelte.ts";
  const routes = ["/t/a", "/t/b", "/t/c"].map((path) => ({ id: path, path, load: () => Promise.resolve({ component: null, layouts: [] }) }));
  const router = createRouter(routes, "/t/a", { scope: "tab-a" });
  globalThis.__tabRouter = router;
</script>
<native-text>tab:{router.entries.map((entry) => entry.url.pathname).join(",")}</native-text>
