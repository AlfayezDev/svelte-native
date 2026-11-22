<script lang="ts">
  import type { Snippet } from "svelte";
  import type {} from "../../elements.d.ts";
  import { createNativeProps } from "../../native-props.ts";
  import { svgNativeProps, svgRootName, type SvgRootHandle } from "../../fabric/foreign-svg.ts";
  import { rootRef, type SvgRef } from "./handle.ts";
  import G from "./G.svelte";
  import type { SvgProps } from "#vendor/react-native-svg";

  /**
   * `react-native-svg`'s `Svg`: the root of a drawing. `width` and `height` (or the style's), `viewBox` and `preserveAspectRatio` size and scale it as the
   * library does; the fill, stroke and font props are inherited by the elements inside. On Android the native view is a foreign view (SPEC.md,
   * "react-native-svg"): everything inside it is mounted by React Native, inside the frame the engine keeps for it. `ref` gets the handle with
   * `toDataURL(callback, options)` and the geometry methods. Touches: `onPress` and the other press handlers are the host's Pressability on iOS; on Android
   * they need `pointerEvents="box-only"`, which makes the engine keep the touches of the frame for JavaScript.
   */
  let { children, ref, ...props }: Omit<SvgProps, "children"> & {
    children?: Snippet;
    ref?: SvgRef<SvgRootHandle>;
    /** A worklet returning native props of the root (`{ bbWidth: 64 }`): Reanimated writes them on the UI thread. */
    animatedProps?: (() => Record<string, unknown>) | ReadonlyArray<() => Record<string, unknown>>;
  } = $props();
  const resolveProps = createNativeProps();
  const hostRef = $derived(rootRef(ref));
  const parts = $derived(svgNativeProps(props));
  const component = svgRootName();
</script>
<native-foreign {component} nativeProps={resolveProps({ ...parts.root, ref: hostRef })}><G {...parts.group}>{@render children?.()}</G></native-foreign>
