<script lang="ts">
  import { List, Screen, ScrollView, Text, View, useRouter } from "@rasheed/svelte-native";
  import { nativeLabEnabled, theme } from "#lib/native/state.svelte.ts";
  import ForeignSet, { type Kind } from "#lib/native/dev/ForeignSet.svelte";
  import LibrarySet, { libraryKinds, type LibraryKind } from "#lib/native/dev/LibrarySet.svelte";
  import { foreignLab } from "#lib/native/dev/foreign.svelte.ts";
  import Button from "#lib/native/components/Button.svelte";

  /**
   * The foreign-views lab (SPEC.md, "Foreign views"), opened by the `foreign-views` stress scenario: `?mode=` picks what
   * the views sit in. `inline` is a plain column, `list` the windowed List (one view per row), `sheet` a native sheet,
   * `cycle` mounts and unmounts one view on the scenario's command. `libraries`, `libraries-list` and `libraries-sheet` are the
   * same three places for the thirteen native-view libraries (expo-image, expo-blur, expo-linear-gradient, react-native-video,
   * datetimepicker, lottie-react-native, react-native-pdf, react-native-view-shot, rive-react-native, expo-conic-gradient,
   * react-native-fast-shadow, react-native-animateable-text, react-native-svg): a section per library, one library per list row, all thirteen in a sheet.
   */
  let { url }: { url?: URL } = $props();
  const router = useRouter();
  const mode = $derived(url?.searchParams.get("mode") ?? "inline");
  /** `&kind=<library>` shows one library's section in `libraries` and `libraries-sheet` (what the checks of `foreign-libraries-lab.ts` open); none shows all thirteen. */
  const only = $derived(url?.searchParams.get("kind") as LibraryKind | null);
  const shownKinds = $derived<readonly LibraryKind[]>(only && libraryKinds.includes(only) ? [only] : libraryKinds);
  const kinds: Kind[] = Array.from({ length: 24 }, (_, index) => (["web", "map", "video"] as const)[index % 3]);
  let list: { scrollToIndex: (index: number, animated?: boolean) => void } | undefined = $state();
  // `scrollIndex` -2 is "scroll without animation" for the library checks (an animated scroll to a row far down was not always followed by the rows it passes).
  $effect(() => { if (foreignLab.scrollIndex >= 0) list?.scrollToIndex(foreignLab.scrollIndex, foreignLab.scrollAnimated); });
</script>

{#if nativeLabEnabled}
  {#if mode === "libraries-sheet"}
    <Screen sheet={{ detents: [0.9], grabber: true }} style={{ backgroundColor: theme.surface }}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingTop: 28, gap: 10 }}>
        <Text accessibilityRole="header" style={{ color: theme.foreground, fontSize: 18, fontWeight: "600" }}>Native-view libraries in a sheet</Text>
        <LibrarySet source="libraries-sheet" kinds={shownKinds} height={90} />
        <Button label="Close" onPress={() => router.back()} />
      </ScrollView>
    </Screen>
  {:else if mode === "sheet"}
    <Screen sheet={{ detents: [0.9], grabber: true }} style={{ backgroundColor: theme.surface }}>
      <View style={{ padding: 16, paddingTop: 28, gap: 10 }}>
        <Text accessibilityRole="header" style={{ color: theme.foreground, fontSize: 18, fontWeight: "600" }}>Foreign views in a sheet</Text>
        <ForeignSet source="sheet" version={foreignLab.version} height={90} />
        <Button label="Close" onPress={() => router.back()} />
      </View>
    </Screen>
  {:else}
    <Screen title="Foreign views" style={{ backgroundColor: theme.background }}>
      {#if mode === "libraries"}
        <ScrollView contentContainerStyle={{ padding: 8 }}><LibrarySet source="libraries" kinds={shownKinds} /></ScrollView>
      {:else if mode === "libraries-list"}
        <List bind:this={list} items={[...libraryKinds]} rowHeight={150} keyOf={(_, index) => index} style={{ flex: 1 }} contentContainerStyle={{ padding: 8 }}>
          {#snippet row(kind, index)}
            <View style={{ height: 146 }}><LibrarySet source={`libraries-row-${index}`} kinds={[kind]} height={100} /></View>
          {/snippet}
        </List>
      {:else if mode === "list"}
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
