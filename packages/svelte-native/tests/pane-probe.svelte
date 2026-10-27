<script>
  import { inTabPane } from "../src/fabric/navigation.ts";
  let { name } = $props();
  (globalThis.__paneProbe ??= {})[name] = inTabPane();
</script>
<native-view testID={`probe-${name}`}></native-view>
