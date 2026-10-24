<script lang="ts">
  import { Pressable, Text, ActivityIndicator, View } from "@rasheed/svelte-native";
  import { theme } from "../state.svelte.ts";
  let { label, onPress, disabled = false, busy = false, variant = "primary" }: {
    label: string; onPress: () => unknown; disabled?: boolean; busy?: boolean; variant?: "primary" | "secondary" | "danger";
  } = $props();
  const color = $derived(variant === "secondary" ? theme.foreground : variant === "danger" ? "#ffffff" : theme.onAccent);
</script>
<Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: disabled || busy, busy }} disabled={disabled || busy} onPress={onPress}
  style={{ minHeight: 52, padding: 14, borderRadius: 12, justifyContent: "center", opacity: disabled || busy ? 0.5 : 1, backgroundColor: variant === "secondary" ? theme.surface : variant === "danger" ? theme.danger : theme.accent, borderWidth: variant === "secondary" ? 1 : 0, borderColor: theme.border }}>
  <View style={{ flexDirection: "row", gap: 10, alignItems: "center", justifyContent: "center", direction: theme.direction }}>
    {#if busy}<ActivityIndicator {color} />{/if}
    <Text style={{ color, fontSize: 16, fontWeight: "600" }}>{label}</Text>
  </View>
</Pressable>
