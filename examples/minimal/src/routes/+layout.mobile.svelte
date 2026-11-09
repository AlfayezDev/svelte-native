<script lang="ts">
  import type { Snippet } from "svelte";
  let { children }: { children: Snippet } = $props();
</script>

<!-- The app shell: `children` is the root navigator, a stack of the screens under src/routes. -->
{@render children()}
