<script lang="ts">
  import type {} from "../elements.d.ts";
  import type { ClassProps } from "../classes.ts";
  import { createNativeProps } from "../native-props.ts";
  import type { SwitchProps } from "react-native";
  let { value = $bindable(false), onValueChange, ...attributes }: SwitchProps & ClassProps = $props();
  const resolveProps = createNativeProps();
</script>
<native-switch nativeProps={resolveProps({ ...attributes, value, onValueChange: (next: boolean) => { value = next; onValueChange?.(next); } })}></native-switch>
