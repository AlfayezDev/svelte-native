<script lang="ts">
  import { onMount } from "svelte";
  // What an app writes for an input that is focused when it appears: the handle has to be there when `onMount` runs.
  let el = $state<{ focus(): void } | null>(null);
  let area = $state<{ focus(): void } | null>(null);
  onMount(() => {
    (globalThis as unknown as { __focused: string[] }).__focused.push(`input ${el !== null}`, `div ${area !== null}`);
    el?.focus();
    area?.focus();
  });
</script>
<input testID="late" bind:this={el} />
<div testID="late-div" bind:this={area}>x</div>
