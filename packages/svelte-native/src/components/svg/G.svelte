<script lang="ts">
  import type { Snippet } from "svelte";
  import type {} from "../../elements.d.ts";
  import { createNativeProps } from "../../native-props.ts";
  import { groupNativeProps } from "../../fabric/foreign-svg.ts";
  import { handleRef, type SvgExtras } from "./handle.ts";
  import type { GProps } from "react-native-svg";

  /** `react-native-svg`'s `G`: a group. Its fill, stroke and font props are inherited by its children; `transform`, `opacity`, `clipPath` and `mask` apply to the group. */
  let { children, ref, animatedProps, ...props }: Omit<GProps, "children"> & { children?: Snippet } & SvgExtras = $props();
  const resolveProps = createNativeProps();
  const hostRef = handleRef(() => ref, { matrix: true });
  const native = $derived(groupNativeProps(props));
</script>
<native-foreign component="RNSVGGroup" nativeProps={resolveProps({ ...native, ...(animatedProps ? { animatedProps } : null), ref: hostRef })}>{@render children?.()}</native-foreign>
