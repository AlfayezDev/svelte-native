<script lang="ts">
  import type { Snippet } from "svelte";
  import type {} from "../elements.d.ts";
  import { createNativeProps } from "../native-props.ts";
  import type { ViewProps } from "react-native";
  import type { GestureAttribute } from "../gestures/types.ts";
  let { children, ref, gesture, ...attributes }: Omit<ViewProps, "children"> & {
    children?: Snippet;
    /** The gesture to recognise on this view; what `Gesture.Pan()`, `Gesture.Race(...)`, ... return. */
    gesture: GestureAttribute;
    /** Receives the host handle (`HostHandle` in `fabric/host.ts`), or null on unmount. */
    ref?: (handle: unknown) => void;
  } = $props();
  const required = (value: GestureAttribute | undefined): GestureAttribute => {
    if (!value) throw new Error("GestureDetector must have a gesture prop provided.");
    return value;
  };
  const resolveProps = createNativeProps();
</script>
<!-- One view of its own, styled like a View: the gesture needs a native view with a tag (collapsable is forced to false by the gesture host). Put the gesture on a View, Pressable, Image, Text, ScrollView or AnimatedView directly when the extra view is not wanted. -->
<native-view nativeProps={resolveProps({ ...attributes, ref, gesture: required(gesture) })}>{@render children?.()}</native-view>
