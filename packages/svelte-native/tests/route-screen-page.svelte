<script>
  import Screen from "../src/components/Screen.svelte";
  let { params, url } = $props();
</script>
<Screen title={`Page ${url.pathname}`} header={{ large: url.pathname === "/a" }}><native-text>page {url.pathname}{params.id ? `:${params.id}` : ""}</native-text></Screen>
