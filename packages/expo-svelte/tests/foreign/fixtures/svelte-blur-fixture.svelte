<script>
  import BlurView from "../../../src/components/BlurView.svelte";
  import Text from "../../../src/components/Text.svelte";
  import View from "../../../src/components/View.svelte";
  let intensity = $state(80);
  let tint = $state("dark");
  let wrapper = null;
  export function setIntensity(next) { intensity = next; }
  export function setTint(next) { tint = next; }
  export function wrapperHandle() { return wrapper; }
</script>
<View style={{ flex: 1 }}>
  <BlurView {intensity} {tint} ref={(h) => { wrapper = h; }} style={{ height: 60, borderRadius: 12, overflow: "hidden" }}>
    <Text>over the blur</Text>
  </BlurView>
  <BlurView />
</View>
