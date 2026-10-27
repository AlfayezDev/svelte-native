<script>
  import Stack from "../src/components/Stack.svelte";
  let { children } = $props();
</script>
{#snippet loading(entry)}<native-text>loading {entry.url.pathname}</native-text>{/snippet}
<Stack header={{ large: true, tint: "#123456" }} animation="slide_from_right" {loading}>{@render children()}</Stack>
