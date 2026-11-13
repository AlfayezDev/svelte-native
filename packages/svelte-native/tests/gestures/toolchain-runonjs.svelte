<script lang="ts">
  import { View } from "@alfayez/svelte-native";
  import { Gesture } from "@alfayez/svelte-native/gestures";
  let count = $state(0);
  // On the JS thread the callback reads live state: nothing to copy.
  export const pan = Gesture.Pan().runOnJS(true).onEnd(() => { count = count + 1; });
</script>
<View gesture={pan} />
{count}
