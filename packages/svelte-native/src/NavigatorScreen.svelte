<script lang="ts">
  import { untrack, type Component } from "svelte";
  import Router from "./Router.svelte";
  import TabPanes from "./TabPanes.svelte";
  import { enterNavigator, type NativeLocation } from "./router.svelte.ts";
  /**
   * The content of a screen whose route is a navigator: the navigator layout (`layout`) around its screens or panes. The
   * navigator's router is created here, below the content layouts of the screen and above its layout, so `useRouter()` in
   * the layout is the navigator's own.
   */
  let { entry, layout: Layout }: { entry: NativeLocation; layout: Component } = $props();
  const router = untrack(() => enterNavigator(entry));
  const panes = router.node.kind === "tabs" ? router.node.panes.map(({ key }) => ({ key })) : undefined;
</script>
<Layout params={entry.params} url={entry.url} {panes}>
  {#if router.node.kind === "tabs"}<TabPanes />{:else}<Router {router} />{/if}
</Layout>
