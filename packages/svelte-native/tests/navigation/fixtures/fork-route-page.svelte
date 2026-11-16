<script>
  import { onDestroy, onMount } from "svelte";
  let { params, url } = $props();
  const log = globalThis.__forkLog;
  const name = url.pathname;
  log?.push(`page${name}:init`);
  $effect(() => {
    log?.push(`page${name}:effect`);
    return () => log?.push(`page${name}:cleanup`);
  });
  onMount(() => log?.push(`page${name}:mount`));
  onDestroy(() => log?.push(`page${name}:destroy`));
</script>
<native-text testID="page{name}">page {name}{params.id ? `:${params.id}` : ""}</native-text>
