<script lang="ts">
  import type {} from "../elements.d.ts";
  import { createNativeProps } from "../native-props.ts";
  import type { TextInput as NativeTextInput, TextInputProps } from "react-native";
  import type { HostHandle } from "../fabric/host.ts";
  let { value = $bindable(""), onChangeText, ref, ...attributes }: TextInputProps & {
    /** Receives the host handle: React Native's TextInput instance (`focus`, `blur`, `measure`) plus `dispatchCommand`, or null on unmount. The type has React Native's `clear()`, which the host handle does not implement: set the bound `value` to `""`. */
    ref?: (instance: (NativeTextInput & Pick<HostHandle, "dispatchCommand">) | null) => void;
  } = $props();
  const resolveProps = createNativeProps();
</script>
<native-input nativeProps={resolveProps({ ...attributes, ref, value, onChangeText: (text: string) => { value = text; onChangeText?.(text); } })}></native-input>
