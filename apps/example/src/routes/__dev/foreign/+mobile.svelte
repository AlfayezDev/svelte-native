<script lang="ts">
  import { List, Screen, Text, View, useRouter } from "@rasheed/svelte-native";
  import { nativeLabEnabled, theme } from "#lib/native/state.svelte.ts";
  import ForeignSet, { type Kind } from "#lib/native/dev/ForeignSet.svelte";
  import { foreignLab } from "#lib/native/dev/foreign.svelte.ts";
  import Button from "#lib/native/components/Button.svelte";

  /**
   * The foreign-views lab (SPEC.md, "Foreign views"), opened by the `foreign-views` stress scenario: `?mode=` picks what
   * the views sit in. `inline` is a plain column, `list` the windowed List (one view per row), `sheet` a native sheet,
   * `cycle` mounts and unmounts one view on the scenario's command.
   */
  let { url }: { url?: URL } = $props();
  const router = useRouter();
  const mode = $derived(url?.searchParams.get("mode") ?? "inline");
  const kinds: Kind[] = Array.from({ length: 24 }, (_, index) => (["web", "map", "video"] as const)[index % 3]);
  let list: { scrollToIndex: (index: number, animated?: boolean) => void } | undefined = $state();
  $effect(() => { if (foreignLab.scrollIndex >= 0) list?.scrollToIndex(foreignLab.scrollIndex, true); });
</script>

{#if nativeLabEnabled}
  {#if mode === "sheet"}
    <Screen sheet={{ detents: [0.9], grabber: true }} style={{ backgroundColor: theme.surface }}>
      <View style={{ padding: 16, paddingTop: 28, gap: 10 }}>
        <Text accessibilityRole="header" style={{ color: theme.foreground, fontSize: 18, fontWeight: "600" }}>Foreign views in a sheet</Text>
        <ForeignSet source="sheet" version={foreignLab.version} height={90} />
        <Button label="Close" onPress={() => router.back()} />
      </View>
    </Screen>
  {:else}
    <Screen title="Foreign views" style={{ backgroundColor: theme.background }}>
      {#if mode === "list"}
        <List bind:this={list} items={kinds} rowHeight={150} keyOf={(_, index) => index} style={{ flex: 1 }} contentContainerStyle={{ padding: 8 }}>
          {#snippet row(kind, index)}
            <View style={{ height: 146 }}><ForeignSet source={`row-${index}`} kinds={[kind]} height={96} /></View>
          {/snippet}
        </List>
      {:else if mode === "cycle"}
        <View style={{ padding: 8 }}>
          {#if foreignLab.cycleVisible}<ForeignSet source="cycle" kinds={[foreignLab.cycleKind === "map-bare" ? "map" : foreignLab.cycleKind]} markers={foreignLab.cycleKind !== "map-bare"} height={96} />{/if}
        </View>
      {:else}
        <View style={{ padding: 8 }}><ForeignSet source="inline" version={foreignLab.version} height={100} /></View>
      {/if}
    </Screen>
  {/if}
{/if}
