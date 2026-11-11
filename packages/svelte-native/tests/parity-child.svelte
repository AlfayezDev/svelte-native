<script>
  import { onDestroy, onMount } from "svelte";
  let { id, log, n = 0 } = $props();
  log.push(`child ${id}: init`);
  $effect.pre(() => { log.push(`child ${id}: pre n=${n}`); });
  $effect(() => {
    log.push(`child ${id}: effect n=${n}`);
    return () => log.push(`child ${id}: cleanup n=${n}`);
  });
  onMount(() => { log.push(`child ${id}: mount`); return () => log.push(`child ${id}: unmount`); });
  onDestroy(() => log.push(`child ${id}: destroy`));
</script>
<native-view testID="child-{id}"><native-text>child {id} n={n}</native-text></native-view>
