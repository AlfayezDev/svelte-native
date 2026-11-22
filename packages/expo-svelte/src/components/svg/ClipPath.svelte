<script lang="ts">
  import type { Snippet } from "svelte";
  import type {} from "../../elements.d.ts";
  import { createNativeProps } from "../../native-props.ts";
  import { clipPathNativeProps } from "../../fabric/foreign-svg.ts";
  import { handleRef, type SvgExtras } from "./handle.ts";
  import type { ClipPathProps } from "#vendor/react-native-svg";

  /** `react-native-svg`'s `ClipPath`: a definition with an `id` whose children clip the elements that name it (`clipPath="url(#id)"`). */
  let { children, ref, animatedProps, ...props }: Omit<ClipPathProps, "children"> & { children?: Snippet } & SvgExtras = $props();
  const resolveProps = createNativeProps();
  const hostRef = $derived(handleRef(ref));
  const native = $derived(clipPathNativeProps(props));
</script>
<native-foreign component="RNSVGClipPath" nativeProps={resolveProps({ ...native, ...(animatedProps ? { animatedProps } : null), ref: hostRef })}>{@render children?.()}</native-foreign>
