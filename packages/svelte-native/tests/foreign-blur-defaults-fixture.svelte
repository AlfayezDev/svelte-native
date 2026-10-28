<script>
  import BlurView from "../src/components/BlurView.svelte";
  import View from "../src/components/View.svelte";
</script>
<View>
  <BlurView />
  <BlurView experimentalBlurMethod="dimezisBlurViewSdk31Plus" />
</View>
