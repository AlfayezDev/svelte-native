<script>
  import Screen from "../src/components/Screen.svelte";
  import { useRouter } from "../src/router.svelte.ts";
  let { url } = $props();
  // The router a page sees is the one of its navigator; the tests read it from here.
  (globalThis.__treeRouters ??= {})[url.pathname] = useRouter();
  const options = globalThis.__treeOptions?.[url.pathname] ?? {};
</script>
<Screen title={url.pathname} {...options}><native-text>page {url.pathname}</native-text></Screen>
