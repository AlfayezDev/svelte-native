<script lang="ts">
  import type {} from "../../elements.d.ts";
  import { createNativeProps } from "../../native-props.ts";
  import { feCompositeNativeProps } from "../../fabric/foreign-svg.ts";
  import { handleRef, type SvgExtras } from "./handle.ts";
  import type { FeCompositeProps, FilterPrimitiveCommonProps } from "react-native-svg";

  /** `react-native-svg`'s `FeComposite`: combines `in` and `in2` by `operator` (`over`, `in`, `out`, `atop`, `xor`, `arithmetic` with `k1`..`k4`). */
  let { ref, animatedProps, ...props }: FeCompositeProps & FilterPrimitiveCommonProps & SvgExtras = $props();
  const resolveProps = createNativeProps();
  const hostRef = handleRef(() => ref);
  const native = $derived(feCompositeNativeProps(props));
</script>
<native-foreign component="RNSVGFeComposite" nativeProps={resolveProps({ ...native, ...(animatedProps ? { animatedProps } : null), ref: hostRef })}></native-foreign>
