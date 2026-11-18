<script lang="ts">
  import type {} from "../../elements.d.ts";
  import { createNativeProps } from "../../native-props.ts";
  import { ellipseNativeProps } from "../../fabric/foreign-svg.ts";
  import { handleRef, type SvgExtras } from "./handle.ts";
  import type { EllipseProps } from "#vendor/react-native-svg";

  /** `react-native-svg`'s `Ellipse`: `cx`, `cy`, `rx`, `ry`. */
  let { ref, animatedProps, ...props }: EllipseProps & SvgExtras = $props();
  const resolveProps = createNativeProps();
  const hostRef = $derived(handleRef(ref));
  const native = $derived(ellipseNativeProps(props));
</script>
<native-foreign component="RNSVGEllipse" nativeProps={resolveProps({ ...native, ...(animatedProps ? { animatedProps } : null), ref: hostRef })}></native-foreign>
