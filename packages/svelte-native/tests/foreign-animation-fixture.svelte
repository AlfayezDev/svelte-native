<script>
  import AnimatedView from "../src/components/AnimatedView.svelte";
  import ExpoImage from "../src/components/ExpoImage.svelte";
  import Rive from "../src/components/Rive.svelte";
  const fade = () => { "worklet"; return { opacity: 0.5 }; };
  let transition = $state(150);
  export function setTransition(value) { transition = value; }
</script>
<AnimatedView animatedStyle={fade} style={{ height: 10 }} />
<ExpoImage source="https://example.com/a.png" {transition} style={{ height: 20 }} />
<Rive resourceName="rating" animationName="idle" style={{ height: 20 }} />
