<script lang="ts">
  import type {} from "../../elements.d.ts";
  import { createNativeProps } from "../../native-props.ts";
  import { feOffsetNativeProps } from "../../fabric/foreign-svg.ts";
  import { handleRef, type SvgExtras } from "./handle.ts";
  import type { FeOffsetProps, FilterPrimitiveCommonProps } from "react-native-svg";

  /** `react-native-svg`'s `FeOffset`: moves `in` by `dx`, `dy`. */
  let { ref, animatedProps, ...props }: FeOffsetProps & FilterPrimitiveCommonProps & SvgExtras = $props();
  const resolveProps = createNativeProps();
  const hostRef = $derived(handleRef(ref));
  const native = $derived(feOffsetNativeProps(props));
</script>
<native-foreign component="RNSVGFeOffset" nativeProps={resolveProps({ ...native, ...(animatedProps ? { animatedProps } : null), ref: hostRef })}></native-foreign>
