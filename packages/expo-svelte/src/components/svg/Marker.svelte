<script lang="ts">
  import type { Snippet } from "svelte";
  import type {} from "../../elements.d.ts";
  import { createNativeProps } from "../../native-props.ts";
  import { markerNativeProps } from "../../fabric/foreign-svg.ts";
  import { handleRef, type SvgExtras } from "./handle.ts";
  import type { MarkerProps } from "#vendor/react-native-svg";

  /** `react-native-svg`'s `Marker`: a shape drawn at the vertices of a `Path` or `Line` that names it in `markerStart`, `markerMid`, `markerEnd` or `marker`. */
  let { children, ref, animatedProps, ...props }: Omit<MarkerProps, "children"> & { children?: Snippet } & SvgExtras = $props();
  const resolveProps = createNativeProps();
  const hostRef = $derived(handleRef(ref));
  const native = $derived(markerNativeProps(props));
</script>
<native-foreign component="RNSVGMarker" nativeProps={resolveProps({ ...native, ...(animatedProps ? { animatedProps } : null), ref: hostRef })}>{@render children?.()}</native-foreign>
