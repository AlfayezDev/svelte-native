<script lang="ts">
  import { flip } from "svelte/animate";
  const probe = globalThis as unknown as { __tx: Record<string, unknown> };
  let items = $state([1, 2, 3]);
  probe.__tx = { setItems: (value: number[]) => { items = value; } };
</script>

<ul testID="list">
  {#each items as item (item)}
    <li testID={`item-${item}`} animate:flip={{ duration: 300 }}>{item}</li>
  {/each}
</ul>
