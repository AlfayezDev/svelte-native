<script lang="ts">
  import type { Snippet } from "svelte";
  import type {} from "../elements.d.ts";
  import type { ClassProps } from "../classes.ts";
  import { createNativeProps } from "../native-props.ts";
  import { expoViewName } from "../fabric/foreign.ts";
  import type { BlurTint } from "../fabric/foreign-blur.ts";
  import View from "./View.svelte";
  import type { ViewProps } from "react-native";

  /**
   * The library's own blur: it blurs what is drawn behind it and needs no package (`SvelteBlur`, `native/svelte-blur`; the blur of `expo-blur` is
   * `ExpoBlurView`). It is a `View` with the blur filling it and the children on top, so the children are the engine's views and take touches, and
   * `borderRadius` with `overflow: "hidden"` rounds the blur.
   *
   * `intensity` is 0 to 100 (default 50): the blur radius, up to 25 dp, and how opaque the tint is. `tint` is one of `expo-blur`'s names (default `"default"`):
   * iOS maps them to its blur materials, Android draws a translucent white (`light`, `extraLight`, the `...Light` names), black (`dark`, the `...Dark`
   * names) or, for every other name, white by day and black at night.
   *
   * iOS blurs what is behind the view. Android 12 (API 31) and up draws the window's content behind the view into a small picture each frame and blurs
   * that on the GPU; before API 31, or where the view is drawn into a software canvas, it is the tint alone, stronger because nothing is blurred. The
   * blur shows what is drawn before the view (views below it and earlier siblings, not what is drawn above); the content of a map, video or camera
   * surface and a window other than the one the view is in (a native dialog) are not part of it.
   */
  let { tint = "default", intensity = 50, style, children, ref, ...attributes }: Omit<ViewProps, "children"> & {
    tint?: BlurTint;
    intensity?: number;
    children?: Snippet;
    /** Receives the host handle of the container, or null on unmount. */
    ref?: (handle: unknown) => void;
  } & ClassProps = $props();
  const resolveProps = createNativeProps();
  const component = expoViewName("SvelteBlur", "SvelteBlurView");
  const fill = { position: "absolute", left: 0, top: 0, right: 0, bottom: 0 } as const;
</script>
<View {...attributes} {style} {ref}>
  <native-foreign {component} nativeProps={resolveProps({ intensity, tint, pointerEvents: "none", style: fill })}></native-foreign>
  {@render children?.()}
</View>
