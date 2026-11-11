<script>
  import View from "../src/components/View.svelte";
  import Text from "../src/components/Text.svelte";
  import ScrollView from "../src/components/ScrollView.svelte";
  let { url } = $props();
  const log = globalThis.__forkLog;
  log?.push(`heavy${url.pathname}:init`);
  $effect(() => { log?.push(`heavy${url.pathname}:effect`); });
  const rows = Array.from({ length: globalThis.__forkRows ?? 300 }, (_, index) => index);
</script>
<ScrollView style={{ flex: 1 }}>
  {#each rows as row (row)}
    <View style={{ padding: 10, flexDirection: "row" }}><Text style={{ fontSize: 14 }}>Row {row}</Text></View>
  {/each}
</ScrollView>
