<script lang="ts">
  import { View, Gesture } from "expo-svelte";
  // A SharedValue stand-in: what an inline UI-thread callback may capture.
  const x = { value: 0, _isReanimatedSharedValue: true };
  export const pan = Gesture.Pan()
    .onUpdate((e) => { x.value = e.translationX; })
    .onEnd(() => { x.value = 0; });
</script>
<View gesture={pan} />
