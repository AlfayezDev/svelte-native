<script lang="ts">
  import type { Snippet } from "svelte";
  import type { PressHandlers } from "../elements.d.ts";
  import type { HostHandle } from "../fabric/host.ts";
  import { createNativeProps } from "../native-props.ts";
  import type { ViewProps } from "react-native";
  import type { GestureProps } from "../gestures/types.ts";
  let { children, ref, ...attributes }: Omit<ViewProps, "children"> & PressHandlers & GestureProps & {
    children?: Snippet;
    /** Receives the host handle (`HostHandle` in `fabric/host.ts`: `tag`, `measure`, `measureInWindow`, `dispatchCommand`, ...), or null on unmount. */
    ref?: (handle: HostHandle | null) => void;
  } = $props();
  const resolveProps = createNativeProps();
</script>
<native-view nativeProps={resolveProps({ ...attributes, ref })}>{@render children?.()}</native-view>
