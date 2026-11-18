<script lang="ts">
  import type {} from "../../elements.d.ts";
  import { createNativeProps } from "../../native-props.ts";
  import { circleNativeProps } from "../../fabric/foreign-svg.ts";
  import { handleRef, type SvgExtras } from "./handle.ts";
  import type { CircleProps } from "#vendor/react-native-svg";

  /** `react-native-svg`'s `Circle`: `cx`, `cy`, `r`. `animatedProps` (`() => { "worklet"; return { r: radius.value }; }`) animates them from a shared value on the UI thread. */
  let { ref, animatedProps, ...props }: CircleProps & SvgExtras = $props();
  const resolveProps = createNativeProps();
  const hostRef = $derived(handleRef(ref));
  const native = $derived(circleNativeProps(props));
</script>
<native-foreign component="RNSVGCircle" nativeProps={resolveProps({ ...native, ...(animatedProps ? { animatedProps } : null), ref: hostRef })}></native-foreign>
