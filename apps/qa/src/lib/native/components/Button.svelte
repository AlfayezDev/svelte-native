<script lang="ts">
  import { Pressable, Text, ActivityIndicator, View } from "expo-svelte";
  import { theme } from "../state.svelte.ts";
  /**
   * `accessibilityLabel` is what a screen reader says when it must differ from the visible `label`: a button that repeats in a list says
   * which row it is for. `selected` is for a button that is one of a set of choices (a tab, a radio): it is said to a screen reader, which
   * the primary colour alone does not, and the choice has the role of its set.
   */
  let { label, accessibilityLabel, onPress, disabled = false, busy = false, variant = "primary", selected, role = "button" }: {
    label: string; accessibilityLabel?: string; onPress: () => unknown; disabled?: boolean; busy?: boolean; variant?: "primary" | "secondary" | "danger";
    selected?: boolean; role?: "button" | "tab" | "radio";
  } = $props();
  const color = $derived(variant === "secondary" ? theme.foreground : variant === "danger" ? "#ffffff" : theme.onAccent);
</script>
<Pressable accessibilityRole={role} accessibilityLabel={accessibilityLabel ?? label} accessibilityState={{ disabled: disabled || busy, busy, ...(selected === undefined ? {} : { selected }) }} disabled={disabled || busy} onPress={onPress}
  style={{ minHeight: 52, padding: 14, borderRadius: 12, justifyContent: "center", opacity: disabled || busy ? 0.5 : 1, backgroundColor: variant === "secondary" ? theme.surface : variant === "danger" ? theme.danger : theme.accent, borderWidth: variant === "secondary" ? 1 : 0, borderColor: theme.border, overflow: "hidden" }}>
  <View style={{ flexDirection: "row", gap: 10, alignItems: "center", justifyContent: "center", direction: theme.direction }}>
    {#if busy}<ActivityIndicator {color} />{/if}
    <Text style={{ color, fontSize: 16, fontWeight: "600" }}>{label}</Text>
  </View>
</Pressable>
