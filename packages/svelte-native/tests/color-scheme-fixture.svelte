<script>
  import { colorScheme } from "../src/color-scheme.ts";
  let { readers = 1 } = $props();
  const indexes = $derived(Array.from({ length: readers }, (_, index) => index));
</script>
{#each indexes as index (index)}
  <native-view testID={`${index}:${colorScheme.current}`}></native-view>
{/each}
