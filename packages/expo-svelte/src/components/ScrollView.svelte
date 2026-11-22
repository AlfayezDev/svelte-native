<script lang="ts">
  import type { Snippet } from "svelte";
  import type {} from "../elements.d.ts";
  import type { ClassProps } from "../classes.ts";
  import { createNativeProps } from "../native-props.ts";
  import type { ScrollViewInstance as NativeScrollView, ScrollViewProps } from "react-native";
  import type { HostHandle } from "../fabric/host.ts";
  import type { GestureProps } from "../gestures/types.ts";
  let { children, ref, ...attributes }: Omit<ScrollViewProps, "children"> & GestureProps & {
    children?: Snippet;
    /** Receives the host handle: React Native's ScrollView instance (`scrollTo`, `scrollToEnd`, `measure`) plus `dispatchCommand`, or null on unmount. */
    ref?: (instance: (NativeScrollView & Pick<HostHandle, "dispatchCommand">) | null) => void;
  } & ClassProps = $props();
  const resolveProps = createNativeProps();
</script>
<native-scroll nativeProps={resolveProps({ ...attributes, ref })}>{@render children?.()}</native-scroll>
