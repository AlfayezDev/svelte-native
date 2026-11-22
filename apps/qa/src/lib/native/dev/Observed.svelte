<script lang="ts">
  import { Text } from "expo-svelte";
  import { theme } from "../state.svelte.ts";
  let { value, observe }: { value: string; observe: (value: string) => void } = $props();
  $effect(() => observe(value));
</script>
<Text style={{ color: theme.foreground }}>{value}</Text>
