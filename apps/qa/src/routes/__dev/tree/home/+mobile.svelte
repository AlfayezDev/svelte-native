<script lang="ts">
  import { SafeAreaView, Screen, ScrollView, Text, View, useRouter } from "@example/svelte-native";
  import { nativeLabEnabled, theme } from "#lib/native/state.svelte.ts";
  import Button from "#lib/native/components/Button.svelte";

  /** The base page of the home pane of the route-tree lab: rows to scroll and a push within the pane's own stack. */
  const router = useRouter();
  const rows = Array.from({ length: 14 }, (_, index) => index + 1);
</script>

{#if nativeLabEnabled}
  <!-- The subtitle keeps the header's label apart from the tab's own, "Home". -->
  <Screen title="Home" subtitle="Route tree" style={{ backgroundColor: theme.background }}>
    <SafeAreaView edges={["left", "right"]} style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 10, direction: theme.direction }}>
        {#each rows as row (row)}
          <View style={{ padding: 12, borderRadius: 10, borderWidth: 1, overflow: "hidden", borderColor: theme.border, backgroundColor: theme.surface }}>
            <Text style={{ color: theme.foreground, fontSize: 15 }}>Home row {row}</Text>
          </View>
        {/each}
        <Button label="Push detail" variant="primary" onPress={() => router.goto("/__dev/tree/home/detail/7")} />
      </ScrollView>
    </SafeAreaView>
  </Screen>
{/if}
