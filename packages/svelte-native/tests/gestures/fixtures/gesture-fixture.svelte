<script>
  // Host tags with a `gesture` attribute; a test replaces the list to mount, update and unmount them. `initial` is mounted with
  // the surface, so an error thrown by the first commit reaches `startSurface`.
  let { initial = [] } = $props();
  let items = $state.raw(initial);
  export function set(next) { items = next; }
</script>
{#each items as item (item.id)}
  <native-view testID={item.id} gesture={item.gesture} collapsable={item.collapsable}></native-view>
{/each}
