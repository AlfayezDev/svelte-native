<script lang="ts">
  import type { NativeLocation } from "./router.svelte.ts";
  let { entry }: { entry: NativeLocation } = $props();
</script>
{#snippet level(depth: number)}
  {@const Current = entry.route.layouts[depth] ?? entry.route.component}
  {#if depth < entry.route.layouts.length}
  <Current params={entry.params} url={entry.url}>
    {@render level(depth + 1)}
  </Current>
  {:else}
  <Current params={entry.params} url={entry.url} />
  {/if}
{/snippet}
{@render level(0)}
