<script>
  import Router from "../../../src/Router.svelte";
  import { createRouter, useRouter } from "../../../src/router.svelte.ts";
  import Page from "./route-screen-page.svelte";
  import { page, stackOf } from "../../tree.ts";
  const routes = stackOf(["/t/a", "/t/b", "/t/n/[id]"].map((path) => page(path, path, () => Promise.resolve({ component: Page, layouts: [] }))), "tab-a");
  const outer = useRouter();
  let active = $state(true);
  const router = createRouter(routes, "/t/a", { scope: "tab-a", active: () => active });
  // Lookups run while the component initialises: the context is only readable then.
  const found = { nearest: useRouter(), root: useRouter("root"), self: useRouter("tab-a") };
  let missing = "";
  try { useRouter("nope"); } catch (error) { missing = error.message; }
  globalThis.__nested = { router, outer, found, missing, setActive: (value) => { active = value; } };
</script>
<Router {router} />
