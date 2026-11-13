<script lang="ts">
  import type { TextInputProps } from "react-native";
  import { View, Text, TextInput } from "@alfayez/svelte-native";
  import { theme } from "../state.svelte.ts";
  let { label, value = $bindable(""), error, ltr = false, ...attributes }: Omit<TextInputProps, "value"> & { label: string; value?: string; error?: string; ltr?: boolean } = $props();
</script>
<View style={{ gap: 8 }}>
  <Text style={{ color: theme.foreground, fontSize: 15, writingDirection: theme.direction }}>{label}</Text>
  <TextInput {...attributes} bind:value accessibilityLabel={label} placeholderTextColor={theme.muted}
    style={{ minHeight: 52, borderWidth: 1, borderColor: error ? theme.danger : theme.border, borderRadius: 12, overflow: "hidden", paddingHorizontal: 14, paddingVertical: 12, backgroundColor: theme.surface, color: theme.foreground, fontSize: 17, writingDirection: ltr ? "ltr" : theme.direction, textAlign: ltr ? "left" : theme.rtl ? "right" : "left" }} />
  {#if error}<Text accessibilityRole="alert" style={{ color: theme.danger, fontSize: 14, writingDirection: theme.direction }}>{error}</Text>{/if}
</View>
