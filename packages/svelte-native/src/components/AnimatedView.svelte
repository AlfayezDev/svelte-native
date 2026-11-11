<script lang="ts">
  import type { Snippet } from "svelte";
  import type { NativeAnimatedViewProps } from "../elements.d.ts";
  import type { ClassProps } from "../classes.ts";
  import { createNativeProps } from "../native-props.ts";
  let { children, ...attributes }: Omit<NativeAnimatedViewProps, "children"> & { children?: Snippet } & ClassProps = $props();
  const resolveProps = createNativeProps();
</script>
<native-animated-view nativeProps={resolveProps(attributes)}>{@render children?.()}</native-animated-view>
