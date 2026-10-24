<script lang="ts">
  import type { Snippet } from "svelte";
  import type { ScrollViewProps } from "react-native";
  import Host from "./Host.svelte";
  let { children, ...attributes }: Omit<ScrollViewProps, "children"> & { children?: Snippet } = $props();
</script>
<Host name="native-scroll" {attributes}>{@render children?.()}</Host>
