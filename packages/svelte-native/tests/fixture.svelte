<script>
  import { onDestroy } from "svelte";
  import Host from "../src/components/Host.svelte";
  let rows = $state([{ id: "a", label: "A" }, { id: "b", label: "B" }]);
  let value = $state("first");
  let visible = $state(true);
  let disposed = 0;
  let redraws = $state(0);
  const style = $state({ opacity: 1, transform: [{ translateX: 0 }] });
  const nativeProps = $derived.by(() => {
    void redraws;
    return { testID: "styled", style: { opacity: style.opacity, transform: style.transform } };
  });
  export function redrawStyle() { redraws++; }
  export function moveStyle() { style.transform[0].translateX = 40; }
  onDestroy(() => disposed++);
  export function update() {
    rows = [rows[1], rows[0]];
    rows[0].label = "Updated";
    value = "second";
    visible = false;
  }
  export function cleanups() { return disposed; }
  export function removeRows() { rows = []; }
</script>
<view>
  <Host name="native-view" attributes={nativeProps} />
  <text data-id="value">{value}</text>
  {#if visible}<view data-id="conditional"><text>Temporary</text></view>{/if}
  {#each rows as row (row.id)}<text data-id={row.id}>{row.label}</text>{/each}
  <pressable onpress={() => { value = "pressed"; }} />
</view>
