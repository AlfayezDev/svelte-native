<script lang="ts">
  import type {} from "../../elements.d.ts";
  import { createNativeProps } from "../../native-props.ts";
  import { feBlendNativeProps } from "../../fabric/foreign-svg.ts";
  import { handleRef, type SvgExtras } from "./handle.ts";
  import type { FeBlendProps, FilterPrimitiveCommonProps } from "#vendor/react-native-svg";

  /** `react-native-svg`'s `FeBlend`: blends `in` with `in2` by `mode` (`normal`, `multiply`, `screen`, `darken`, `lighten`). */
  let { ref, animatedProps, ...props }: FeBlendProps & FilterPrimitiveCommonProps & SvgExtras = $props();
  const resolveProps = createNativeProps();
  const hostRef = $derived(handleRef(ref));
  const native = $derived(feBlendNativeProps(props));
</script>
<native-foreign component="RNSVGFeBlend" nativeProps={resolveProps({ ...native, ...(animatedProps ? { animatedProps } : null), ref: hostRef })}></native-foreign>
