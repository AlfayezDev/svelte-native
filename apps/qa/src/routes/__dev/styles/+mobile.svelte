<script lang="ts">
  import { untrack } from "svelte";
  import { Pressable, Text, View } from "expo-svelte";
  import Page from "#lib/native/components/Page.svelte";
  import StyleTile from "#lib/native/dev/StyleTile.svelte";
  import { focusRing, modes, runtimeInput, runtimeLabel, tiles, type Mode } from "#lib/native/dev/styles-cases.ts";

  /**
   * The box styles lab (SPEC.md, "Box styles"; qa/README "Box styles"): the box shadows, borders and transform origins the Android engine draws with React Native's own
   * drawables, one tile each (`styles-cases.ts`). `?mode=shadow` (the default), `?mode=border` and `?mode=origin` each fit one screen. The grid has the `testID`
   * `styles.grid`; the reference app (`qa/styles-reference`) draws the same objects with React Native's own views, and the two are compared tile by tile. In `shadow`
   * an input below the grid goes through three states each time it is pressed (`styles.focus`): a focus ring, then `boxShadow: undefined` (the style key is gone), then the
   * shadow that is off (`0 0 0 0 transparent`), then the ring again, so the ring comes, goes and is taken away at run time.
   */
  let { url }: { url?: URL } = $props();
  const requested = untrack(() => url?.searchParams.get("mode"));
  const mode: Mode = modes.find((name) => name === requested) ?? "shadow";
  let step = $state(0);
  const focused = $derived(step % 3 === 1);
  const shadow = $derived(step % 3 === 1 ? focusRing : step % 3 === 0 ? "0 0 0 0 transparent" : undefined);
</script>

<Page title="Box styles">
  <View testID="styles.grid" style={{ flexDirection: "row", flexWrap: "wrap", width: 336, alignSelf: "center" }}>
    {#each tiles[mode] as tile (tile.id)}
      <StyleTile {tile} />
    {/each}
  </View>
  {#if mode === "shadow"}
    <View testID="styles.runtime" style={{ width: 168, height: 112, alignSelf: "center", alignItems: "center", justifyContent: "center", backgroundColor: "#f4f4f5" }}>
      <Pressable testID="styles.focus" accessibilityRole="button" accessibilityLabel="Focus ring" onPress={() => { step += 1; }} style={{ ...runtimeInput, boxShadow: shadow }}>
        <Text style={runtimeLabel}>{focused ? "Focused" : "Not focused"}</Text>
      </Pressable>
    </View>
  {/if}
</Page>
