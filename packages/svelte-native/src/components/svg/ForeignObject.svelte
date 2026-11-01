<script lang="ts">
  import type { Snippet } from "svelte";
  import type {} from "../../elements.d.ts";
  import { createNativeProps } from "../../native-props.ts";
  import { foreignObjectNativeProps } from "../../fabric/foreign-svg.ts";
  import { handleRef, type SvgExtras } from "./handle.ts";
  import type { ForeignObjectProps } from "react-native-svg";

  /** `react-native-svg`'s `ForeignObject`: its children are not SVG elements but views (`View`, `Text`, ...) that the native `ForeignObject` places at `x`, `y`, `width`, `height`. Views inside it are mounted by React Native, as everything inside an `Svg` is on Android. */
  let { children, ref, animatedProps, ...props }: Omit<ForeignObjectProps, "children"> & { children?: Snippet } & SvgExtras = $props();
  const resolveProps = createNativeProps();
  const hostRef = $derived(handleRef(ref, { matrix: true }));
  const native = $derived(foreignObjectNativeProps(props));
</script>
<native-foreign component="RNSVGForeignObject" nativeProps={resolveProps({ ...native, ...(animatedProps ? { animatedProps } : null), ref: hostRef })}>{@render children?.()}</native-foreign>
