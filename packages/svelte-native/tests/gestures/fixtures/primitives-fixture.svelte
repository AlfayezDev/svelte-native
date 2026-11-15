<script>
  // `gesture` on every primitive, lowered to its host tag (`View`, `Text`, ...) and as the component (`AnimatedView`, a View
  // that is not lowered), through `<GestureDetector>`, and through the `use:gesture` action.
  import { View, Text, Pressable, ScrollView, Image, gesture } from "@alfayez/svelte-native";
  import AnimatedView from "../../../src/components/AnimatedView.svelte";
  import ViewComponent from "../../../src/components/View.svelte";
  import GestureDetector from "../../../src/components/GestureDetector.svelte";
  let { gestures } = $props();
</script>
<View testID="view" gesture={gestures.view} />
<Pressable testID="pressable" gesture={gestures.pressable} />
<ScrollView testID="scroll" gesture={gestures.scroll} />
<Image testID="image" source={{ uri: "https://example.test/x.png" }} gesture={gestures.image} />
<Text testID="text" gesture={gestures.text}>hi</Text>
<AnimatedView testID="animated" gesture={gestures.animated} />
<ViewComponent testID="component" gesture={gestures.component} />
<GestureDetector testID="detector" gesture={gestures.detector}><Text>child</Text></GestureDetector>
<View testID="action" use:gesture={gestures.action} />
