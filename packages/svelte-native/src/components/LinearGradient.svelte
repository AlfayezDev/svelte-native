<script lang="ts">
  import type { Snippet } from "svelte";
  import type {} from "../elements.d.ts";
  import { createNativeProps } from "../native-props.ts";
  import { Platform } from "../fabric/deps-rn.ts";
  import { expoViewName, flattenStyle } from "../fabric/foreign.ts";
  import { borderRadii, gradientProps, type GradientPoint } from "../fabric/foreign-gradient.ts";
  import View from "./View.svelte";
  import type { ViewProps } from "react-native";

  /**
   * The native gradient of `expo-linear-gradient` (`ExpoLinearGradient`) as a Svelte component, with that package's props:
   * `colors` (any colour spelling React Native takes), `locations`, `start` and `end` (`{ x, y }` or `[x, y]`, as fractions of
   * the view), `dither` (Android). On Android the gradient is a plain view behind a container that holds the children (as the
   * library's own wrapper builds it), so the children are the engine's views and the style's corner radii round the gradient; on iOS
   * the gradient view is the container itself.
   */
  let { colors, locations, start, end, dither, style, children, ref, ...attributes }: Omit<ViewProps, "children"> & {
    colors: readonly unknown[];
    locations?: readonly number[] | null;
    start?: GradientPoint | null;
    end?: GradientPoint | null;
    dither?: boolean;
    children?: Snippet;
    /** Receives the host handle of the container (`tag`, `measure`, ...), or null on unmount. */
    ref?: (handle: unknown) => void;
  } = $props();
  const resolveProps = createNativeProps();
  const android = Platform.OS === "android";
  // The view's only view, with its colour list named: the module's own config does not tell it from a plain prop.
  const component = expoViewName("ExpoLinearGradient", undefined, { colorLists: "colors" });
  const native = $derived(gradientProps({ colors, locations, start, end, dither }, android ? "android" : "ios"));
  const fill = { position: "absolute", left: 0, top: 0, right: 0, bottom: 0 } as const;
</script>
{#if android}
  <View {...attributes} {style} {ref}>
    <native-foreign {component} nativeProps={resolveProps({ ...native, style: fill, borderRadii: borderRadii(flattenStyle(style)) })}></native-foreign>
    {@render children?.()}
  </View>
{:else}
  <native-foreign {component} nativeProps={resolveProps({ ...attributes, ...native, style, ref })}>{@render children?.()}</native-foreign>
{/if}
