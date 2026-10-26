<script>
  import { useHeader } from "../src/components/Screen.svelte";
  const header = useHeader();
</script>

<native-view testID={`header-${header.height}-${header.inset}`}></native-view>
