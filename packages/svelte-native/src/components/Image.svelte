<script lang="ts">
  import type { ImageProps } from "react-native";
  import Host from "./Host.svelte";
  let attributes: ImageProps = $props();
</script>
<Host name="native-image" {attributes} />
