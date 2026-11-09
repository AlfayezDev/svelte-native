<script lang="ts">
  import { View } from "@example/svelte-native";
  import { Gesture } from "@example/svelte-native/gestures";
  let count = $state(0);
  export function bump() { count += 1; } // without a write Svelte keeps `count` a plain number
  // Reads `$state` in a UI-thread callback: the closure then holds Svelte's signal.
  const pan = Gesture.Pan().onEnd(() => { console.log(count); });
</script>
<View gesture={pan} />
