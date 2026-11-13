<script lang="ts">
  import { View, Gesture } from "@alfayez/svelte-native";
  let { limit } = $props();
  const pan = Gesture.Pan().onUpdate((e) => { if (e.translationX > limit) console.log("far"); });
</script>
<View gesture={pan} />
