<script lang="ts">
  import { View, Gesture as G } from "@alfayez/svelte-native";
  // Not a `Gesture.X().onY(...)` chain by name: the babel plugin leaves the callback alone.
  export const pan = G.Pan().onUpdate((e) => { console.log(e.translationX); });
</script>
<View gesture={pan} />
