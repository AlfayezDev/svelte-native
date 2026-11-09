<script>
  import { createRouter } from "../src/router.svelte.ts";
  import { page, stackOf } from "./tree.ts";
  const routes = stackOf(["/t/a", "/t/b", "/t/c"].map((path) => page(path, path, () => Promise.resolve({ component: null, layouts: [] }))), "tab-a");
  const router = createRouter(routes, "/t/a", { scope: "tab-a" });
  globalThis.__tabRouter = router;
</script>
<native-text>tab:{router.entries.map((entry) => entry.url.pathname).join(",")}</native-text>
