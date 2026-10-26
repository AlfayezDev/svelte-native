<script lang="ts">
  import type { Snippet } from "svelte";
  import type { NativeLocation, RouteModules, createRouter } from "./router.svelte.ts";
  let { entry, router, loading }: { entry: NativeLocation; router: ReturnType<typeof createRouter>; loading?: Snippet<[NativeLocation]> } = $props();
  const modules = $derived(router.modules(entry.route));
</script>
{#snippet level(depth: number, loaded: RouteModules)}
  {@const Current = loaded.layouts[depth] ?? loaded.component}
  {#if depth < loaded.layouts.length}
  <Current params={entry.params} url={entry.url}>
    {@render level(depth + 1, loaded)}
  </Current>
  {:else}
  <Current params={entry.params} url={entry.url} />
  {/if}
{/snippet}
{#if modules}
  {@render level(0, modules)}
{:else if loading}
  {@render loading(entry)}
{/if}
