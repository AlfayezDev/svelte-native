<script>
  import ExpoBlurView from "../../../src/components/ExpoBlurView.svelte";
  import BlurTargetView from "../../../src/components/BlurTargetView.svelte";
  import Text from "../../../src/components/Text.svelte";
  import View from "../../../src/components/View.svelte";
  let target = $state(null);
  let method = $state("dimezisBlurView");
  let wrapper = null;
  let showTarget = $state(true);
  export function setMethod(next) { method = next; }
  export function targetHandle() { return target; }
  export function wrapperHandle() { return wrapper; }
  export function removeTarget() { showTarget = false; }
</script>
<View style={{ flex: 1 }}>
  {#if showTarget}
    <BlurTargetView ref={(h) => { target = h; }} style={{ height: 120 }}>
      <View style={{ width: 10, height: 10 }} />
    </BlurTargetView>
  {/if}
  <ExpoBlurView blurTarget={target} intensity={80} tint="dark" blurReductionFactor={6} blurMethod={method} ref={(h) => { wrapper = h; }} style={{ height: 60, borderRadius: 12 }}>
    <Text>over the blur</Text>
  </ExpoBlurView>
</View>
