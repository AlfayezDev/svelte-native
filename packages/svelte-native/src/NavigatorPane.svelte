<script lang="ts">
  import { getContext, untrack } from "svelte";
  import Router from "./Router.svelte";
  import { PLACEHOLDER_CONTEXT, type PlaceholderContext } from "./navigator-context.ts";
  import { enterPane } from "./router.svelte.ts";
  import type { Pane } from "./route-tree.ts";
  /**
   * The content of one tab pane: its stack, inside the stack's own layout when the pane directory has one. The layout loads
   * through the router like a route (a navigation into the pane loads it again if its load failed, a failure is thrown here),
   * and until it is in the pane shows the placeholder of the router around the tabs: the layout's own `<Stack loading>` is not known yet.
   */
  let { pane }: { pane: Pane } = $props();
  // A pane belongs to one tab for its whole life, so the key is read once.
  const { router, host } = enterPane(untrack(() => pane.key));
  const options = untrack(() => pane.stack.layout ? pane.stack : undefined);
  if (options) router.load(options);
  const modules = $derived(options ? router.modules(options) : undefined);
  const outer = getContext<PlaceholderContext | undefined>(PLACEHOLDER_CONTEXT);
  const top = $derived(router.entries.at(-1));
</script>
{#if !options}
  <Router {router} />
{:else if modules}
  {@const Layout = modules.component}
  <Layout params={host.params} url={host.url}><Router {router} /></Layout>
{:else if outer?.loading && top}
  {@render outer.loading(top)}
{/if}
