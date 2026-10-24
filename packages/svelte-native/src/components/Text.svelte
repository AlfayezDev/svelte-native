<script lang="ts">
  import type { Snippet } from "svelte";
  import type { TextProps } from "react-native";
  import Host from "./Host.svelte";
  let { children, ...attributes }: Omit<TextProps, "children"> & { children?: Snippet } = $props();
</script>
<Host name="native-text" {attributes}>{@render children?.()}</Host>
