<script lang="ts">
  import type { Snippet } from "svelte";
  import type {} from "../elements.d.ts";
  import type { ViewProps } from "react-native";
  import { mergeClass, type ClassProps } from "../classes.ts";
  import { createNativeProps } from "../native-props.ts";
  import { safeAreaStyle, type Edge } from "../fabric/insets.ts";
  import { connectInsets, insets } from "../insets.svelte.ts";
  /** A plain view padded by the insets store on the selected `edges` (default all). */
  let { children, edges, ...attributes }: Omit<ViewProps, "children"> & { children?: Snippet; edges?: readonly Edge[] } & ClassProps = $props();
  connectInsets();
  const resolveProps = createNativeProps();
  // The padding of the classes counts like the style's: the insets are added to it.
  const nativeProps = $derived.by(() => {
    const { style, ...rest } = mergeClass(attributes);
    return resolveProps({ ...rest, style: safeAreaStyle(style, insets, edges) });
  });
</script>
<native-safe-area {nativeProps}>{@render children?.()}</native-safe-area>
