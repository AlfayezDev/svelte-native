<script lang="ts">
  import type { Snippet } from "svelte";
  import type {} from "../../elements.d.ts";
  import { createNativeProps } from "../../native-props.ts";
  import { textNativeProps } from "../../fabric/foreign-svg.ts";
  import { handleRef, type SvgExtras } from "./handle.ts";
  import type { TextProps } from "react-native-svg";

  /**
   * `react-native-svg`'s `Text`. A string between its tags is a `TSpan` of its own and so is each string next to a `TSpan`; the host builds them
   * (`foreign-text.ts`). Whitespace between elements is text, as in HTML. Fonts come from the font props (`fontSize`, `fontFamily`, `fontWeight`, `font`, ...).
   */
  let { children, ref, animatedProps, ...props }: Omit<TextProps, "children"> & { children?: Snippet } & SvgExtras = $props();
  const resolveProps = createNativeProps();
  const hostRef = handleRef(() => ref, { matrix: true });
  const native = $derived(textNativeProps(props));
</script>
<native-foreign component="RNSVGText" nativeProps={resolveProps({ ...native, animatedProps, ref: hostRef })}>{@render children?.()}</native-foreign>
