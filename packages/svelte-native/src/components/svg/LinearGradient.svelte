<script lang="ts">
  import { setContext, untrack, type Snippet } from "svelte";
  import type {} from "../../elements.d.ts";
  import { createNativeProps } from "../../native-props.ts";
  import { linearGradientNativeProps } from "../../fabric/foreign-svg.ts";
  import type { StopProps } from "../../fabric/foreign-svg-extract.ts";
  import { handleRef, type SvgExtras } from "./handle.ts";
  import { createRegistry, stopsKey } from "./registry.ts";
  import type { LinearGradientProps } from "#vendor/react-native-svg";

  /**
   * `react-native-svg`'s `LinearGradient`: a definition (`id`) that `fill="url(#id)"` and `stroke="url(#id)"` name. Its `Stop`s are its children;
   * they tell the gradient their `offset`, `stopColor` and `stopOpacity` and the gradient sends the sorted list to the native view.
   */
  let { children, ref, animatedProps, ...props }: Omit<LinearGradientProps, "children"> & { children?: Snippet } & SvgExtras = $props();
  const resolveProps = createNativeProps();
  const hostRef = $derived(handleRef(ref));
  let version = $state(0);
  const stops = createRegistry<StopProps>(() => { untrack(() => { version++; }); });
  setContext(stopsKey, stops);
  const native = $derived.by(() => { void version; return linearGradientNativeProps(props, stops.read()); });
</script>
<native-foreign component="RNSVGLinearGradient" nativeProps={resolveProps({ ...native, ...(animatedProps ? { animatedProps } : null), ref: hostRef })}>{@render children?.()}</native-foreign>
