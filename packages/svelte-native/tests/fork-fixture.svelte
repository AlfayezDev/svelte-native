<script>
  import Panel from "./fork-panel.svelte";
  let { rows = 3, log = [] } = $props();
  let show = $state(false);
  let count = $state(0);
  $effect(() => { log.push(`root:effect(show=${show},count=${count})`); });
  export function set(value) { show = value; }
  export function get() { return show; }
  export function bump() { count++; }
  export function countOf() { return count; }
  export function logOf() { return log; }
</script>
<native-view testID="root">
  <native-text>always {count}</native-text>
  {#if show}<Panel {rows} {log} {count} />{/if}
</native-view>
