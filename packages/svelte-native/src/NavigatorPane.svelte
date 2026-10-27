<script lang="ts">
  import { untrack } from "svelte";
  import Router from "./Router.svelte";
  import { enterPane } from "./router.svelte.ts";
  import type { Pane } from "./route-tree.ts";
  /** The content of one tab pane: its stack, inside the stack's own layout when the pane directory has one. */
  let { pane }: { pane: Pane } = $props();
  // A pane belongs to one tab for its whole life, so the key is read once.
  const router = enterPane(untrack(() => pane.key));
  const options = untrack(() => pane.stack.layout ? pane.stack : undefined);
  if (options) router.load(options);
  const modules = $derived(options ? router.modules(options) : undefined);
</script>
{#if !options}
  <Router {router} />
{:else if modules}
  {@const Layout = modules.component}
  <Layout><Router {router} /></Layout>
{/if}
