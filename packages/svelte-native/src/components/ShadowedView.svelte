<script lang="ts">
  import type { Snippet } from "svelte";
  import type {} from "../elements.d.ts";
  import { createNativeProps } from "../native-props.ts";
  import { Platform } from "../fabric/deps-rn.ts";
  import { isRightToLeft, shadowedParts } from "../fabric/foreign-shadow.ts";
  import View from "./View.svelte";
  import type { ViewProps } from "react-native";

  /**
   * The Android shadow of `react-native-fast-shadow` (`FastShadowView`) as a Svelte component, a drop-in `View` with the shadow
   * props of its `style`: `shadowColor`, `shadowOpacity`, `shadowRadius`, `shadowOffset`, shaped by the corner radii of the style
   * (`borderRadius` and the per-corner ones; start and end swap in a right-to-left layout). On iOS it is a plain `View`, which
   * draws shadows itself, as the library's is. On Android the native view paints the shadow behind a background, a border and the
   * corner radii it takes from the style and fills the container, whose children stay the engine's views and take touches
   * (the library's native view is the box itself, so its children would be React Native's). The shadow is drawn outside the box:
   * `overflow: "hidden"` on the ShadowedView clips it, put it on the child that needs rounding. Not ported: the corner radii of
   * the single child's style (the library's fallback when the box has none) and animated or shared-value styles, which are not
   * split between the two views.
   */
  let { style, children, ref, ...attributes }: Omit<ViewProps, "children"> & {
    children?: Snippet;
    /** Receives the host handle of the container, or null on unmount. */
    ref?: (handle: unknown) => void;
  } = $props();
  const resolveProps = createNativeProps();
  const android = Platform.OS === "android";
  const parts = $derived(android ? shadowedParts(style, isRightToLeft()) : null);
</script>
{#if parts}
  <View {...attributes} style={parts.content} {ref}>
    <native-foreign component="FastShadowView" nativeProps={resolveProps({ ...parts.shadow, cornerRadii: parts.cornerRadii, pointerEvents: "none", style: [{ position: "absolute", ...parts.inset }, parts.box] })}></native-foreign>
    {@render children?.()}
  </View>
{:else}
  <View {...attributes} {style} {ref}>{@render children?.()}</View>
{/if}
