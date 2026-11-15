<script>
  import ExpoView from "../../../src/components/ExpoView.svelte";
  import View from "../../../src/components/View.svelte";
  let module = $state("Thing");
  let view = $state("View");
  let zoom = $state(1);
  let shown = $state(true);
  let player = $state.raw({ __expo_shared_object_id__: 12 });
  let onReady = $state((event) => log.push(["ready", event]));
  const refs = [(handle) => handles.push(handle), (handle) => other.push(handle)];
  let ref = $state(refs[0]);
  const log = [];
  const handles = [];
  const other = [];
  export function setZoom(next) { zoom = next; }
  export function setModule(nextModule, nextView) { module = nextModule; view = nextView; }
  export function setShown(next) { shown = next; }
  export function setReady(handler) { onReady = handler; }
  export function useRef(index) { ref = refs[index]; }
  export function eventLog() { return log; }
  export function handleLog() { return handles; }
  export function otherHandleLog() { return other; }
</script>
{#if shown}
  <ExpoView {module} {view} facing="back" {zoom} {player} count={3} nothing={null} settings={{ player }} undeclared="dropped"
    style={{ height: 100, backgroundColor: "#ff0000" }} {ref} {onReady} onFail={(event) => log.push(["fail", event])}>
    <View style={{ height: 4 }} />
  </ExpoView>
{/if}
