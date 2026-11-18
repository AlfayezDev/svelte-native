<script lang="ts">
  import { setContext, untrack, type Snippet } from "svelte";
  import type {} from "../../elements.d.ts";
  import { createNativeProps } from "../../native-props.ts";
  import { feMergeNativeProps } from "../../fabric/foreign-svg.ts";
  import { handleRef, type SvgExtras } from "./handle.ts";
  import { createRegistry, mergeNodesKey } from "./registry.ts";
  import type { FeMergeProps, FilterPrimitiveCommonProps } from "#vendor/react-native-svg";

  /** `react-native-svg`'s `FeMerge`: layers the results its `FeMergeNode` children name (`in`), first at the bottom. */
  let { children, ref, animatedProps, ...props }: Omit<FeMergeProps, "children"> & { children?: Snippet } & FilterPrimitiveCommonProps & SvgExtras = $props();
  const resolveProps = createNativeProps();
  const hostRef = $derived(handleRef(ref));
  let version = $state(0);
  const nodes = createRegistry<string | undefined>(() => { untrack(() => { version++; }); });
  setContext(mergeNodesKey, nodes);
  const native = $derived.by(() => { void version; return feMergeNativeProps(props, nodes.read()); });
</script>
<native-foreign component="RNSVGFeMerge" nativeProps={resolveProps({ ...native, ...(animatedProps ? { animatedProps } : null), ref: hostRef })}>{@render children?.()}</native-foreign>
