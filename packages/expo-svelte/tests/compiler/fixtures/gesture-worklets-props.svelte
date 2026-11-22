<script lang="ts">
  import { View, Gesture } from "expo-svelte";
  let { limit } = $props();
  const pan = Gesture.Pan().onUpdate((e) => { if (e.translationX > limit) console.log("far"); });
</script>
<View gesture={pan} />
