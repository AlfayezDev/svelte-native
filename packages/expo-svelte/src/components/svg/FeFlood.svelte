<script lang="ts">
  import type {} from "../../elements.d.ts";
  import { createNativeProps } from "../../native-props.ts";
  import { feFloodNativeProps } from "../../fabric/foreign-svg.ts";
  import { handleRef, type SvgExtras } from "./handle.ts";
  import type { FeFloodProps, FilterPrimitiveCommonProps } from "#vendor/react-native-svg";

  /** `react-native-svg`'s `FeFlood`: fills the filter region with `floodColor` at `floodOpacity`. */
  let { ref, animatedProps, ...props }: FeFloodProps & FilterPrimitiveCommonProps & SvgExtras = $props();
  const resolveProps = createNativeProps();
  const hostRef = $derived(handleRef(ref));
  const native = $derived(feFloodNativeProps(props));
</script>
<native-foreign component="RNSVGFeFlood" nativeProps={resolveProps({ ...native, ...(animatedProps ? { animatedProps } : null), ref: hostRef })}></native-foreign>
