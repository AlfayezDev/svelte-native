<script>
  import AnimateableText from "../../../src/components/AnimateableText.svelte";
  import View from "../../../src/components/View.svelte";
  const count = { value: 3, _isReanimatedSharedValue: true };
  const label = () => ({ text: `count ${count.value}` });
  let shown = $state(true);
  let size = $state(14);
  let handle = null;
  export function hide() { shown = false; }
  export function resize(next) { size = next; }
  export function count_() { return count; }
  export function textHandle() { return handle; }
</script>
<View>
  {#if shown}
    <AnimateableText text="static" animatedProps={label} numberOfLines={2} selectionColor="#ff0000" style={{ fontSize: size }} ref={(h) => { handle = h; }} />
  {/if}
  <AnimateableText text="plain" />
</View>
