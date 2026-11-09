<script>
  import { defineExpoView } from "../src/components/define-expo-view.ts";
  import View from "../src/components/View.svelte";
  const Thing = defineExpoView("Thing", "View");
  const Plain = defineExpoView("Plain");
  let zoom = $state(1);
  const log = [];
  const handles = [];
  export function setZoom(next) { zoom = next; }
  export function eventLog() { return log; }
  export function handleLog() { return handles; }
</script>
<!-- `module` and `view` are the factory's: a prop of that name is ignored. -->
<Thing module="Plain" view="Other" {zoom} facing="front" onReady={(event) => log.push(event)} ref={(handle) => handles.push(handle)}>
  <View style={{ height: 4 }} />
</Thing>
<Plain {zoom} />
