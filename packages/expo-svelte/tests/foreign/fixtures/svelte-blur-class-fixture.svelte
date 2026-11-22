<script>
  import BlurView from "../../../src/components/BlurView.svelte";
  import View from "../../../src/components/View.svelte";
</script>
<View>
  <BlurView class="frost" />
  <BlurView class="frost" style={{ backgroundColor: "#00ff00" }} />
  <BlurView />
  <BlurView style={{ backgroundColor: "#ff0000" }} />
</View>
