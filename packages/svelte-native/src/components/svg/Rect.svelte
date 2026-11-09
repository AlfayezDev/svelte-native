<script lang="ts">
  import type {} from "../../elements.d.ts";
  import { createNativeProps } from "../../native-props.ts";
  import { rectNativeProps } from "../../fabric/foreign-svg.ts";
  import { handleRef, type SvgExtras } from "./handle.ts";
  import type { RectProps } from "react-native-svg";

  /** `react-native-svg`'s `Rect`: `x`, `y`, `width`, `height`, `rx`, `ry`. */
  let { ref, animatedProps, ...props }: RectProps & SvgExtras = $props();
  const resolveProps = createNativeProps();
  const hostRef = $derived(handleRef(ref));
  const native = $derived(rectNativeProps(props));
</script>
<native-foreign component="RNSVGRect" nativeProps={resolveProps({ ...native, ...(animatedProps ? { animatedProps } : null), ref: hostRef })}></native-foreign>
