<script lang="ts">
  import type { Snippet } from "svelte";
  import type {} from "../../elements.d.ts";
  import { createNativeProps } from "../../native-props.ts";
  import { tspanProps } from "../../fabric/foreign-svg.ts";
  import { handleRef, type SvgExtras } from "./handle.ts";
  import type { TSpanProps } from "react-native-svg";

  /**
   * `react-native-svg`'s `TSpan`: a run of text with its own position (`x`, `y`, `dx`, `dy`, `rotate`) and font. A lone string between its tags is its
   * `content` (the host sets it, `foreign-text.ts`); with other children, each string becomes a `TSpan` of its own.
   */
  let { children, ref, animatedProps, childrenAsArray, ...props }: Omit<TSpanProps, "children"> & {
    children?: Snippet;
    /** @internal `SvgXml` sets it: the library's XML renderer gives a `TSpan` an array of children even for one string, so the string is a span of its own and not the `content`. */
    childrenAsArray?: boolean;
  } & SvgExtras = $props();
  const resolveProps = createNativeProps();
  const hostRef = $derived(handleRef(ref, { matrix: true }));
  const native = $derived(tspanProps(props));
</script>
<native-foreign component="RNSVGTSpan" nativeProps={resolveProps({ ...native, ...(animatedProps ? { animatedProps } : null), childrenAsArray, ref: hostRef })}>{@render children?.()}</native-foreign>
