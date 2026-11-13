// biome-ignore-all lint/suspicious/noExplicitAny: mirrors SvelteKit's own generics
import type { NativeFile } from "./files.ts";
import type { TextInputProps } from "react-native";
import type { RemoteForm, RemoteFormInput } from "$app/server";

/** `ref` tells the form when the host has the input and when it is gone: a field whose inputs are all gone is not submitted. Spread the props and it is done. */
type Handlers = { onBlur: () => void; ref: (handle: unknown) => void };

/** What `fields.x.as("text" | "email" | "password" | "tel" | "url" | "search" | "number" | …)` returns: spread it onto `<TextInput>`. */
export type NativeTextProps = Handlers & Pick<TextInputProps, "keyboardType" | "inputMode" | "secureTextEntry" | "autoCapitalize" | "autoCorrect" | "autoComplete" | "textContentType" | "returnKeyType"> & {
  readonly value: string;
  onChangeText: (text: string) => void;
};
/** What `as("checkbox")` and `as("radio", option)` return: spread it onto `<Switch>`. */
export type NativeToggleProps = Handlers & { readonly value: boolean; onValueChange: (next: boolean) => void };
/** What `as("select")` and `as("select multiple")` return: the value and the setter for a picker of your own. */
export type NativeSelectProps<T = string | string[] | undefined> = Handlers & { readonly value: T; readonly multiple: boolean; onValueChange: (next: T) => void };

/** Picker adapter: pass bytes-backed NativeFile values, never a picker URI. */
export type NativeFileProps<T = NativeFile | undefined> = Handlers & { readonly value: T; readonly multiple: boolean; onValueChange: (next: T) => void };

export type NativeTextType = "text" | "email" | "password" | "tel" | "url" | "search" | "number" | "range" | "date" | "time" | "datetime-local" | "month" | "week" | "color" | "textarea";

/** The `as` of a native field. */
export interface NativeFieldProps {
  (type: "file"): NativeFileProps;
  (type: "file multiple"): NativeFileProps<NativeFile[]>;
  (type: NativeTextType, initial?: string | number): NativeTextProps;
  (type: "checkbox", checked?: boolean): NativeToggleProps;
  (type: "checkbox", option: string, checked?: boolean): NativeToggleProps;
  (type: "radio", option: string): NativeToggleProps;
  /** `initial` is what is chosen until the user chooses; without it, the first of `options` (what a browser's select starts on). */
  (type: "select" | "select multiple", initial?: string | string[], options?: readonly string[]): NativeSelectProps;
  (type: "hidden", value: string | number | boolean): { readonly value: string | number | boolean };
  (type: "submit", value: string | number | boolean): { readonly value: string | number | boolean; onPress: () => void };
}

/** SvelteKit's `form.fields` with `as` replaced by the native one; `value()`, `set()`, `issues()`, `allIssues()`, `touched()` and `dirty()` are SvelteKit's. */
export type NativeFormFields<T> = T extends (...args: never[]) => unknown ? T : { [K in keyof T]: K extends "as" ? NativeFieldProps : NativeFormFields<T[K]> };

/**
 * A remote form as a native screen sees it: SvelteKit's `RemoteForm` without the DOM parts (`action`, `element`, the attachment) and with the
 * native `fields.x.as(type)`, `submit()` (what pressing the submit button does: preflight, `enhance`, send, reset on success) and `reset()`.
 */
// biome-ignore lint/suspicious/noConfusingVoidType: SvelteKit's own constraint on the input of a form (`form(handler)` with no schema has `void`)
export type NativeForm<F> = F extends RemoteForm<infer Input extends RemoteFormInput | void, infer Output>
  ? Omit<RemoteForm<Input, Output>, "fields" | "action" | "element" | "enhance" | "for" | "submit" | symbol> & {
      fields: NativeFormFields<RemoteForm<Input, Output>["fields"]>;
      submit(): Promise<boolean> & { updates: (...updates: unknown[]) => Promise<boolean> };
      /** What a submission that failed (the network, the server) became after `handleError`; `undefined` when the last one did not fail. */
      readonly error: App.Error | undefined;
      reset(): void;
      enhance(callback: (form: Omit<NativeForm<F>, "enhance">) => void | Promise<void>): NativeForm<F>;
      for(id: Parameters<RemoteForm<Input, Output>["for"]>[0]): Omit<NativeForm<F>, "for">;
    }
  : never;

/**
 * A remote form typed for the native `fields.x.as(...)`. It is the same object (a cast): in native code, `as` returns the props of a native
 * input at run time, and SvelteKit's types still describe DOM inputs.
 */
// biome-ignore lint/suspicious/noConfusingVoidType: as above
export function native<Input extends RemoteFormInput | void, Output>(form: RemoteForm<Input, Output>): NativeForm<RemoteForm<Input, Output>> {
  return form as unknown as NativeForm<RemoteForm<Input, Output>>;
}
