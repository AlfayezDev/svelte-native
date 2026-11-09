<script lang="ts">
  import { View } from "@example/svelte-native";
  import { Gesture } from "@example/svelte-native/gestures";
  let count = $state(0);
  // On the JS thread the callback reads live state: nothing to copy.
  export const pan = Gesture.Pan().runOnJS(true).onEnd(() => { count = count + 1; });
</script>
<View gesture={pan} />
{count}
