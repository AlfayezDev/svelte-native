<script lang="ts">
  import { onMount, untrack } from "svelte";
  import { requireOptionalNativeModule } from "expo-modules-core";
  import { Pressable, Text, View } from "expo-svelte";
  import Page from "#lib/native/components/Page.svelte";
  import StyleTile from "#lib/native/dev/StyleTile.svelte";
  import { focusRing, modes, reuseStyles, runtimeInput, runtimeLabel, tiles, type Mode } from "#lib/native/dev/styles-cases.ts";

  /**
   * The box styles lab (SPEC.md, "Box styles"; qa/README "Box styles"): the box shadows, borders and transform origins the Android engine draws with React Native's own
   * drawables, one tile each (`styles-cases.ts`). `?mode=shadow` (the default), `?mode=border`, `?mode=origin` and `?mode=uniform` each fit one screen. The grid has the `testID`
   * `styles.grid`; the reference app (`qa/styles-reference`) draws the same objects with React Native's own views, and the two are compared tile by tile. In `shadow`
   * an input below the grid goes through three states each time it is pressed (`styles.focus`): a focus ring, then `boxShadow: undefined` (the style key is gone), then the
   * shadow that is off (`0 0 0 0 transparent`), then the ring again, so the ring comes, goes and is taken away at run time.
   */
  let { url }: { url?: URL } = $props();
  const requested = untrack(() => url?.searchParams.get("mode"));
  const mode: Mode = modes.find((name) => name === requested) ?? "shadow";
  // `?rows=300&border=1&cycles=6`: the mount cost of bordered views. 300 rows (a view with a fill, a radius and, with `border=1`, a 1 dp border, holding a text) are mounted and
  // removed `cycles` times, 700 ms apart; the engine logs each transaction (`SvelteEngine: surface=... create=... apply=...ms`), which is what is read.
  const rows = Number(untrack(() => url?.searchParams.get("rows")) ?? 0);
  const bordered = untrack(() => url?.searchParams.get("border")) === "1";
  const cycles = Number(untrack(() => url?.searchParams.get("cycles")) ?? 6);
  // `?reuse=<from>-<to>` (indices of `reuseStyles`; `from` empty for none): ten boxes in the style `from`, removed after 700 ms, ten in the style `to` 700 ms later, made from the views the engine recycled
  // (`[Svelte styles] reuse pooled=N`, logged just before, says how many were waiting). The grid is the one of the tiles, so the screenshot compares with the one of `?reuse=-<to>`, which has no recycled view.
  const reuse = untrack(() => url?.searchParams.get("reuse"));
  const [reuseFrom, reuseTo] = (reuse ?? "-").split("-").map((part) => (part === "" ? null : Number(part)));
  let reusePhase = $state<"from" | "gap" | "to">(reuseFrom === null ? "to" : "from");
  const engineStats = requireOptionalNativeModule<{ stats?: () => Record<string, number> | null }>("SvelteEngine");
  onMount(() => {
    if (reuse === null || reuseFrom === null) return;
    const gone = setTimeout(() => { reusePhase = "gap"; }, 700);
    const back = setTimeout(() => { console.info(`[Svelte styles] reuse pooled=${engineStats?.stats?.()?.pooled ?? -1}`); reusePhase = "to"; }, 1400);
    return () => { clearTimeout(gone); clearTimeout(back); };
  });
  let shown = $state(false);
  onMount(() => {
    if (rows === 0) return;
    let count = 0;
    const timer = setInterval(() => {
      shown = !shown;
      if (shown) console.info(`[Svelte styles] rows mount ${++count}`);
      else if (count >= cycles) { console.info("[Svelte styles] rows done"); clearInterval(timer); }
    }, 700);
    return () => clearInterval(timer);
  });
  let step = $state(0);
  const focused = $derived(step % 3 === 1);
  const shadow = $derived(step % 3 === 1 ? focusRing : step % 3 === 0 ? "0 0 0 0 transparent" : undefined);
</script>

<Page title="Box styles">
  {#if reuse !== null}
    <!-- the removed grid is gone for 700 ms before the next one: the views it held are waiting in the pool -->
    {#if reusePhase === "from" && reuseFrom !== null}
      <View style={{ flexDirection: "row", flexWrap: "wrap", width: 336, alignSelf: "center" }}>
        {#each Array.from({ length: 10 }, (_, i) => i) as i (i)}
          <View style={{ width: 168, height: 112, alignItems: "center", justifyContent: "center", backgroundColor: "#f4f4f5" }}><View style={reuseStyles[reuseFrom]} /></View>
        {/each}
      </View>
    {:else if reusePhase === "to" && reuseTo !== null}
      <View testID="styles.grid" style={{ flexDirection: "row", flexWrap: "wrap", width: 336, alignSelf: "center" }}>
        {#each Array.from({ length: 10 }, (_, i) => i) as i (i)}
          <View style={{ width: 168, height: 112, alignItems: "center", justifyContent: "center", backgroundColor: "#f4f4f5" }}><View style={reuseStyles[reuseTo]} /></View>
        {/each}
      </View>
    {/if}
  {:else if rows > 0}
    <View testID="styles.rows">
      {#if shown}
        {#each Array.from({ length: rows }, (_, i) => i) as i (i)}
          <View style={{ flexDirection: "row", alignItems: "center", height: 40, marginBottom: 4, paddingHorizontal: 12, borderRadius: 8, backgroundColor: "#ffffff", ...(bordered ? { borderWidth: 1, borderColor: "#d4d4d8" } : {}) }}>
            <Text style={{ fontSize: 14, color: "#18181b" }}>Row {i}</Text>
          </View>
        {/each}
      {/if}
    </View>
  {:else}
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
  {/if}
</Page>
