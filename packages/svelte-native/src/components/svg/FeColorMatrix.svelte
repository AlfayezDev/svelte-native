<script lang="ts">
  import type {} from "../../elements.d.ts";
  import { createNativeProps } from "../../native-props.ts";
  import { feColorMatrixNativeProps } from "../../fabric/foreign-svg.ts";
  import { handleRef, type SvgExtras } from "./handle.ts";
  import type { FeColorMatrixProps, FilterPrimitiveCommonProps } from "react-native-svg";

  /** `react-native-svg`'s `FeColorMatrix`: `type` (`matrix`, `saturate`, `hueRotate`, `luminanceToAlpha`) and `values`. */
  let { ref, animatedProps, ...props }: FeColorMatrixProps & FilterPrimitiveCommonProps & SvgExtras = $props();
  const resolveProps = createNativeProps();
  const hostRef = handleRef(() => ref);
  const native = $derived(feColorMatrixNativeProps(props));
</script>
<native-foreign component="RNSVGFeColorMatrix" nativeProps={resolveProps({ ...native, animatedProps, ref: hostRef })}></native-foreign>
