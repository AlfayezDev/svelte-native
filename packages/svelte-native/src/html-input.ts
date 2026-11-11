/**
 * What the `type` of an `<input>` means for a `TextInput`: the props it implies (the keyboard, the password dots, what the platform may autofill).
 * The lowering of HTML elements (`lower-html.ts`) writes these as attributes for a `type="email"` it can read, and `hostInputType` of the renderer
 * works them out at run time for a `type={expression}`, so the two cannot disagree.
 */
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
