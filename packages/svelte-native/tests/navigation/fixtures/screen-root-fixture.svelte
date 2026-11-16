<script>
  import Screen from "../../../src/components/Screen.svelte";
  // No stack and no screen above: the app shell's startup page is the outermost screen of its subtree.
</script>

<Screen title="Root">
  <native-view testID="page"></native-view>
  <Screen subtitle="Nested"><native-view testID="nested"></native-view></Screen>
</Screen>
