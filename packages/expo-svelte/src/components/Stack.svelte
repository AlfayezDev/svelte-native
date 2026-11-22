<script lang="ts">
  import { setContext, type Snippet } from "svelte";
  import { STACK_CONTEXT, type StackContext, type StackDefaults } from "../navigator-context.ts";
  import type { NativeLocation } from "../router.svelte.ts";

  /**
   * The options of a stack navigator, written in its layout: `<Stack header={{ large: true }} animation="slide_from_right">{@render children()}</Stack>`
   * (contract: SPEC.md "Route tree"). They are defaults under each screen's own options: a page's `<Screen>` wins per
   * option, objects merge key by key. `loading` is the snippet shown while a route's modules load.
   */
  let { children, loading, ...defaults }: StackDefaults & { children?: Snippet; loading?: Snippet<[NativeLocation]> } = $props();

  setContext(STACK_CONTEXT, { get defaults() { return defaults; }, get loading() { return loading; } } satisfies StackContext);
</script>

{@render children?.()}
