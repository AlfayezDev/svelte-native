<script>
  // A spread on a lowered primitive carries a function-valued `ref` (Svelte's `set_attributes` skips every function that is not an
  // `on*` handler), next to explicit function attributes on the same element and an event handler in the spread.
  import { View, Text, ScrollView } from "@alfayez/svelte-native";
  let { probe, explicit, clicked } = $props();
</script>
<View {...probe("spread")} />
<View {...probe("mixed")} ref={explicit} testID="mixed" />
<View ref={explicit} {...probe("after")} />
<ScrollView {...probe("scroll")} />
<Text {...probe("text")} onPress={clicked}>x</Text>
