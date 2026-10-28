<script lang="ts">
  import type {} from "../../elements.d.ts";
  import { createNativeProps } from "../../native-props.ts";
  import { feGaussianBlurNativeProps } from "../../fabric/foreign-svg.ts";
  import { handleRef, type SvgExtras } from "./handle.ts";
  import type { FeGaussianBlurProps, FilterPrimitiveCommonProps } from "react-native-svg";

  /** `react-native-svg`'s `FeGaussianBlur`: blurs `in` by `stdDeviation` (one number, or two for x and y). */
  let { ref, animatedProps, ...props }: FeGaussianBlurProps & FilterPrimitiveCommonProps & SvgExtras = $props();
  const resolveProps = createNativeProps();
  const hostRef = handleRef(() => ref);
  const native = $derived(feGaussianBlurNativeProps(props));
</script>
<native-foreign component="RNSVGFeGaussianBlur" nativeProps={resolveProps({ ...native, ...(animatedProps ? { animatedProps } : null), ref: hostRef })}></native-foreign>
