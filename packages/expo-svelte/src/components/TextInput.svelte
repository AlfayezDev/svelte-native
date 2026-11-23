<script lang="ts">
  import type {} from "../elements.d.ts";
  import type { ClassProps } from "../classes.ts";
  import { createNativeProps } from "../native-props.ts";
  import type { TextInputInstance as NativeTextInput, TextInputProps } from "react-native";
  import type { HostHandle } from "../fabric/host.ts";
  import { htmlTextInput } from "../html-input.ts";
  import { textInputProps } from "../text-input-props.ts";
  let { value = $bindable(""), onChangeText, ref, nativeHtml, ...attributes }: TextInputProps & {
    /** Set by the lowering of an HTML `<input>` or `<textarea>` (`lower-html.ts`): the attributes are HTML's (`type`, `disabled`, `oninput`, ...) and are worked out here (`html-input.ts`), and the input takes the text style of the HTML elements around it (`fabric/text-inherit.ts`). */
    nativeHtml?: boolean;
    /** Receives the host handle: React Native's TextInput instance (`focus`, `blur`, `measure`) plus `dispatchCommand`, or null on unmount. The type has React Native's `clear()`, which the host handle does not implement: set the bound `value` to `""`. */
    ref?: (instance: (NativeTextInput & Pick<HostHandle, "dispatchCommand">) | null) => void;
  } & ClassProps = $props();
  const resolveProps = createNativeProps();
  const html = $derived(nativeHtml ? htmlTextInput(attributes as Record<string, unknown>) : undefined);
</script>
<native-input nativeHtml={nativeHtml} nativeProps={resolveProps({ ...textInputProps(html?.props ?? attributes), ref, value: value === null || value === undefined ? "" : String(value), onChangeText: (text: string) => { value = text; onChangeText?.(text); html?.onChangeText?.(text); } })}></native-input>
