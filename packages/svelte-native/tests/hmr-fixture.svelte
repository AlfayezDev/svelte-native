<script>
  import Router from "../src/Router.svelte";
  import { createRouter } from "../src/router.svelte.ts";
  import Page from "./route-empty.svelte";
  import { page, stackOf } from "./tree.ts";
  let { boom = false, label = "v1" } = $props();
  if (boom) throw new Error("kaboom");
  const routes = stackOf(["/", "/a", "/b"].map((path) => page(path, path, () => { (globalThis.__routeLoads ??= []).push(path); return Promise.resolve({ component: Page, layouts: [] }); })));
  const router = createRouter(routes, "/");
  export function go(href) { router.goto(href); }
</script>
<native-view>
  <native-text>{label}:{router.current.url.pathname}:{router.entries.length}</native-text>
  <Router {router} />
</native-view>
