<script lang="ts">
  import type { Snippet } from "svelte";
  import type {} from "../../elements.d.ts";
  import { createNativeProps } from "../../native-props.ts";
  import { maskNativeProps } from "../../fabric/foreign-svg.ts";
  import { handleRef, type SvgExtras } from "./handle.ts";
  import type { MaskProps } from "#vendor/react-native-svg";

  /** `react-native-svg`'s `Mask`: its children's luminance (or alpha, `maskType="alpha"`) hides what `mask="url(#id)"` names. */
  let { children, ref, animatedProps, ...props }: Omit<MaskProps, "children"> & { children?: Snippet } & SvgExtras = $props();
  const resolveProps = createNativeProps();
  const hostRef = $derived(handleRef(ref));
  const native = $derived(maskNativeProps(props));
</script>
<native-foreign component="RNSVGMask" nativeProps={resolveProps({ ...native, ...(animatedProps ? { animatedProps } : null), ref: hostRef })}>{@render children?.()}</native-foreign>
