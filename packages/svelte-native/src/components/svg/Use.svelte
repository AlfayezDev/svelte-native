<script lang="ts">
  import type { Snippet } from "svelte";
  import type {} from "../../elements.d.ts";
  import { createNativeProps } from "../../native-props.ts";
  import { useNativeProps } from "../../fabric/foreign-svg.ts";
  import { handleRef, type SvgExtras } from "./handle.ts";
  import type { UseProps } from "react-native-svg";

  /** `react-native-svg`'s `Use`: draws the definition `href="#id"` (a `Symbol`, a shape or a group) at `x`, `y`; its children are drawn as the library draws them. */
  let { children, ref, animatedProps, ...props }: Omit<UseProps, "children"> & { children?: Snippet } & SvgExtras = $props();
  const resolveProps = createNativeProps();
  const hostRef = $derived(handleRef(ref));
  const native = $derived(useNativeProps(props));
</script>
<native-foreign component="RNSVGUse" nativeProps={resolveProps({ ...native, ...(animatedProps ? { animatedProps } : null), ref: hostRef })}>{@render children?.()}</native-foreign>
