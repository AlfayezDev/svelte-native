<script>
  import Child from "./parity-child.svelte";
  let { log } = $props();
  let n = $state(0);
  let flag = $state(false);
  let list = $state([{ id: "a" }, { id: "b" }, { id: "c" }]);
  let echoed = $state(0);
  const doubled = $derived(n * 2);
  $effect.pre(() => { log.push(`root: pre n=${n}`); });
  $effect(() => { log.push(`root: effect n=${n} flag=${flag} doubled=${doubled}`); });
  // An effect that writes state the template reads: the second pass of the flush.
  $effect(() => { if (n >= 3) echoed = n; });
  export function bump() { n++; }
  export function bumpTwice() { n++; n++; }
  export function toggle() { flag = !flag; }
  export function reverse() { list = [...list].reverse(); }
  export function removeFirst() { list = list.slice(1); }
  export function add(id) { list = [...list, { id }]; }
  export function replaceAll() { list = [{ id: "x" }, { id: "y" }]; }
  export function rename() { list[0].id = list[0].id; n++; flag = !flag; }
  export function batch() { n++; flag = !flag; list = [...list, { id: `n${n}` }]; list = list.slice(1); }
</script>
{#snippet label(text)}<native-text>{text}</native-text>{/snippet}
<native-view testID="root">
  {@render label(`n=${n} doubled=${doubled} echoed=${echoed}`)}
  {#if flag}
    <Child id="if-true" {log} {n} />
  {:else if n > 2}
    <Child id="if-else" {log} {n} />
  {:else}
    <native-text>plain</native-text>
  {/if}
  {#each list as item, index (item.id)}
    <native-view testID="row-{item.id}">{@render label(`${index}:${item.id}`)}<Child id={item.id} {log} {n} /></native-view>
  {:else}
    <native-text>empty</native-text>
  {/each}
  {#key flag}<Child id="key-{flag}" {log} {n} />{/key}
</native-view>
