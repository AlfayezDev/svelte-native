<script lang="ts">
  import type {} from "../../elements.d.ts";
  import { createNativeProps } from "../../native-props.ts";
  import { pathNativeProps } from "../../fabric/foreign-svg.ts";
  import { handleRef, type SvgExtras } from "./handle.ts";
  import type { PathProps } from "react-native-svg";

  /** The outline `d` (SVG path data) of `react-native-svg`'s `Path`, drawn with the library's `fill`, `stroke` and transform props. */
  let { ref, animatedProps, ...props }: PathProps & SvgExtras = $props();
  const resolveProps = createNativeProps();
  const hostRef = $derived(handleRef(ref));
  const native = $derived(pathNativeProps(props));
</script>
<native-foreign component="RNSVGPath" nativeProps={resolveProps({ ...native, ...(animatedProps ? { animatedProps } : null), ref: hostRef })}></native-foreign>
