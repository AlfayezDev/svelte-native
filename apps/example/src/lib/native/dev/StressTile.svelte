<script lang="ts">
  import { onMount, untrack } from "svelte";
  import { AnimatedView, createSharedValue, withTiming, withRepeat, withSequence, ReduceMotion, type SharedValue } from "@rasheed/svelte-native/animation";

  let { id, completions, mounted, removed }: {
    id: number;
    completions: SharedValue<number>;
    mounted: (id: number, value: SharedValue<number>) => void;
    removed: (id: number) => void;
  } = $props();
  const position = createSharedValue(0);
  const completed = untrack(() => completions);
  function cycle(finished?: boolean) { "worklet"; if (finished) completed.value++; }
  const animatedStyle = () => {
    "worklet";
    return { opacity: 0.3 + position.value * 0.7, transform: [{ translateY: position.value * 10 }, { scale: 0.7 + position.value * 0.3 }] };
  };
  onMount(() => {
    const key = id;
    mounted(key, position);
    position.value = withRepeat(withSequence(
      withTiming(1, { duration: 400, reduceMotion: ReduceMotion.Never }, cycle),
      withTiming(0, { duration: 400, reduceMotion: ReduceMotion.Never }, cycle),
    ), -1);
    return () => removed(key);
  });
</script>

<AnimatedView {animatedStyle} accessibilityLabel={`Stress tile ${id}`} style={{ width: 32, height: 32, borderRadius: 7, backgroundColor: "#3685ff" }} />
