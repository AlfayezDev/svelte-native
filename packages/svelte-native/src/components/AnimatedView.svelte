<script lang="ts">
  import type { Snippet } from "svelte";
  import type { NativeAnimatedViewProps } from "../animated-host.ts";
  import Host from "./Host.svelte";
  let { children, ...attributes }: Omit<NativeAnimatedViewProps, "children"> & { children?: Snippet } = $props();
</script>
<Host name="native-animated-view" {attributes}>{@render children?.()}</Host>
