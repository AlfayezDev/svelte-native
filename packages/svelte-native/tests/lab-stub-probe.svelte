<script>
  // What the product's lab stub is checked against (app-tree.test.ts): an unguarded use of the lab's directories is a read of a binding, a call
  // of one, or a component of the lab; `off` is the code that stays behind the flag.
  import { lateFault } from "../../../apps/platform/src/lib/native/dev/update-probe.ts";
  import { openLabLaunch } from "../../../apps/platform/src/lib/native/dev/launch.ts";
  import LabLink from "../../../apps/platform/src/lib/native/dev/LabLink.svelte";
  import View from "../src/components/View.svelte";
  import Text from "../src/components/Text.svelte";
  let { mode = "off" } = $props();
  const shown = mode === "read" ? String(lateFault === "mount") : mode === "call" ? String(openLabLaunch()) : "behind the flag";
</script>
<View>
  <Text>{shown}</Text>
  {#if mode === "component"}<LabLink />{/if}
</View>
