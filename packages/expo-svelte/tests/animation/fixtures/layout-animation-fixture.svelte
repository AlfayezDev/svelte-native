<script>
  let layout = $state({ move: "a" });
  let exiting = $state({ fade: "out" });
  let late = $state(false);
  export function showEntering() { late = true; }
  export function swapLayout() { layout = { move: "b" }; }
  export function dropExiting() { exiting = undefined; }
  const entering = { build: "entering" };
</script>
<native-animated-view testID="entering" {entering} {exiting} {layout}></native-animated-view>
{#if late}<native-animated-view testID="late" entering={entering}></native-animated-view>{/if}
