<script lang="ts">
  import type { Snippet } from "svelte";
  import type {} from "../elements.d.ts";
  import { createNativeProps } from "../native-props.ts";
  import type { ScrollView as NativeScrollView, ScrollViewProps } from "react-native";
  let { children, ref, ...attributes }: Omit<ScrollViewProps, "children"> & {
    children?: Snippet;
    /** Receives the React Native ScrollView instance for `scrollTo` and friends. */
    ref?: (instance: NativeScrollView | null) => void;
  } = $props();
  const resolveProps = createNativeProps();
</script>
<native-scroll nativeProps={resolveProps({ ...attributes, ref })}>{@render children?.()}</native-scroll>
