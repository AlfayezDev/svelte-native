<script lang="ts">
  import type { Snippet } from "svelte";
  import type { PressConfig } from "../elements.d.ts";
  import type { ClassProps } from "../classes.ts";
  import { createNativeProps } from "../native-props.ts";
  import type { TextProps } from "react-native";
  import type { GestureProps } from "../gestures/types.ts";
  let { children, ...attributes }: Omit<TextProps, "children"> & PressConfig & GestureProps & { children?: Snippet } & ClassProps = $props();
  const resolveProps = createNativeProps();
</script>
<native-text nativeProps={resolveProps(attributes)}>{@render children?.()}</native-text>
