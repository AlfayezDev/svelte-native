<script>
  import BlurView from "../src/components/BlurView.svelte";
  import BlurTargetView from "../src/components/BlurTargetView.svelte";
  import Text from "../src/components/Text.svelte";
  import View from "../src/components/View.svelte";
  let target = $state(null);
  let method = $state("dimezisBlurView");
  let wrapper = null;
  export function setMethod(next) { method = next; }
  export function targetHandle() { return target; }
  export function wrapperHandle() { return wrapper; }
</script>
<View style={{ flex: 1 }}>
  <BlurTargetView ref={(h) => { target = h; }} style={{ height: 120 }}>
    <View style={{ width: 10, height: 10 }} />
  </BlurTargetView>
  <BlurView blurTarget={target} intensity={80} tint="dark" blurReductionFactor={6} blurMethod={method} ref={(h) => { wrapper = h; }} style={{ height: 60, borderRadius: 12 }}>
    <Text>over the blur</Text>
  </BlurView>
</View>
