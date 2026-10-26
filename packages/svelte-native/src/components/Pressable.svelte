<script lang="ts">
  import type { Snippet } from "svelte";
  import type {} from "../elements.d.ts";
  import { createNativeProps } from "../native-props.ts";
  import type { PressableProps } from "react-native";
  let { children, ...attributes }: Omit<PressableProps, "children"> & { children?: Snippet } = $props();
  const resolveProps = createNativeProps();
</script>
<native-pressable nativeProps={resolveProps(attributes)}>{@render children?.()}</native-pressable>
