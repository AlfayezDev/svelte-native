<script lang="ts">
  import { untrack, type Component, type Snippet } from "svelte";
  import Router from "./Router.svelte";
  import { parseNavigation } from "./hmr-state.ts";
  import { createRouter } from "./router.svelte.ts";
  import type { StackNode } from "./route-tree.ts";
  /**
   * The app of a route tree: the root layout (`shell`) around the root navigator. The router is created here, above the shell,
   * so the shell and everything in it can use `useRouter()`; the navigator renders where the shell puts its `children`.
   * `navigation` is what the host started the surface with when the process died and came back: the JSON the router wrote
   * through `hmrState().save` (SPEC.md "Navigation state across recreation and process death").
   */
  let { shell: Shell, tree, initial, navigation }: { shell: Component<{ children: Snippet }>; tree: StackNode; initial?: string; navigation?: string } = $props();
  const router = createRouter(untrack(() => tree), untrack(() => initial), { restore: parseNavigation(untrack(() => navigation)) });
</script>
<Shell><Router {router} /></Shell>
