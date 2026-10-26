<script lang="ts">
  import type {} from "../elements.d.ts";
  import { createNativeProps } from "../native-props.ts";
  import type { TextInput as NativeTextInput, TextInputProps } from "react-native";
  let { value = $bindable(""), onChangeText, ref, ...attributes }: TextInputProps & {
    /** Receives the React Native TextInput instance for `focus`, `blur` and `clear`. */
    ref?: (instance: NativeTextInput | null) => void;
  } = $props();
  const resolveProps = createNativeProps();
</script>
<native-input nativeProps={resolveProps({ ...attributes, ref, value, onChangeText: (text: string) => { value = text; onChangeText?.(text); } })}></native-input>
