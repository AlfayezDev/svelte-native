<script lang="ts">
  import type { Snippet } from "svelte";
  import type { SafeAreaViewProps } from "react-native-safe-area-context";
  import Host from "./Host.svelte";
  let { children, ...attributes }: Omit<SafeAreaViewProps, "children"> & { children?: Snippet } = $props();
</script>
<Host name="native-safe-area" {attributes}>{@render children?.()}</Host>
