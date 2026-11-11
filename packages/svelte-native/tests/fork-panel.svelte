<script>
  import { onDestroy, onMount } from "svelte";
  let { rows = 3, log, count = 0 } = $props();
  log.push("panel:init");
  $effect(() => {
    log.push(`panel:effect(${count})`);
    return () => log.push("panel:cleanup");
  });
  onMount(() => {
    log.push("panel:mount");
    return () => log.push("panel:unmount");
  });
  onDestroy(() => log.push("panel:destroy"));
  const indexes = $derived(Array.from({ length: rows }, (_, index) => index));
</script>
<native-view testID="panel" ref={(handle) => log.push(handle ? "panel:ref" : "panel:ref(null)")}>
  <native-text>count {count}</native-text>
  {#each indexes as index (index)}
    <native-view testID="row-{index}"><native-text>row {index}</native-text></native-view>
  {/each}
</native-view>
