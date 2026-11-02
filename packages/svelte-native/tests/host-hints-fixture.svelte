<script>
  // A first screen that wants no animation, and a node that wants only the CSS `transition` shorthand once asked to.
  let shorthand = $state(false);
  export function useShorthand() { shorthand = true; }
</script>
<native-view testID="plain" nativeStyle={{ padding: 1 }}></native-view>
{#if shorthand}
  <native-view testID="shorthand" nativeStyle={{ padding: 2, transition: "opacity 300ms" }}></native-view>
{/if}
