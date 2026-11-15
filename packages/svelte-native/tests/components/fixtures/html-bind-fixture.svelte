<script lang="ts">
  import Focus from "./html-focus-fixture.svelte";
  const probe = globalThis as unknown as { __htmlBind: Record<string, unknown> };
  let items = $state([{ id: 1 }, { id: 2 }, { id: 3 }]);
  let els = $state<({ tag: number } | null)[]>([]);
  let show = $state(false);
  probe.__htmlBind = {
    reverse: () => { items = [...items].reverse(); },
    remove: (id: number) => { items = items.filter((item) => item.id !== id); },
    show: () => { show = true; },
    tags: () => els.map((handle) => handle?.tag ?? null),
  };
</script>

{#each items as item, i (item.id)}
  <div testID={`row-${item.id}`} bind:this={els[i]}>{item.id}</div>
{/each}
{#if show}<Focus />{/if}
