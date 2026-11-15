<script>
  import AnimatedView from "../../../src/components/AnimatedView.svelte";
  import ExpoImage from "../../../src/components/ExpoImage.svelte";
  import Modal from "../../../src/components/Modal.svelte";
  import Rive from "../../../src/components/Rive.svelte";
  import ForeignView from "../../../src/components/ForeignView.svelte";
  const fade = () => { "worklet"; return { opacity: 0.5 }; };
  let transition = $state(150);
  export function setTransition(value) { transition = value; }
</script>
<AnimatedView animatedStyle={fade} style={{ height: 10 }} />
<ExpoImage source="https://example.com/a.png" {transition} style={{ height: 20 }} />
<Rive resourceName="rating" animationName="idle" style={{ height: 20 }} />
<Modal visible animationType="slide" transparent><AnimatedView testID="in-modal" style={{ height: 5 }} /></Modal>
<ForeignView component="RNCWebView">
  <AnimatedView testID="nested" animationName={{ from: { opacity: 0 }, to: { opacity: 1 } }} animationDuration="1s" style={{ height: 5 }} />
</ForeignView>
