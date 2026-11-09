<script lang="ts">
  // Spike-only primitive: explicit props instead of a rest-props proxy, to measure the proxy's share of the component cost.
  import type { Snippet } from "svelte";
  import type { LayoutChangeEvent, ViewStyle } from "react-native";
  let { style, onLayout, children }: { style?: ViewStyle; onLayout?: (event: LayoutChangeEvent) => void; children?: Snippet } = $props();
</script>
<native-view nativeProps={{ style, onLayout }}>{@render children?.()}</native-view>
