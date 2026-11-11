<script lang="ts">
  import type {} from "../elements.d.ts";
  import type { ClassProps } from "../classes.ts";
  import { createNativeProps } from "../native-props.ts";
  import type { TextInput as NativeTextInput, TextInputProps } from "react-native";
  import type { HostHandle } from "../fabric/host.ts";
  let { value = $bindable(""), onChangeText, ref, nativeHtml, ...attributes }: TextInputProps & {
    /** Set by the lowering of an HTML `<input>` (`lower-html.ts`): the input takes the text style of the HTML elements around it (`fabric/text-inherit.ts`). */
    nativeHtml?: boolean;
    /** Receives the host handle: React Native's TextInput instance (`focus`, `blur`, `measure`) plus `dispatchCommand`, or null on unmount. The type has React Native's `clear()`, which the host handle does not implement: set the bound `value` to `""`. */
    ref?: (instance: (NativeTextInput & Pick<HostHandle, "dispatchCommand">) | null) => void;
  } & ClassProps = $props();
  const resolveProps = createNativeProps();
</script>
<native-input nativeHtml={nativeHtml} nativeProps={resolveProps({ ...attributes, ref, value, onChangeText: (text: string) => { value = text; onChangeText?.(text); } })}></native-input>
