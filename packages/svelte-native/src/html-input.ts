/**
 * An HTML `<input>` or `<textarea>` as a `TextInput`, when the app runs: the lowering of HTML elements (`lower-html.ts`) makes the element a `TextInput` marked `nativeHtml` and leaves
 * its attributes as they are, and the component works them out here (`TextInput.svelte`). So what the web writes means the same whether it is written on the element or comes from
 * a `{...rest}` that a component of the app passes down, and a `type={expression}` is looked at when it changes.
 *
 * `type` is the keyboard and what the platform may fill in (`INPUT_TYPES`), under any native prop the element has; `disabled` is `editable`, `readonly`, `maxlength`, `rows`,
 * `autofocus`, `autocomplete`, `autocapitalize`, `inputmode` and `enterkeyhint` are the props of those names, `oninput` is `onChangeText`, `onchange` is `onEndEditing`, `onkeydown`
 * and `onkeyup` are `onKeyPress`, and Enter in a single-line input is a submission of the form it is in. The events have the fields web code reads (`currentTarget.value`, `key`).
 */
import { styleText } from "./html-style.ts";
import { hostInputEvent, hostKeyEvent, hostSubmit } from "./renderer.ts";

/** What the `type` of an `<input>` means for a `TextInput`: the props it implies. */
export const INPUT_TYPES: Readonly<Record<string, Readonly<Record<string, string | boolean>>>> = {
  text: {},
  email: { keyboardType: "email-address", autoComplete: "email", autoCapitalize: "none" },
  password: { secureTextEntry: true, autoComplete: "password", autoCapitalize: "none" },
  number: { keyboardType: "numeric" },
  search: { returnKeyType: "search" },
  url: { keyboardType: "url", autoCapitalize: "none" },
  tel: { keyboardType: "phone-pad", autoComplete: "tel" },
};

const none: Readonly<Record<string, string | boolean>> = Object.freeze({});

/** The props of an input `type` (any case); a type that is not a text input's (and `undefined`) implies none. */
export function inputTypeProps(type: unknown): Readonly<Record<string, string | boolean>> {
  return (typeof type === "string" && Object.hasOwn(INPUT_TYPES, type.toLowerCase()) ? INPUT_TYPES[type.toLowerCase()] : undefined) ?? none;
}

// biome-ignore lint/suspicious/noExplicitAny: the props of an element, whatever its author wrote
type Props = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- the props of an element, whatever its author wrote

/** What an HTML attribute is called for a `TextInput`. */
const RENAMES: Record<string, string> = {
  readonly: "readOnly", autofocus: "autoFocus", autocomplete: "autoComplete", autocapitalize: "autoCapitalize", inputmode: "inputMode", enterkeyhint: "enterKeyHint",
  onfocus: "onFocus", onblur: "onBlur",
};

/** The handler that runs the web handler first and the native one of the same event as well, in that order. */
function both(first: ((event: unknown) => void) | undefined, second: ((event: unknown) => void) | undefined): ((event: unknown) => void) | undefined {
  if (first === undefined) return second;
  if (second === undefined) return first;
  return (event) => { first(event); second(event); };
}

/**
 * The props a `TextInput` takes for the attributes of an HTML input. `onChangeText` is separate: the component runs it with its own (the `bind:value` write comes first).
 */
export function htmlTextInput(attributes: Props): { props: Props; onChangeText: ((text: string) => void) | undefined } {
  const { type, disabled, maxlength, rows, oninput, onchange, onkeydown, onkeyup, style, ...rest } = attributes;
  const props: Props = { ...inputTypeProps(type), ...rest };
  for (const web in RENAMES) {
    if (!(web in props)) continue;
    const native = RENAMES[web] as string;
    if (props[native] === undefined) props[native] = props[web];
    delete props[web];
  }
  if (disabled !== undefined && props.editable === undefined) props.editable = !disabled;
  if (maxlength !== undefined && props.maxLength === undefined && Number.isFinite(Number(maxlength))) props.maxLength = Number(maxlength);
  if (rows !== undefined && props.numberOfLines === undefined && Number.isFinite(Number(rows))) props.numberOfLines = Number(rows);
  if (style !== undefined && style !== null) props.style = typeof style === "string" ? styleText(style) : style;
  const element = { name: typeof rest.name === "string" ? rest.name : undefined, id: typeof rest.id === "string" ? rest.id : undefined, type: typeof type === "string" ? type : "text" };
  if (typeof onchange === "function") props.onEndEditing = both((event) => onchange(hostInputEvent("change", (event as { nativeEvent?: { text?: string } } | undefined)?.nativeEvent?.text, element)), props.onEndEditing);
  if (typeof onkeydown === "function" || typeof onkeyup === "function") {
    props.onKeyPress = both((event) => {
      if (typeof onkeydown === "function") onkeydown(hostKeyEvent("keydown", event));
      if (typeof onkeyup === "function") onkeyup(hostKeyEvent("keyup", event));
    }, props.onKeyPress);
  }
  // Enter in a single-line input submits the form above it, unless the key press of Enter was prevented.
  if (props.multiline !== true && props.onSubmitEditing === undefined) props.onSubmitEditing = (event: unknown) => hostSubmit(event, true);
  return { props, onChangeText: typeof oninput === "function" ? (text) => oninput(hostInputEvent("input", text, element)) : undefined };
}
