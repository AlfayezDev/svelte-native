<script lang="ts">
  import type { Snippet } from "svelte";
  import { Text, View } from "@example/svelte-native";
  import { text, theme } from "#lib/theme.svelte.ts";

  // One labelled example: a heading, an optional note, and a card holding the live example (`children`).
  let { title, note, children }: { title: string; note?: string; children: Snippet } = $props();
</script>

<View style={{ gap: 8 }}>
  <Text accessibilityRole="header" style={text.heading}>{title}</Text>
  {#if note}<Text style={text.caption}>{note}</Text>{/if}
  <View style={{ gap: 12, padding: 16, borderRadius: 12, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.surface }}>
    {@render children()}
  </View>
</View>
