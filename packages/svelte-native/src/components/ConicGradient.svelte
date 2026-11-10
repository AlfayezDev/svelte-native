<script lang="ts">
  import type { Snippet } from "svelte";
  import type {} from "../elements.d.ts";
  import type { ClassProps } from "../classes.ts";
  import { createNativeProps } from "../native-props.ts";
  import { expoViewName } from "../fabric/foreign.ts";
  import View from "./View.svelte";
  import type { ViewProps } from "react-native";

  /**
   * The conic (sweep) gradient of `expo-conic-gradient` (`ConicGradient`) as a Svelte component, with that package's props:
   * `colors` (any colour spelling React Native takes), `locations` (fractions of the turn, one per colour), `center` (`[x, y]` as
   * fractions of the view, default the middle) and `angle` (degrees, 0 starts at the top). The native view draws the gradient
   * over its own children (Android) and takes none on iOS (SwiftUI), so the gradient fills a container that carries the style
   * and the children, which are the engine's views drawn above it; round the corners with `borderRadius` and `overflow: "hidden"`.
   */
  let { colors, locations, center, angle, style, children, ref, ...attributes }: Omit<ViewProps, "children"> & {
    colors: readonly unknown[];
    locations?: readonly number[];
    center?: readonly [x: number, y: number];
    angle?: number;
    children?: Snippet;
    /** Receives the host handle of the container, or null on unmount. */
    ref?: (handle: unknown) => void;
  } & ClassProps = $props();
  const resolveProps = createNativeProps();
  // The module's only view, with its colour list named: the module's own config does not tell it from a plain prop.
  const component = expoViewName("ConicGradient", undefined, { colorLists: "colors" });
  const fill = { position: "absolute", left: 0, top: 0, right: 0, bottom: 0 } as const;
</script>
<View {...attributes} {style} {ref}>
  <native-foreign {component} nativeProps={resolveProps({ colors, locations, center, angle, style: fill })}></native-foreign>
  {@render children?.()}
</View>
