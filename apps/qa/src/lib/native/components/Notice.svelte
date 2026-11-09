<script lang="ts">
  import { Text } from "@example/svelte-native";
  import { theme } from "../state.svelte.ts";
  let { message, danger = true }: { message?: string; danger?: boolean } = $props();
</script>
{#if message}<Text accessibilityRole={danger ? "alert" : "text"} style={{ color: danger ? theme.danger : theme.foreground, fontSize: 15, writingDirection: theme.direction }}>{message}</Text>{/if}
