<script lang="ts">
  import { setContext, untrack, type Snippet } from "svelte";
  import type {} from "../../elements.d.ts";
  import { createNativeProps } from "../../native-props.ts";
  import { radialGradientNativeProps } from "../../fabric/foreign-svg.ts";
  import type { StopProps } from "../../fabric/foreign-svg-extract.ts";
  import { handleRef, type SvgExtras } from "./handle.ts";
  import { createRegistry, stopsKey } from "./registry.ts";
  import type { RadialGradientProps } from "#vendor/react-native-svg";

  /** `react-native-svg`'s `RadialGradient`: `cx`, `cy`, `r` (or `rx`, `ry`) and the focal point `fx`, `fy`; its `Stop`s are its children. */
  let { children, ref, animatedProps, ...props }: Omit<RadialGradientProps, "children"> & { children?: Snippet } & SvgExtras = $props();
  const resolveProps = createNativeProps();
  const hostRef = $derived(handleRef(ref));
  let version = $state(0);
  const stops = createRegistry<StopProps>(() => { untrack(() => { version++; }); });
  setContext(stopsKey, stops);
  const native = $derived.by(() => { void version; return radialGradientNativeProps(props, stops.read()); });
</script>
<native-foreign component="RNSVGRadialGradient" nativeProps={resolveProps({ ...native, ...(animatedProps ? { animatedProps } : null), ref: hostRef })}>{@render children?.()}</native-foreign>
