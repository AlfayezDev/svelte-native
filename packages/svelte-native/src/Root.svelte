<script lang="ts">
  import { untrack, type Component, type Snippet } from "svelte";
  import Router from "./Router.svelte";
  import { createRouter } from "./router.svelte.ts";
  import type { StackNode } from "./route-tree.ts";
  /**
   * The app of a route tree: the root layout (`shell`) around the root navigator. The router is created here, above the shell,
   * so the shell and everything in it can use `useRouter()`; the navigator renders where the shell puts its `children`.
   */
  let { shell: Shell, tree, initial }: { shell: Component<{ children: Snippet }>; tree: StackNode; initial?: string } = $props();
  const router = createRouter(untrack(() => tree), untrack(() => initial));
</script>
<Shell><Router {router} /></Shell>
