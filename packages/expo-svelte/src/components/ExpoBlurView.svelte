<script lang="ts">
  import type { Snippet } from "svelte";
  import type {} from "../elements.d.ts";
  import type { ClassProps } from "../classes.ts";
  import { createNativeProps } from "../native-props.ts";
  import { expoViewName } from "../fabric/foreign.ts";
  import View from "./View.svelte";
  import type { ViewProps } from "react-native";

  /**
   * The blur of `expo-blur` (its `ExpoBlurView`; the library's own `BlurView` needs no package) as a Svelte component, with that package's props:
   * `intensity` (1 to 100), `tint`, `blurReductionFactor` and `blurMethod` (`experimentalBlurMethod` is its deprecated name) on Android, and `blurTarget`.
   *
   * iOS blurs what is behind the view. On Android `blurMethod="none"` (the default) draws a translucent tint colour, which needs
   * nothing else; the real blur (`dimezisBlurView`, `dimezisBlurViewSdk31Plus`) renders what a `BlurTargetView` holds, so the
   * content to blur goes in a `BlurTargetView` and `blurTarget` is its `ref` (the native view finds the target by its tag; the tag
   * reaches it with the first update after both views exist). The views inside a `BlurTargetView` are mounted by React Native
   * (the target is a foreign view): they draw and lay out as usual and take no JavaScript touch or responder events.
   */
  let { tint = "default", intensity = 50, blurReductionFactor = 4, blurMethod, experimentalBlurMethod, blurTarget, style, children, ref, ...attributes }: Omit<ViewProps, "children"> & {
    tint?: string;
    intensity?: number;
    blurReductionFactor?: number;
    blurMethod?: "none" | "dimezisBlurView" | "dimezisBlurViewSdk31Plus";
    /** @deprecated Use `blurMethod`. */
    experimentalBlurMethod?: "none" | "dimezisBlurView" | "dimezisBlurViewSdk31Plus";
    /** The `ref` value of a `BlurTargetView` (its host handle), or its native tag. */
    blurTarget?: { tag: number } | number | null;
    children?: Snippet;
    /** Receives the host handle of the container, or null on unmount. */
    ref?: (handle: unknown) => void;
  } & ClassProps = $props();
  const resolveProps = createNativeProps();
  const component = expoViewName("ExpoBlur", "ExpoBlurView");
  const blurTargetId = $derived(typeof blurTarget === "number" ? blurTarget : blurTarget?.tag);
  const fill = { position: "absolute", left: 0, top: 0, right: 0, bottom: 0 } as const;
</script>
<View {...attributes} style={[{ backgroundColor: "transparent" }, style]} {ref}>
  <native-foreign {component} nativeProps={resolveProps({ blurTargetId, tint, intensity, blurReductionFactor, blurMethod: blurMethod ?? experimentalBlurMethod ?? "none", style: fill })}></native-foreign>
  {@render children?.()}
</View>
