<script>
  import { windowSize } from "../src/window-size.ts";
  import { devicePixelRatio, innerWidth, scrollY } from "../src/reactivity-window.ts";
  let { readers = 1 } = $props();
  const indexes = $derived(Array.from({ length: readers }, (_, index) => index));
  const wide = $derived(windowSize.width >= 768);
</script>
{#each indexes as index (index)}
  <native-view testID={`${index}:${windowSize.width}x${windowSize.height}:${wide ? "wide" : "narrow"}:${innerWidth.current}:${devicePixelRatio.current}:${scrollY.current}`}></native-view>
{/each}
