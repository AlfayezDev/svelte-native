<script>
  let on = $state(false);
  export function setOn(value) { on = value; }
  const layout = { move: "a" };
</script>
<native-view nativeHtml={true} testID="run">{#if on}Hi {/if}<native-text nativeHtml="inline" testID="remade" {layout}>x</native-text></native-view>
