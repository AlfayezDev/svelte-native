<script lang="ts">
  import { SafeAreaView, Screen, Text, View, useRouter } from "@alfayez/svelte-native";
  import { nativeLabEnabled, theme } from "#lib/native/state.svelte.ts";
  import Button from "#lib/native/components/Button.svelte";

  /**
   * Pushed within the home pane (the tab bar stays). The account modal needs a session, which the lab does not have, so the
   * modal is the screens lab's header page presented over the whole tab navigator.
   */
  let { params = {} }: { params?: Record<string, string> } = $props();
  const router = useRouter();
</script>

{#if nativeLabEnabled}
  <Screen title={`Detail ${params.id}`} style={{ backgroundColor: theme.background }}>
    <SafeAreaView edges={["left", "right"]} style={{ flex: 1 }}>
      <View style={{ padding: 16, gap: 12, direction: theme.direction }}>
        <Text style={{ color: theme.muted, fontSize: 14 }}>Item {params.id} of the home pane's own stack.</Text>
        <Button label="Back" variant="secondary" onPress={() => router.back()} />
        <Button label="Open account modal" variant="primary" onPress={() => router.goto("/__dev/screens?mode=header&depth=1", { presentation: "modal" })} />
      </View>
    </SafeAreaView>
  </Screen>
{/if}
