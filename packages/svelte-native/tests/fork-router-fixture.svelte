<script>
  import Router from "../src/Router.svelte";
  import { createRouter } from "../src/router.svelte.ts";
  import Page from "./fork-route-page.svelte";
  import Heavy from "./fork-route-heavy.svelte";
  import { page, stackOf } from "./tree.ts";
  // `globalThis.__forkHold`: a route id whose loader waits for `release(id)`; the others resolve at once.
  const waiting = {};
  const loads = [];
  const component = { home: Page, b: Page, c: Page, heavy: Heavy };
  const loader = (id) => () => {
    loads.push(id);
    const modules = { component: component[id], layouts: [] };
    if (!globalThis.__forkHold?.includes(id)) return Promise.resolve(modules);
    return new Promise((resolve, reject) => { (waiting[id] ??= []).push({ resolve: () => resolve(modules), reject }); });
  };
  const routes = [
    page("home", "/", loader("home")),
    page("b", "/b", loader("b")),
    page("c", "/c", loader("c")),
    page("heavy", "/heavy", loader("heavy")),
  ];
  const router = createRouter(stackOf(routes), "/");
  export { router };
  export function release(id) { waiting[id].shift().resolve(); }
  export function fail(id) { waiting[id].shift().reject(new Error(`${id} failed`)); }
  export function loadLog() { return [...loads]; }
  // `prepare` called from an effect: the effect must not depend on what `prepare` reads.
  let effectTrigger = $state(0);
  let effectHref = "/b";
  let effectRuns = 0;
  let effectPrepared;
  $effect(() => {
    if (effectTrigger === 0) return;
    effectRuns++;
    effectPrepared = router.prepare(effectHref);
  });
  export function prepareFromEffect(href) { effectHref = href; effectTrigger++; }
  export function effectState() { return { runs: effectRuns, prepared: effectPrepared }; }
</script>
<Router {router} />
