<script>
  import { createRouter } from "../../../src/router.svelte.ts";
  // The form before the route tree: a flat array of routes.
  const routes = [{ id: "home", path: "/", presentation: "push", load: () => Promise.resolve({ component: null, layouts: [] }) }];
  try { createRouter(routes, "/"); } catch (error) { globalThis.__routerError = error.message; }
</script>
<native-text>mounted</native-text>
