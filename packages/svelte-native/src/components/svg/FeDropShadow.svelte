<script lang="ts">
  import type {} from "../../elements.d.ts";
  import FeComposite from "./FeComposite.svelte";
  import FeFlood from "./FeFlood.svelte";
  import FeGaussianBlur from "./FeGaussianBlur.svelte";
  import FeMerge from "./FeMerge.svelte";
  import FeMergeNode from "./FeMergeNode.svelte";
  import FeOffset from "./FeOffset.svelte";
  import type { FeDropShadowProps, FilterPrimitiveCommonProps } from "#vendor/react-native-svg";

  /** `react-native-svg`'s `FeDropShadow`: the library builds it from five primitives (blur, offset, flood, composite, merge) and so does this. */
  let { stdDeviation, in: input = "SourceGraphic", dx, dy, floodColor, floodOpacity, result }: FeDropShadowProps & FilterPrimitiveCommonProps = $props();
</script>
<FeGaussianBlur in={input} {stdDeviation} />
<FeOffset {dx} {dy} result="offsetblur" />
<FeFlood {floodColor} {floodOpacity} />
<FeComposite in2="offsetblur" operator="in" />
<FeMerge {result}><FeMergeNode /><FeMergeNode in={input} /></FeMerge>
