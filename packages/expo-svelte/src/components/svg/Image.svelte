<script lang="ts">
  import type {} from "../../elements.d.ts";
  import { createNativeProps } from "../../native-props.ts";
  import { imageNativeProps } from "../../fabric/foreign-svg.ts";
  import { handleRef, type SvgExtras } from "./handle.ts";
  import type { ImageProps } from "#vendor/react-native-svg";

  /** `react-native-svg`'s `Image`: `href` is a URI or an asset number (`require`), drawn into `x`, `y`, `width`, `height` by `preserveAspectRatio`. `onLoad` is the native image's. */
  let { ref, animatedProps, ...props }: ImageProps & SvgExtras = $props();
  const resolveProps = createNativeProps();
  const hostRef = $derived(handleRef(ref));
  const native = $derived(imageNativeProps(props));
</script>
<native-foreign component="RNSVGImage" nativeProps={resolveProps({ ...native, ...(animatedProps ? { animatedProps } : null), ref: hostRef })}></native-foreign>
