<script>
  import Tabs from "../../../src/components/Tabs.svelte";
  import { useRouter } from "../../../src/router.svelte.ts";
  let { panes, children } = $props();
  globalThis.__treePanes = panes;
  globalThis.__treeTabsRouter = useRouter(); // the tabs navigator's own router, as a layout sees it
  const items = globalThis.__treeTabs ?? [{ key: "home", title: "Home" }, { key: "inbox", title: "Inbox", badge: 3 }];
</script>
<Tabs {items} tint="#0a84ff" onSelect={(key) => (globalThis.__treeSelections ??= []).push(key)}>{@render children()}</Tabs>
