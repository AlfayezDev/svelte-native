<script lang="ts">
  import { View } from "@rasheed/svelte-native";
  import { Gesture } from "@rasheed/svelte-native/gestures";
  let count = $state(0);
  // On the JS thread the callback reads live state: nothing to copy.
  export const pan = Gesture.Pan().runOnJS(true).onEnd(() => { count = count + 1; });
</script>
<View gesture={pan} />
{count}
