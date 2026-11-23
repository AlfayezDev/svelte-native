<script lang="ts">
  import { onDestroy } from "svelte";
  import type {} from "../elements.d.ts";
  import type { ClassProps } from "../classes.ts";
  import { createNativeProps } from "../native-props.ts";
  import type { TextInput as NativeTextInput, TextInputProps } from "react-native";
  import type { HostHandle } from "../fabric/host.ts";
  import { htmlTextInput } from "../html-input.ts";
  import { inputBlurred, inputFocused, inputGone } from "../keyboard.ts";
  import { textInputProps } from "../text-input-props.ts";
  type Handle = NativeTextInput & Pick<HostHandle, "dispatchCommand">;
  type FocusEvent = Parameters<NonNullable<TextInputProps["onFocus"]>>[0];
  let { value = $bindable(""), onChangeText, ref, nativeHtml, ...attributes }: TextInputProps & {
    /** Set by the lowering of an HTML `<input>` or `<textarea>` (`lower-html.ts`): the attributes are HTML's (`type`, `disabled`, `oninput`, ...) and are worked out here (`html-input.ts`), and the input takes the text style of the HTML elements around it (`fabric/text-inherit.ts`). */
    nativeHtml?: boolean;
    /** Receives the host handle: React Native's TextInput instance (`focus`, `blur`, `measure`) plus `dispatchCommand`, or null on unmount. The type has React Native's `clear()`, which the host handle does not implement: set the bound `value` to `""`. */
    ref?: (instance: Handle | null) => void;
  } & ClassProps = $props();
  const resolveProps = createNativeProps();
  const html = $derived(nativeHtml ? htmlTextInput(attributes as Record<string, unknown>) : undefined);
  // React Native's record of the focused input, which `Keyboard.dismiss()` blurs (`keyboard.ts`), is kept from the focus and blur events with the
  // input's handle, as React Native's `TextInput` keeps it, and a focused input that is destroyed is blurred. The first handle stays the one
  // recorded: one given after the `ref` changed reaches the same view, but is another object.
  let handle: Handle | null = null;
  const own = $derived.by(() => {
    const given = ref;
    return (instance: Handle | null) => {
      handle ??= instance;
      given?.(instance);
    };
  });
  onDestroy(() => { if (handle) inputGone(handle); });
  function recorded(props: TextInputProps): TextInputProps {
    const { onFocus, onBlur } = props;
    return {
      ...props,
      onFocus: (event: FocusEvent) => { if (handle) inputFocused(handle); onFocus?.(event); },
      onBlur: (event: FocusEvent) => { if (handle) inputBlurred(handle); onBlur?.(event); },
    };
  }
</script>
<native-input nativeHtml={nativeHtml} nativeProps={resolveProps({ ...recorded(textInputProps(html?.props ?? attributes)), ref: own, value: value === null || value === undefined ? "" : String(value), onChangeText: (text: string) => { value = text; onChangeText?.(text); html?.onChangeText?.(text); } })}></native-input>
