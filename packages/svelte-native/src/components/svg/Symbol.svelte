<script lang="ts">
  import type { Snippet } from "svelte";
  import type {} from "../../elements.d.ts";
  import { createNativeProps } from "../../native-props.ts";
  import { symbolNativeProps } from "../../fabric/foreign-svg.ts";
  import { handleRef, type SvgExtras } from "./handle.ts";
  import type { SymbolProps } from "react-native-svg";

  /** `react-native-svg`'s `Symbol`: a reusable drawing with its own `viewBox`, drawn by a `Use` that names its `id`. */
  let { children, ref, animatedProps, ...props }: Omit<SymbolProps, "children"> & { children?: Snippet } & SvgExtras = $props();
  const resolveProps = createNativeProps();
  const hostRef = handleRef(() => ref);
  const native = $derived(symbolNativeProps(props));
</script>
<native-foreign component="RNSVGSymbol" nativeProps={resolveProps({ ...native, animatedProps, ref: hostRef })}>{@render children?.()}</native-foreign>
