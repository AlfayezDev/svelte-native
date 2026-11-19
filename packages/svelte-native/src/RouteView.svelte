<script lang="ts" module>
  /** The entries a RouteView has rendered: one that renders again (its boundary reset) loads a failed route again. */
  const rendered = new WeakSet<object>();
</script>

<script lang="ts">
  import { untrack, type Snippet } from "svelte";
  import NavigatorScreen from "./NavigatorScreen.svelte";
  import type { NativeLocation, Router } from "./router.svelte.ts";
  import type { RouteModules } from "./route-tree.ts";
  /** One entry of a stack: its page, or the layout of the navigator it is the screen of, inside the content layouts above it. */
  let { entry, router, loading }: { entry: NativeLocation; router: Router; loading?: Snippet<[NativeLocation]> } = $props();
  // The entry's modules load when its screen first renders (the first screen, a restored stack); a navigation loaded them already. A load that failed
  // before the screen first rendered is not started again here: Router makes a pushed screen once its load has settled, so the screen renders to throw
  // the failure below, and the next navigation loads again. A screen that renders again (its boundary reset) loads again, as a first screen always did.
  untrack(() => {
    const again = rendered.has(entry);
    rendered.add(entry);
    let failed = false;
    try { router.modules(entry.route); } catch { failed = true; }
    if (failed && !again) return;
    router.load(entry.route);
  });
  const modules = $derived(router.modules(entry.route));
</script>
{#snippet level(depth: number, loaded: RouteModules)}
  {@const Current = loaded.layouts[depth] ?? loaded.component}
  {#if depth < loaded.layouts.length}
  <Current params={entry.params} url={entry.url}>
    {@render level(depth + 1, loaded)}
  </Current>
  {:else if entry.route.kind === "page"}
  <Current params={entry.params} url={entry.url} />
  {:else}
  <NavigatorScreen {entry} layout={Current} />
  {/if}
{/snippet}
{#if modules}
  {@render level(0, modules)}
{:else if loading}
  {@render loading(entry)}
{/if}
