<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import { View } from "@rasheed/svelte-native";
  import { createSharedValue } from "@rasheed/svelte-native/animation";
  import { Gesture } from "@rasheed/svelte-native/gestures";

  /** The view `gestures-churn` mounts and unmounts: three gestures in a Simultaneous, all on the UI thread or all on the JavaScript thread (`js`). */
  let { js, mounted, unmounted }: { js: boolean; mounted: () => void; unmounted: () => void } = $props();
  // svelte-ignore state_referenced_locally
  const onJs = js;
  const hits = createSharedValue(0);

  const pan = onJs ? Gesture.Pan().runOnJS(true).onUpdate(() => { /* counted nowhere: the lab checks what is left behind */ }) : Gesture.Pan().onUpdate(() => { hits.value += 1; });
  const tap = onJs ? Gesture.Tap().runOnJS(true).onEnd(() => { /* as above */ }) : Gesture.Tap().onEnd(() => { hits.value += 1; });
  const longPress = onJs ? Gesture.LongPress().runOnJS(true).onStart(() => { /* as above */ }) : Gesture.LongPress().onStart(() => { hits.value += 1; });
  const all = Gesture.Simultaneous(pan, tap, longPress);
  onMount(() => { mounted(); });
  onDestroy(() => { unmounted(); });
</script>

<View gesture={all} collapsable={false} style={{ width: 60, height: 60, borderRadius: 8, backgroundColor: onJs ? "#d9534f" : "#3685ff" }} />
