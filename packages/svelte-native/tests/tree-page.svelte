<script>
  import { onMount } from "svelte";
  import Screen from "../src/components/Screen.svelte";
  import { useRouter } from "../src/router.svelte.ts";
  let { url } = $props();
  // The router a page sees is the one of its navigator; the tests read it from here.
  (globalThis.__treeRouters ??= {})[url.pathname] = useRouter();
  (globalThis.__treeRoots ??= {})[url.pathname] = useRouter("root");
  const options = globalThis.__treeOptions?.[url.pathname] ?? {};
  // `globalThis.__treeLog`, when a test sets it, hears the page's life (`prepare-tree.test.ts` compares it between a prepared navigation and `goto`).
  const log = globalThis.__treeLog;
  log?.push(`init ${url.pathname}`);
  $effect(() => { log?.push(`effect ${url.pathname}`); return () => log?.push(`cleanup ${url.pathname}`); });
  onMount(() => { log?.push(`mount ${url.pathname}`); });
</script>
<Screen title={url.pathname} {...options}><native-text>page {url.pathname}</native-text></Screen>
