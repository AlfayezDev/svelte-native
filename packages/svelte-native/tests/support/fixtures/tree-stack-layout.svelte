<script>
  import Stack from "../../../src/components/Stack.svelte";
  let { children, params, url } = $props();
  (globalThis.__treeLayouts ??= []).push({ path: url?.pathname, params }); // what the layout was given, for the tests
</script>
{#snippet loading(entry)}<native-text>loading {entry.url.pathname}</native-text>{/snippet}
<!-- `globalThis.__treeStackStyle`, when a test sets it, is the layout's `style` (the background its screens fall back to). -->
<Stack header={{ large: true, tint: "#123456" }} animation="slide_from_right" {loading} style={globalThis.__treeStackStyle}>{@render children()}</Stack>
