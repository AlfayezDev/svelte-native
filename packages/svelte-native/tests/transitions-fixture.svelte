<script>
  import { blur, crossfade, draw, fade, fly, slide } from "svelte/transition";
  import { flip } from "svelte/animate";
  let intro = $state(false);
  let outro = $state(true);
  let reversible = $state(false);
  let blurred = $state(false);
  let items = $state([1, 2, 3]);
  let rows = $state([1, 2, 3]);
  let slid = $state(false);
  let sliding = $state(false);
  let drawing = $state(false);
  let delayed = $state(false);
  let left = $state([1, 2, 3]);
  let right = $state([]);
  let events = $state([]);
  const [send, receive] = crossfade({ duration: 200, fallback: (node) => fade(node, { duration: 100 }) });
  export function setIntro(value) { intro = value; }
  export function setOutro(value) { outro = value; }
  export function setReversible(value) { reversible = value; }
  export function setBlurred(value) { blurred = value; }
  export function setItems(value) { items = value; }
  export function setRows(value) { rows = value; }
  export function setSlid(value) { slid = value; }
  export function setSliding(value) { sliding = value; }
  export function setDrawing(value) { drawing = value; }
  export function setDelayed(value) { delayed = value; }
  export function setLists(a, b) { left = a; right = b; }
  export function seen() { return events; }
</script>
{#if intro}
  <native-view testID="intro" in:fly={{ y: 20, duration: 200 }} onintrostart={() => events.push("introstart")} onintroend={() => events.push("introend")}></native-view>
{/if}
{#if outro}
  <native-view testID="outro" out:fade={{ duration: 100 }} nativeStyle={{ opacity: 0.8, padding: 2 }}></native-view>
{/if}
{#if reversible}
  <native-view testID="reversible" transition:fade={{ duration: 1000 }}></native-view>
{/if}
{#if blurred}
  <native-view testID="blurred" in:blur={{ duration: 100, amount: 4 }}></native-view>
{/if}
{#if slid}
  <native-view testID="slid" transition:slide={{ duration: 100 }} nativeStyle={{ padding: 4 }}></native-view>
{/if}
{#if sliding}
  <native-view testID="sliding" out:slide={{ duration: 100 }} nativeStyle={{ padding: 4, margin: 2, borderWidth: 1 }}></native-view>
{/if}
{#if drawing}
  <native-view testID="drawing" in:draw={{ duration: 100 }}></native-view>
{/if}
{#if delayed}
  <native-view testID="delayed" in:fly={{ y: 20, delay: 120, duration: 100 }}></native-view>
{/if}
<native-view testID="rows">
  {#each rows as row (row)}
    <native-view testID={`row-${row}`} animate:flip={{ duration: 300 }} out:fade={{ duration: 100 }}></native-view>
  {/each}
</native-view>
<native-view testID="list">
  {#each items as item (item)}
    <native-view testID={`item-${item}`} animate:flip={{ duration: 300 }}></native-view>
  {/each}
</native-view>
<native-view testID="left">
  {#each left as item (item)}
    <native-view testID={`left-${item}`} in:receive={{ key: item }} out:send={{ key: item }} animate:flip={{ duration: 300 }}></native-view>
  {/each}
</native-view>
<native-view testID="right">
  {#each right as item (item)}
    <native-view testID={`right-${item}`} in:receive={{ key: item }} out:send={{ key: item }} animate:flip={{ duration: 300 }}></native-view>
  {/each}
</native-view>
<native-view testID="shifted" nativeStyle={{ transform: [{ translateY: 10 }] }}>
  <native-view testID="inner" nativeStyle={{ transform: [{ translateX: 3 }], backgroundColor: "#336699", borderRadius: 6 }}></native-view>
</native-view>
