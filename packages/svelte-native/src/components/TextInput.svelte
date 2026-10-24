<script lang="ts">
  import type { TextInputProps } from "react-native";
  import Host from "./Host.svelte";
  let { value = $bindable(""), onChangeText, ...attributes }: TextInputProps = $props();
</script>
<Host name="native-input" attributes={{ ...attributes, value, onChangeText: (text: string) => { value = text; onChangeText?.(text); } }} />
