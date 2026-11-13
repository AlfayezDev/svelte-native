<script lang="ts">
  import { Pressable, Text, View } from "@alfayez/svelte-native";
  import { text, theme } from "#lib/theme.svelte.ts";

  // One row of the home screen: the feature's name and its one-line description, and an arrow that a screen reader skips. The row dims while it is pressed.
  let { title, summary, first, onPress }: { title: string; summary: string; first: boolean; onPress: () => void } = $props();
  let pressed = $state(false);
</script>

<Pressable
  accessibilityRole="button"
  {onPress}
  onPressIn={() => (pressed = true)}
  onPressOut={() => (pressed = false)}
  style={{
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    minHeight: 64,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderTopWidth: first ? 0 : 1,
    borderTopColor: theme.colors.border,
    opacity: pressed ? 0.6 : 1,
  }}
>
  <View style={{ flex: 1, gap: 2 }}>
    <Text style={text.heading}>{title}</Text>
    <Text style={text.caption}>{summary}</Text>
  </View>
  <Text aria-hidden={true} style={[text.heading, { color: theme.colors.muted }]}>›</Text>
</Pressable>
