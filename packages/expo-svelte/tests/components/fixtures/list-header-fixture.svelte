<script lang="ts">
  import List from "../../../src/components/List.svelte";
  let { count = 30, initialScrollIndex }: { count?: number; initialScrollIndex?: number } = $props();
  // The rows may arrive after the first layout (`setCount`), the index may be set later (`setInitial`), and the header may go (`setHeader`).
  let override = $state<number | null>(null);
  const total = $derived(override ?? count);
  export function setCount(next: number) { override = next; }
  let initial = $state<number | undefined>(undefined);
  let initialChanged = $state(false);
  export function setInitial(next: number | undefined) { initial = next; initialChanged = true; }
  let showHeader = $state(true);
  export function setHeader(on: boolean) { showHeader = on; }
  const items = $derived(Array.from({ length: total }, (_, id) => ({ id })));
  let list: { scrollToOffset: (offset: number, animated?: boolean) => void; scrollToIndex: (index: number, animated?: boolean) => void } | undefined = $state();
  export function scrollToOffset(offset: number) { list?.scrollToOffset(offset, false); }
  export function scrollToIndex(index: number) { list?.scrollToIndex(index, false); }
  // A request made where a write of state is refused: inside a derived.
  let ask = $state(false);
  const asked = $derived.by(() => { if (ask) list?.scrollToOffset(200, false); return ask; });
  export function askFromDerived() { ask = true; return asked; }
  // What the app hears: the batches of viewable keys, and how often the list says it reached its end.
  const batches: string[][] = [];
  let ends = 0;
  export function viewedBatches() { return batches; }
  export function endsReached() { return ends; }
</script>

{#snippet headerRow()}<native-text data-id="header" testID="header">Order history</native-text>{/snippet}
<List bind:this={list} {items} keyOf={(item) => item.id} rowHeight={40} initialScrollIndex={initialChanged ? initial : initialScrollIndex} header={showHeader ? headerRow : undefined}
  onViewableItemsChanged={(info) => { batches.push(info.viewableItems.map((entry) => String(entry.key))); }} onEndReached={() => { ends++; }} style={{ height: 120 }}>
  {#snippet row(item)}<native-text data-id={`r${item.id}`} testID={`r${item.id}`}>Order {item.id}</native-text>{/snippet}
</List>
