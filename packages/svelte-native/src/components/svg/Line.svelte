<script lang="ts">
  import type {} from "../../elements.d.ts";
  import { createNativeProps } from "../../native-props.ts";
  import { lineNativeProps } from "../../fabric/foreign-svg.ts";
  import { handleRef, type SvgExtras } from "./handle.ts";
  import type { LineProps } from "react-native-svg";

  /** `react-native-svg`'s `Line`: `x1`, `y1`, `x2`, `y2`. */
  let { ref, animatedProps, ...props }: LineProps & SvgExtras = $props();
  const resolveProps = createNativeProps();
  const hostRef = handleRef(() => ref);
  const native = $derived(lineNativeProps(props));
</script>
<native-foreign component="RNSVGLine" nativeProps={resolveProps({ ...native, animatedProps, ref: hostRef })}></native-foreign>
