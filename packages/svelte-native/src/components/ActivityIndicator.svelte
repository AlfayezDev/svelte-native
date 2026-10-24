<script lang="ts">
  import type { ActivityIndicatorProps } from "react-native";
  import Host from "./Host.svelte";
  let attributes: ActivityIndicatorProps = $props();
</script>
<Host name="native-spinner" {attributes} />
