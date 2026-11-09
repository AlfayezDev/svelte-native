<script lang="ts">
  import type {} from "../../elements.d.ts";
  import { polyPathProps } from "../../fabric/foreign-svg.ts";
  import Path from "./Path.svelte";
  import type { SvgExtras } from "./handle.ts";
  import type { PolygonProps } from "react-native-svg";

  /** `react-native-svg`'s `Polygon`: a closed `Path` through `points` (`"x,y x,y"` or a list of numbers), as the library renders it. */
  let { ...props }: PolygonProps & SvgExtras = $props();
  const path = $derived(polyPathProps(props, true));
</script>
<Path {...path} />
