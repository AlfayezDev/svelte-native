<script lang="ts">
  import { View } from "@alfayez/svelte-native";
  import { Gesture } from "@alfayez/svelte-native/gestures";
  let { limit } = $props();
  const pan = Gesture.Pan().onUpdate((e) => { if (e.translationX > limit) console.log("far"); });
</script>
<View gesture={pan} />
