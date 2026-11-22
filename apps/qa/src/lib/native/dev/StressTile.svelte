<script lang="ts">
  import { onMount, untrack } from "svelte";
  import { View } from "expo-svelte/core";
  import { AnimatedView, createSharedValue, withTiming, withRepeat, withSequence, ReduceMotion, type SharedValue } from "expo-svelte";

  let { id, animated = true, variant = "default", completions, mounted, removed }: {
    id: number;
    animated?: boolean;
    /** `square` drops the rounded corners; `translate` animates only translateY; `css` runs the same motion as a Reanimated CSS keyframe animation (no worklet per frame). */
    variant?: "default" | "square" | "translate" | "css";
    completions: SharedValue<number>;
    mounted: (id: number, value: SharedValue<number> | null) => void;
    removed: (id: number) => void;
  } = $props();
  const translateOnly = untrack(() => variant) === "translate";
  const css = untrack(() => variant) === "css";
  const keyframes = {
    from: { opacity: 0.3, transform: [{ translateY: 0 }, { scale: 0.7 }] },
    to: { opacity: 1, transform: [{ translateY: 10 }, { scale: 1 }] },
  };
  const position = untrack(() => animated) && !css ? createSharedValue(0) : null;
  const completed = untrack(() => completions);
  const tileStyle = { width: 32, height: 32, borderRadius: untrack(() => variant) === "square" ? 0 : 7, backgroundColor: "#3685ff" };
  function cycle(finished?: boolean) { "worklet"; if (finished) completed.value++; }
  const animatedStyle = () => {
    "worklet";
    const value = position ? position.value : 0;
    if (translateOnly) return { transform: [{ translateY: value * 10 }] };
    return { opacity: 0.3 + value * 0.7, transform: [{ translateY: value * 10 }, { scale: 0.7 + value * 0.3 }] };
  };
  onMount(() => {
    const key = id;
    mounted(key, position);
    if (position) position.value = withRepeat(withSequence(
      withTiming(1, { duration: 400, reduceMotion: ReduceMotion.Never }, cycle),
      withTiming(0, { duration: 400, reduceMotion: ReduceMotion.Never }, cycle),
    ), -1);
    return () => removed(key);
  });
</script>

{#if css}
  <AnimatedView accessibilityLabel={`Stress tile ${id}`} style={{ ...tileStyle, animationName: keyframes, animationDuration: "400ms", animationTimingFunction: "linear", animationIterationCount: "infinite", animationDirection: "alternate" }} />
{:else if position}
  <AnimatedView {animatedStyle} accessibilityLabel={`Stress tile ${id}`} style={tileStyle} />
{:else}
  <View accessibilityLabel={`Static tile ${id}`} style={tileStyle} />
{/if}
