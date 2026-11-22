<script>
  import { useToolbar } from "../../../src/components/Screen.svelte";
  const toolbar = useToolbar();
</script>

<native-view testID={`toolbar-${toolbar.height}-${toolbar.inset}`}></native-view>
