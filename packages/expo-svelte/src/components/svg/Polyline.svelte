<script lang="ts">
  import type {} from "../../elements.d.ts";
  import { polyPathProps } from "../../fabric/foreign-svg.ts";
  import Path from "./Path.svelte";
  import type { SvgExtras } from "./handle.ts";
  import type { PolylineProps } from "#vendor/react-native-svg";

  /** `react-native-svg`'s `Polyline`: an open `Path` through `points` (`"x,y x,y"` or a list of numbers), as the library renders it. */
  let { ...props }: PolylineProps & SvgExtras = $props();
  const path = $derived(polyPathProps(props, false));
</script>
<Path {...path} />
