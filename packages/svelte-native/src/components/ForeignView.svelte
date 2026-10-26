<script lang="ts">
  import type { Snippet } from "svelte";
  import type {} from "../elements.d.ts";
  import { createNativeProps } from "../native-props.ts";
  import type { ViewProps } from "react-native";
  /**
   * A component another library mounts, by its Fabric component name (SPEC.md, "Foreign views"). Every other prop is
   * the component's own (`fabric/view-configs.ts` lists what a name takes); children are mounted by the same library.
   */
  let { component, children, ref, ...attributes }: Omit<ViewProps, "children"> & {
    component: string;
    children?: Snippet;
    /** Receives the host handle (`tag`, `measure`, `dispatchCommand`, ...), or null on unmount. */
    ref?: (handle: unknown) => void;
    [prop: string]: unknown;
  } = $props();
  const resolveProps = createNativeProps();
</script>
<!-- A node keeps the native view it was created for, so another component name is another node. -->
{#key component}<native-foreign {component} nativeProps={resolveProps({ ...attributes, ref })}>{@render children?.()}</native-foreign>{/key}
