<script>
  import { createRouter } from "../src/router.svelte.ts";
  let { boom = false, label = "v1" } = $props();
  if (boom) throw new Error("kaboom");
  const routes = ["/", "/a", "/b"].map((path) => ({ id: path, path, load: () => { (globalThis.__routeLoads ??= []).push(path); return Promise.resolve({ component: null, layouts: [] }); } }));
  const router = createRouter(routes, "/");
  export function go(href) { router.goto(href); }
</script>
<native-text>{label}:{router.current.url.pathname}:{router.entries.length}</native-text>
