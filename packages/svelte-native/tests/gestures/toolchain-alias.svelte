<script lang="ts">
  import { View } from "@rasheed/svelte-native";
  import { Gesture as G } from "@rasheed/svelte-native/gestures";
  // Not a `Gesture.X().onY(...)` chain by name: the babel plugin leaves the callback alone.
  export const pan = G.Pan().onUpdate((e) => { console.log(e.translationX); });
</script>
<View gesture={pan} />
