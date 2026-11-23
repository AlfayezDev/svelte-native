import type { ClassProps } from "../classes.js";
import type { TextInput as NativeTextInput, TextInputProps } from "react-native";
import type { HostHandle } from "../fabric/host.js";
type Handle = NativeTextInput & Pick<HostHandle, "dispatchCommand">;
type $$ComponentProps = TextInputProps & {
    /** Set by the lowering of an HTML `<input>` or `<textarea>` (`lower-html.ts`): the attributes are HTML's (`type`, `disabled`, `oninput`, ...) and are worked out here (`html-input.ts`), and the input takes the text style of the HTML elements around it (`fabric/text-inherit.ts`). */
    nativeHtml?: boolean;
    /** Receives the host handle: React Native's TextInput instance (`focus`, `blur`, `measure`) plus `dispatchCommand`, or null on unmount. The type has React Native's `clear()`, which the host handle does not implement: set the bound `value` to `""`. */
    ref?: (instance: Handle | null) => void;
} & ClassProps;
declare const TextInput: import("svelte").Component<$$ComponentProps, {}, "value">;
type TextInput = ReturnType<typeof TextInput>;
export default TextInput;
