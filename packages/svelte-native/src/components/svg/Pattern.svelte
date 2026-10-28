<script lang="ts">
  import type { Snippet } from "svelte";
  import type {} from "../../elements.d.ts";
  import { createNativeProps } from "../../native-props.ts";
  import { patternNativeProps } from "../../fabric/foreign-svg.ts";
  import { handleRef, type SvgExtras } from "./handle.ts";
  import type { PatternProps } from "react-native-svg";

  /** `react-native-svg`'s `Pattern`: a tile (`width` x `height` at `x`, `y`) of its children, named by `fill="url(#id)"`. */
  let { children, ref, animatedProps, ...props }: Omit<PatternProps, "children"> & { children?: Snippet } & SvgExtras = $props();
  const resolveProps = createNativeProps();
  const hostRef = handleRef(() => ref);
  const native = $derived(patternNativeProps(props));
</script>
<native-foreign component="RNSVGPattern" nativeProps={resolveProps({ ...native, animatedProps, ref: hostRef })}>{@render children?.()}</native-foreign>
