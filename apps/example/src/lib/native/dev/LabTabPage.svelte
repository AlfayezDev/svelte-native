<script lang="ts">
  import { Screen, ScrollView, Text, View, useRouter } from "@rasheed/svelte-native";
  import Button from "../components/Button.svelte";
  import { theme } from "../state.svelte.ts";
  /** A screen of one tab's own stack in the screens lab: `/[tab]` is the tab's root, `/[tab]/[depth]` a screen pushed on it. */
  let { params }: { params: Record<string, string> } = $props();
  const router = useRouter();
  const root = useRouter("root");
  const depth = $derived(Number.parseInt(params.depth ?? "0", 10) || 0);
  const name = $derived(`${params.tab?.slice(0, 1).toUpperCase()}${params.tab?.slice(1)}`);
</script>

{#snippet actions()}
  <Text accessibilityRole="button" style={{ color: theme.foreground, fontSize: 15, paddingHorizontal: 16, minHeight: 48, textAlignVertical: "center" }} onPress={() => root.goto("/__dev/screens?mode=header&depth=1", { presentation: "modal" })}>Modal</Text>
{/snippet}
<Screen title={depth === 0 ? name : `${name} · ${depth}`} subtitle={`This tab's own stack, level ${depth + 1}`} headerRight={actions} style={{ backgroundColor: theme.background }}>
  <ScrollView contentContainerStyle={{ padding: 16, gap: 10, direction: theme.direction }}>
    {#each Array.from({ length: 16 }, (_, index) => index + 1) as row (row)}
      <View style={{ padding: 12, borderRadius: 10, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.surface }}>
        <Text style={{ color: theme.foreground, fontSize: 15 }}>{name} row {row}</Text>
      </View>
    {/each}
    <Button label="Push on this tab" onPress={() => router.goto(`/${params.tab}/${depth + 1}`)} />
    <Button label="Open a sheet on the root stack" variant="secondary" onPress={() => root.goto("/__dev/screens?mode=sheet", { presentation: "sheet" })} />
  </ScrollView>
</Screen>
