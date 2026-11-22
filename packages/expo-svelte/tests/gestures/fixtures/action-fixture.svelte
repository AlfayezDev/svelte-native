<script>
  // `use:gesture` on a lowered View: the action follows its parameter and removes the attribute when the element goes.
  import { View, gesture } from "expo-svelte";
  let { first } = $props();
  let current = $state.raw(first);
  let shown = $state(true);
  export function use(next) { current = next; }
  export function hide() { shown = false; }
</script>
{#if shown}<View testID="action" use:gesture={current} />{/if}
