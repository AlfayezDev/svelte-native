<script lang="ts">
  import type { Snippet } from "svelte";
  import { View, Text, ScrollView, SafeAreaView, Pressable } from "@rasheed/svelte-native";
  import { theme, t } from "../state.svelte.ts";
  let { title, description, back, children }: { title: string; description?: string; back?: () => void; children: Snippet } = $props();
</script>
<SafeAreaView style={{ flex: 1, backgroundColor: theme.background }}>
  <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ flexGrow: 1, padding: 24, gap: 24, direction: theme.direction }}>
    <View style={{ gap: 12 }}>
      {#if back}<Pressable accessibilityRole="button" accessibilityLabel={t("common.back")} onPress={back} hitSlop={12}><Text style={{ color: theme.foreground, fontSize: 16 }}>{t("common.back")}</Text></Pressable>{/if}
      <Text accessibilityRole="header" style={{ color: theme.foreground, fontSize: 30, fontWeight: "600", writingDirection: theme.direction }}>{title}</Text>
      {#if description}<Text style={{ color: theme.muted, fontSize: 16, writingDirection: theme.direction }}>{description}</Text>{/if}
    </View>
    {@render children()}
  </ScrollView>
</SafeAreaView>
