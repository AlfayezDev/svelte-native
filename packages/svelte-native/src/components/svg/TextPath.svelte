<script lang="ts">
  import type { Snippet } from "svelte";
  import type {} from "../../elements.d.ts";
  import { createNativeProps } from "../../native-props.ts";
  import { textPathNativeProps } from "../../fabric/foreign-svg.ts";
  import { handleRef, type SvgExtras } from "./handle.ts";
  import TSpan from "./TSpan.svelte";
  import type { TextPathProps } from "react-native-svg";

  /**
   * `react-native-svg`'s `TextPath`: its text follows the path `href="#id"` names, from `startOffset`. A `href` that is not an `#id` is a warning and the
   * text is drawn as a plain `TSpan`, as in the library.
   */
  let { children, ref, animatedProps, childrenAsArray, ...props }: Omit<TextPathProps, "children"> & {
    children?: Snippet;
    /** @internal `SvgXml` sets it, see `TSpan`; it only matters to the `TSpan` that draws a text path with a bad `href`. */
    childrenAsArray?: boolean;
  } & SvgExtras = $props();
  const resolveProps = createNativeProps();
  const hostRef = $derived(handleRef(ref, { matrix: true }));
  const native = $derived(textPathNativeProps(props));
</script>
{#if native}
  <native-foreign component="RNSVGTextPath" nativeProps={resolveProps({ ...native, ...(animatedProps ? { animatedProps } : null), ref: hostRef })}>{@render children?.()}</native-foreign>
{:else}
  <TSpan {ref} {childrenAsArray}>{@render children?.()}</TSpan>
{/if}
