<!-- The control of the type check (tests/node-modules.test.ts): two mistakes, each of which must be reported, and only these. The check reaches the library's source in
     node_modules; if it reported nothing here it would be reporting nothing anywhere. -->
<script lang="ts">
  import { Pressable, Text } from "@example/svelte-native";
  import { Platform } from "@example/svelte-native/platform";
  // The library runs on Android and iOS only: a comparison with another system can never be true.
  const web = Platform.OS === "web";
</script>

<!-- A prop that is not there (the name of the real one is onPressChange). -->
<Pressable onPressChanged={() => {}}><Text>{web}</Text></Pressable>
