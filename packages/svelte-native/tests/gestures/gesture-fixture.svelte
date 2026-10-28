<script>
  // Host tags with a `gesture` attribute; a test replaces the list to mount, update and unmount them.
  let items = $state.raw([]);
  export function set(next) { items = next; }
</script>
{#each items as item (item.id)}
  <native-view testID={item.id} gesture={item.gesture} collapsable={item.collapsable}></native-view>
{/each}
