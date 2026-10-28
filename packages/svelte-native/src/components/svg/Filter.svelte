<script lang="ts">
  import type { Snippet } from "svelte";
  import type {} from "../../elements.d.ts";
  import { createNativeProps } from "../../native-props.ts";
  import { filterNativeProps } from "../../fabric/foreign-svg.ts";
  import { handleRef, type SvgExtras } from "./handle.ts";
  import type { FilterProps } from "react-native-svg";

  /** `react-native-svg`'s `Filter`: its primitives (`FeGaussianBlur`, `FeOffset`, `FeColorMatrix`, ...) are its children; `filter="url(#id)"` applies it. */
  let { children, ref, animatedProps, ...props }: Omit<FilterProps, "children"> & { children?: Snippet } & SvgExtras = $props();
  const resolveProps = createNativeProps();
  const hostRef = handleRef(() => ref);
  const native = $derived(filterNativeProps(props));
</script>
<native-foreign component="RNSVGFilter" nativeProps={resolveProps({ ...native, animatedProps, ref: hostRef })}>{@render children?.()}</native-foreign>
