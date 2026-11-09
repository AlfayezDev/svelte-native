<script lang="ts">
  import { Pressable, Text } from "@rasheed/svelte-native";
  import { theme } from "#lib/theme.svelte.ts";

  // A button: a `Pressable` that dims while a finger is on it (`onPressIn` and `onPressOut`) and says what it is to a screen reader.
  let { label, onPress, variant = "primary", disabled = false }: {
    label: string;
    onPress: () => void;
    variant?: "primary" | "secondary";
    disabled?: boolean;
  } = $props();
  let pressed = $state(false);
  const primary = $derived(variant === "primary");
</script>

<Pressable
  accessibilityRole="button"
  accessibilityState={{ disabled }}
  {disabled}
  {onPress}
  onPressIn={() => (pressed = true)}
  onPressOut={() => (pressed = false)}
  style={{
    minHeight: 48,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: primary ? 0 : 1,
    borderColor: theme.colors.border,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: primary ? theme.colors.accent : theme.colors.surface,
    opacity: disabled ? 0.4 : pressed ? 0.7 : 1,
  }}
>
  <Text style={{ color: primary ? theme.colors.onAccent : theme.colors.text, fontSize: 16, fontWeight: "600" }}>{label}</Text>
</Pressable>
