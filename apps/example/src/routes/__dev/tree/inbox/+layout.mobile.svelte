<script lang="ts" module>
  export const navigator = "stack";
</script>
<script lang="ts">
  import type { Snippet } from "svelte";
  import { Stack } from "@rasheed/svelte-native";

  /** The inbox pane's stack: large headers for its screens. */
  let { children }: { children: Snippet } = $props();
</script>

<Stack header={{ large: true }}>{@render children()}</Stack>
