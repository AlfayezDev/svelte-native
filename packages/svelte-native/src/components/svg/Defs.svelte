<script lang="ts">
  import type { Snippet } from "svelte";
  import type {} from "../../elements.d.ts";

  /** `react-native-svg`'s `Defs`: definitions (gradients, clip paths, masks, symbols, ...) that draw nothing themselves. It takes no props, as in the library. */
  let { children }: { children?: Snippet } = $props();
</script>
<native-foreign component="RNSVGDefs">{@render children?.()}</native-foreign>
