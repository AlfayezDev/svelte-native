<script>
  import { blur, fade, fly, slide } from "svelte/transition";
  import { flip } from "svelte/animate";
  let intro = $state(false);
  let outro = $state(true);
  let reversible = $state(false);
  let blurred = $state(false);
  let items = $state([1, 2, 3]);
  let rows = $state([1, 2, 3]);
  let slid = $state(false);
  let events = $state([]);
  export function setIntro(value) { intro = value; }
  export function setOutro(value) { outro = value; }
  export function setReversible(value) { reversible = value; }
  export function setBlurred(value) { blurred = value; }
  export function setItems(value) { items = value; }
  export function setRows(value) { rows = value; }
  export function setSlid(value) { slid = value; }
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
