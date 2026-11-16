<script>
  import Router from "../../../src/Router.svelte";
  import { createRouter } from "../../../src/router.svelte.ts";
  import Page from "./html-page-fixture.svelte";
  import Other from "../../support/fixtures/route-page.svelte";
  import { page, stackOf } from "../../support/tree.ts";
  const router = createRouter(stackOf([
    page("home", "/", () => Promise.resolve({ component: Page, layouts: [] })),
    page("a", "/a", () => Promise.resolve({ component: Other, layouts: [] })),
  ]), "/");
  export function current() { return router.current.url.pathname; }
</script>
<Router {router} />
