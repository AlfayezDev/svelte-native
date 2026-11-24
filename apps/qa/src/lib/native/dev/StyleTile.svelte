<script lang="ts">
  import { onMount, untrack } from "svelte";
  import { AnimatedView, View, createSharedValue, withTiming, ReduceMotion } from "expo-svelte";
  import type { Tile } from "./styles-cases.ts";

  /**
   * One tile of the box styles lab (`styles-cases.ts`): the box on a grey cell. A tile with `to` is turned by Reanimated (the animated write path) to the values it names,
   * about the `transformOrigin` of its style, and stays there: the reference draws that end state as a static transform.
   */
  let { tile }: { tile: Tile } = $props();
  const turn = untrack(() => tile.to);
  const progress = turn ? createSharedValue(0) : null;
  const degrees = turn?.rotate === undefined ? 0 : parseFloat(turn.rotate);
  const scale = turn?.scale ?? 1;
  const animatedStyle = () => {
    "worklet";
    const value = progress ? progress.value : 0;
    return { transform: [{ rotate: `${value * degrees}deg` }, { scale: 1 + value * (scale - 1) }] };
  };
  onMount(() => {
    if (progress) progress.value = withTiming(1, { duration: 300, reduceMotion: ReduceMotion.Never });
  });
</script>

<View style={{ width: 168, height: 112, alignItems: "center", justifyContent: "center", backgroundColor: "#f4f4f5" }}>
  {#if progress}
    <AnimatedView {animatedStyle} style={tile.style}>{#if tile.bar}<View style={tile.bar} />{/if}</AnimatedView>
  {:else}
    <View style={tile.style}>{#if tile.bar}<View style={tile.bar} />{/if}</View>
  {/if}
</View>
