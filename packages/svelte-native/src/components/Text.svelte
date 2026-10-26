<script lang="ts">
  import type { Snippet } from "svelte";
  import type {} from "../elements.d.ts";
  import { createNativeProps } from "../native-props.ts";
  import type { TextProps } from "react-native";
  let { children, ...attributes }: Omit<TextProps, "children"> & { children?: Snippet } = $props();
  const resolveProps = createNativeProps();
</script>
<native-text nativeProps={resolveProps(attributes)}>{@render children?.()}</native-text>
