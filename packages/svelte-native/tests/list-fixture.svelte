<script lang="ts">
  import List from "../src/components/List.svelte";
  let { count = 300, onEnd = () => {}, rowHeight = 40 as number | null, horizontal = false, recycle = false, initialScrollIndex, onViewable, heightOf, none = false }: {
    count?: number; onEnd?: () => void; rowHeight?: number | null; horizontal?: boolean; recycle?: boolean;
    initialScrollIndex?: number; onViewable?: (info: never) => void; heightOf?: (item: unknown, index: number) => number; none?: boolean;
  } = $props();
  const items = $derived(none ? [] : Array.from({ length: count }, (_, index) => ({ id: `r${index}`, label: `Row ${index}` })));
  let list: { scrollToIndex: (index: number, animated?: boolean) => void } | undefined = $state();
  export function jump(index: number) { list?.scrollToIndex(index, false); }
</script>
<List bind:this={list} {items} rowHeight={rowHeight ?? undefined} rowHeights={heightOf} {horizontal} {recycle} {initialScrollIndex} keyOf={(item) => item.id} onEndReached={onEnd} onViewableItemsChanged={onViewable as never}>
  {#snippet row(item)}<native-text data-id={item.id}>{item.label}</native-text>{/snippet}
  {#snippet empty()}<native-text data-id="empty">none</native-text>{/snippet}
</List>
