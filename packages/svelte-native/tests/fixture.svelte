<script>
  import { onDestroy } from "svelte";
  let rows = $state([{ id: "a", label: "A" }, { id: "b", label: "B" }]);
  let value = $state("first");
  let visible = $state(true);
  let disposed = 0;
  onDestroy(() => disposed++);
  export function update() {
    rows = [rows[1], rows[0]];
    rows[0].label = "Updated";
    value = "second";
    visible = false;
  }
  export function cleanups() { return disposed; }
</script>
<view>
  <text data-id="value">{value}</text>
  {#if visible}<view data-id="conditional"><text>Temporary</text></view>{/if}
  {#each rows as row (row.id)}<text data-id={row.id}>{row.label}</text>{/each}
  <pressable onpress={() => { value = "pressed"; }} />
</view>
