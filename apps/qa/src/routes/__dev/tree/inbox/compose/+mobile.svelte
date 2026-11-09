<script lang="ts" module>
  export const presentation = "sheet";
</script>
<script lang="ts">
  import { Screen, TextInput, View, useRouter } from "@example/svelte-native";
  import { nativeLabEnabled, theme } from "#lib/native/state.svelte.ts";
  import Button from "#lib/native/components/Button.svelte";

  /** A sheet of the inbox pane's stack. */
  const router = useRouter();
  let message = $state("");
</script>

{#if nativeLabEnabled}
  <Screen title="New message" sheet={{ grabber: true }} style={{ backgroundColor: theme.surface }}>
    <View style={{ padding: 16, paddingTop: 28, gap: 12, direction: theme.direction }}>
      <TextInput accessibilityLabel="Message" placeholder="Message" placeholderTextColor={theme.muted} bind:value={message} style={{ minHeight: 52, borderWidth: 1, borderColor: theme.border, borderRadius: 12, overflow: "hidden", paddingHorizontal: 14, backgroundColor: theme.background, color: theme.foreground, fontSize: 17 }} />
      <Button label="Done" variant="primary" onPress={() => router.back()} />
    </View>
  </Screen>
{/if}
