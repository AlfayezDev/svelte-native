<script lang="ts">
  import { SafeAreaView, Screen, ScrollView, Text, View, useRouter } from "@rasheed/svelte-native";
  import { nativeLabEnabled, theme } from "#lib/native/state.svelte.ts";
  import Button from "#lib/native/components/Button.svelte";

  /** The base page of the inbox pane of the route-tree lab: rows and a sheet over the pane. */
  const router = useRouter();
  const rows = Array.from({ length: 14 }, (_, index) => index + 1);
</script>

{#if nativeLabEnabled}
  <Screen title="Inbox" style={{ backgroundColor: theme.background }}>
    <SafeAreaView edges={["left", "right"]} style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 10, direction: theme.direction }}>
        {#each rows as row (row)}
          <View style={{ padding: 12, borderRadius: 10, borderWidth: 1, overflow: "hidden", borderColor: theme.border, backgroundColor: theme.surface }}>
            <Text style={{ color: theme.foreground, fontSize: 15 }}>Message {row}</Text>
          </View>
        {/each}
        <Button label="Compose" variant="primary" onPress={() => router.goto("/__dev/tree/inbox/compose")} />
      </ScrollView>
    </SafeAreaView>
  </Screen>
{/if}
