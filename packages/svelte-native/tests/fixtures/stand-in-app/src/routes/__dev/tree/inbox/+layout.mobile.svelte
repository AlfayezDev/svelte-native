<script lang="ts" module>
  export const navigator = "stack";
</script>
<script lang="ts">
  import type { Snippet } from "svelte";
  import { Stack } from "@alfayez/svelte-native";
  let { children }: { children: Snippet } = $props();
</script>
<Stack>{@render children()}</Stack>
