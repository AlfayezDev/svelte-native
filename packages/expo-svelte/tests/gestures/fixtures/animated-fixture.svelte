<script>
  // A node that animates and carries a gesture: both layers see it, and neither leaks the other's attribute into the payload.
  let { gesture, shown = true } = $props();
  const slide = () => ({ opacity: 0.5 });
</script>
{#if shown}
  <native-animated-view testID="both" gesture={gesture} animatedStyle={slide} nativeStyle={{ padding: 1 }}></native-animated-view>
{/if}
