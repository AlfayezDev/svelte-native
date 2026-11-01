<script lang="ts">
  import type { Snippet } from "svelte";
  import type {} from "../elements.d.ts";
  import { createNativeProps } from "../native-props.ts";
  import type { ViewProps } from "react-native";
  import type { GestureProps } from "../gestures/types.ts";
  let { children, ref, ...attributes }: Omit<ViewProps, "children"> & GestureProps & {
    children?: Snippet;
    /** Receives the host handle (`HostHandle` in `fabric/host.ts`: `tag`, `measure`, `measureInWindow`, `dispatchCommand`, ...), or null on unmount. */
    ref?: (handle: unknown) => void;
  } = $props();
  const resolveProps = createNativeProps();
</script>
<native-view nativeProps={resolveProps({ ...attributes, ref })}>{@render children?.()}</native-view>
