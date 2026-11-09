<script lang="ts">
  // Spike-only primitive: explicit props instead of a rest-props proxy.
  import type { Snippet } from "svelte";
  import type { TextStyle } from "react-native";
  let { style, children }: { style?: TextStyle; children?: Snippet } = $props();
</script>
<native-text nativeProps={{ style }}>{@render children?.()}</native-text>
