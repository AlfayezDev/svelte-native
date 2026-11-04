import type { TextInputProps } from "react-native";
import type { RemoteForm, RemoteFormInput } from "$app/server";

type Handlers = { onBlur: () => void };

/** What `fields.x.as("text" | "email" | "password" | "tel" | "url" | "search" | "number" | …)` returns: spread it onto `<TextInput>`. */
export type NativeTextProps = Handlers & Pick<TextInputProps, "keyboardType" | "inputMode" | "secureTextEntry" | "autoCapitalize" | "autoCorrect" | "autoComplete" | "textContentType" | "returnKeyType"> & {
  readonly value: string;
  onChangeText: (text: string) => void;
};
/** What `as("checkbox")` and `as("radio", option)` return: spread it onto `<Switch>`. */
export type NativeToggleProps = Handlers & { readonly value: boolean; onValueChange: (next: boolean) => void };
/** What `as("select")` and `as("select multiple")` return: the value and the setter for a picker of your own. */
export type NativeSelectProps<T = string | string[] | undefined> = Handlers & { readonly value: T; readonly multiple: boolean; onValueChange: (next: T) => void };

export type NativeTextType = "text" | "email" | "password" | "tel" | "url" | "search" | "number" | "range" | "date" | "time" | "datetime-local" | "month" | "week" | "color" | "textarea";

/** The `as` of a native field. */
export interface NativeFieldProps {
  (type: NativeTextType, initial?: string | number): NativeTextProps;
  (type: "checkbox", checked?: boolean): NativeToggleProps;
  (type: "checkbox", option: string, checked?: boolean): NativeToggleProps;
  (type: "radio", option: string): NativeToggleProps;
  (type: "select" | "select multiple", initial?: string | string[]): NativeSelectProps;
  (type: "hidden", value: string | number | boolean): { readonly value: string | number | boolean };
  (type: "submit", value: string | number | boolean): { readonly value: string | number | boolean; onPress: () => void };
}

/** SvelteKit's `form.fields` with `as` replaced by the native one; `value()`, `set()`, `issues()`, `allIssues()`, `touched()` and `dirty()` are SvelteKit's. */
export type NativeFormFields<T> = T extends (...args: never[]) => unknown ? T : { [K in keyof T]: K extends "as" ? NativeFieldProps : NativeFormFields<T[K]> };

/**
 * A remote form as a native screen sees it: SvelteKit's `RemoteForm` without the DOM parts (`action`, `element`, the attachment) and with the
 * native `fields.x.as(type)`, `submit()` (what pressing the submit button does: preflight, `enhance`, send, reset on success) and `reset()`.
 */
export type NativeForm<F> = F extends RemoteForm<infer Input extends RemoteFormInput | void, infer Output>
  ? Omit<RemoteForm<Input, Output>, "fields" | "action" | "element" | "enhance" | "for" | "submit" | symbol> & {
      fields: NativeFormFields<RemoteForm<Input, Output>["fields"]>;
      submit(): Promise<boolean> & { updates: (...updates: unknown[]) => Promise<boolean> };
      reset(): void;
      enhance(callback: (form: Omit<NativeForm<F>, "enhance">) => void | Promise<void>): NativeForm<F>;
      for(id: Parameters<RemoteForm<Input, Output>["for"]>[0]): Omit<NativeForm<F>, "for">;
    }
  : never;

/**
 * A remote form typed for the native `fields.x.as(...)`. It is the same object (a cast): in native code, `as` returns the props of a native
 * input at run time, and SvelteKit's types still describe DOM inputs.
 */
export function native<F extends RemoteForm<never, unknown>>(form: F): NativeForm<F> {
  return form as unknown as NativeForm<F>;
}
