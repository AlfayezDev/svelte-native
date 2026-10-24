<script lang="ts">
  import type { Snippet } from "svelte";
  import type { PressableProps } from "react-native";
  import Host from "./Host.svelte";
  let { children, ...attributes }: Omit<PressableProps, "children"> & { children?: Snippet } = $props();
</script>
<Host name="native-pressable" {attributes}>{@render children?.()}</Host>
