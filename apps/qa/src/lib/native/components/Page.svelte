<script lang="ts">
  import type { Snippet } from "svelte";
  import { Pressable, SafeAreaView, Screen, ScrollView, Text, inTabPane } from "@example/svelte-native";
  import { theme, t } from "../state.svelte.ts";
  /**
   * One scrolling page of the product. The title is the native header's (`<Screen title>`) and the back button is the header's
   * too: it shows when a screen lies below this one. A modal gets no back button, so a modal page passes `close` and the header
   * carries a Close button at its start.
   */
  let { title, description, close, children }: { title: string; description?: string; close?: () => void; children: Snippet } = $props();
  // The header covers the top inset; a tab pane ends at the tab bar, which covers the bottom one.
  const edges = inTabPane() ? (["left", "right"] as const) : (["left", "right", "bottom"] as const);
</script>
{#snippet closeButton()}
  <Pressable accessibilityRole="button" accessibilityLabel={t("common.close")} onPress={close} style={{ minWidth: 48, minHeight: 48, paddingHorizontal: 12, alignItems: "center", justifyContent: "center" }}>
    <Text style={{ color: theme.foreground, fontSize: 16 }}>{t("common.close")}</Text>
  </Pressable>
{/snippet}
<Screen {title} headerLeft={close ? closeButton : undefined} style={{ backgroundColor: theme.background }}>
  <SafeAreaView {edges} style={{ flex: 1, backgroundColor: theme.background }}>
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ flexGrow: 1, padding: 24, gap: 24, direction: theme.direction }}>
      {#if description}<Text style={{ color: theme.muted, fontSize: 16, writingDirection: theme.direction }}>{description}</Text>{/if}
      {@render children()}
    </ScrollView>
  </SafeAreaView>
</Screen>
