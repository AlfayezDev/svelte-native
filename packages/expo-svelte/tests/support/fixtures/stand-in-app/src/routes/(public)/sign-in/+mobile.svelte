<script lang="ts">
  import { Text, View } from "expo-svelte";
  import { labEnabled } from "#lib/flag.ts";
  import LabLink from "#lib/lab/LabLink.svelte";
</script>
<View>
  <Text>Sign in</Text>
  {#if labEnabled}<LabLink />{/if}
</View>
