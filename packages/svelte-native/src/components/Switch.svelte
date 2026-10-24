<script lang="ts">
  import type { SwitchProps } from "react-native";
  import Host from "./Host.svelte";
  let { value = $bindable(false), onValueChange, ...attributes }: SwitchProps = $props();
</script>
<Host name="native-switch" attributes={{ ...attributes, value, onValueChange: (next: boolean) => { value = next; onValueChange?.(next); } }} />
