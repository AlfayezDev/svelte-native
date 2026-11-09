<script>
  // What the lab stub is checked against (app-tree.test.ts): an unguarded use of the lab's directories is a read of a binding, a call
  // of one, or a component of the lab; `off` is the code that stays behind the flag.
  import { lateFault } from "./fixtures/stand-in-app/src/lib/lab/faults.ts";
  import { openLabLaunch } from "./fixtures/stand-in-app/src/lib/lab/launch.ts";
  import LabLink from "./fixtures/stand-in-app/src/lib/lab/LabLink.svelte";
  import View from "../src/components/View.svelte";
  import Text from "../src/components/Text.svelte";
  let { mode = "off" } = $props();
  const shown = mode === "read" ? String(lateFault === "mount") : mode === "call" ? String(openLabLaunch()) : "behind the flag";
</script>
<View>
  <Text>{shown}</Text>
  {#if mode === "component"}<LabLink />{/if}
</View>
