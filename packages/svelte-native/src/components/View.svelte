<script lang="ts">
  import type { Snippet } from "svelte";
  import type { ViewProps } from "react-native";
  import Host from "./Host.svelte";
  let { children, ...attributes }: Omit<ViewProps, "children"> & { children?: Snippet } = $props();
</script>
<Host name="native-view" {attributes}>{@render children?.()}</Host>
