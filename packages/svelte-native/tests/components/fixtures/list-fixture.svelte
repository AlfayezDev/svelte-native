<script lang="ts">
  import List from "../../../src/components/List.svelte";
  let { count = 300, onEnd = () => {}, rowHeight = 40 as number | null, horizontal = false, recycle = false, initialScrollIndex, onViewable, heightOf, none = false, height }: {
    count?: number; onEnd?: () => void; rowHeight?: number | null; horizontal?: boolean; recycle?: boolean;
    initialScrollIndex?: number; onViewable?: (info: never) => void; heightOf?: (item: unknown, index: number) => number; none?: boolean; height?: number;
  } = $props();
  let override = $state<number | null>(null);
  const total = $derived(override ?? count);
  export function setCount(next: number) { override = next; }
  let sizeOverride = $state<number | null>(null);
  export function setRowHeight(next: number) { sizeOverride = next; }
  // Rows that arrive in front of the ones there are: the keys keep their rows and their indexes move.
  let base = $state(0);
  export function prepend(n: number) { base -= n; override = total + n; }
  const items = $derived(none ? [] : Array.from({ length: total }, (_, index) => ({ id: `r${index + base}`, label: `Row ${index + base}` })));
  let list: { scrollToIndex: (index: number, animated?: boolean) => void } | undefined = $state();
  export function jump(index: number) { list?.scrollToIndex(index, false); }
</script>
<List bind:this={list} {items} style={height ? { height } : undefined} rowHeight={sizeOverride ?? rowHeight ?? undefined} rowHeights={heightOf} {horizontal} {recycle} {initialScrollIndex} keyOf={(item) => item.id} onEndReached={onEnd} onViewableItemsChanged={onViewable as never}>
  {#snippet row(item)}<native-text data-id={item.id}>{item.label}</native-text>{/snippet}
  {#snippet empty()}<native-text data-id="empty">none</native-text>{/snippet}
</List>
