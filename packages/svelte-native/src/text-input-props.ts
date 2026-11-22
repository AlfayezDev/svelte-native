/**
 * What React Native's `TextInput` component does to its props before they reach the native view (`Libraries/Components/TextInput/TextInput.js`,
 * React Native 0.86.3), for Svelte Native's `TextInput`, which mounts the native view directly: `readOnly` is `editable`, `enterKeyHint` is the
 * `returnKeyType`, `inputMode` is the `keyboardType` (and `"none"` opens no keyboard), and `autoComplete` is Android's autofill hint or, on iOS,
 * the `textContentType`. The view tables (`fabric/view-configs.ts`) take only the native names, so without this the web names would be dropped. An `autocomplete` value with
 * section or address words (`shipping email`) is read for its token, and one neither platform has a hint for (`on`, `nickname` on Android) is left out.
 */
import { Platform } from "./platform.ts";

// biome-ignore lint/suspicious/noExplicitAny: the props of a TextInput, whatever its author wrote
type Props = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- the props of a TextInput, whatever its author wrote

const ENTER_KEY_HINTS: Readonly<Record<string, string>> = {
  done: "done", enter: "default", go: "go", next: "next", previous: "previous", search: "search", send: "send",
};

const inputModes = (ios: boolean): Readonly<Record<string, string>> => ({
  decimal: "decimal-pad", email: "email-address", none: "default", numeric: "number-pad", search: ios ? "web-search" : "default", tel: "phone-pad", text: "default", url: "url",
});

/** HTML `autocomplete` tokens as Android's autofill names (the native side maps those to autofill hints, as React Native's `ReactTextInputManager` does). */
const ANDROID_AUTOCOMPLETE: Readonly<Record<string, string>> = {
  "additional-name": "name-middle", "address-line1": "postal-address-region", "address-line2": "postal-address-locality", bday: "birthdate-full",
  "bday-day": "birthdate-day", "bday-month": "birthdate-month", "bday-year": "birthdate-year", "cc-csc": "cc-csc", "cc-exp": "cc-exp",
  "cc-exp-month": "cc-exp-month", "cc-exp-year": "cc-exp-year", "cc-number": "cc-number", country: "postal-address-country", "current-password": "password",
  email: "email", "family-name": "name-family", "given-name": "name-given", "honorific-prefix": "name-prefix", "honorific-suffix": "name-suffix", name: "name",
  "new-password": "password-new", off: "off", "one-time-code": "sms-otp", "postal-code": "postal-code", sex: "gender", "street-address": "street-address",
  tel: "tel", "tel-country-code": "tel-country-code", "tel-national": "tel-national", username: "username",
};

/**
 * The autofill names Android's engine has a hint for (`InputAutofill.kt`, React Native's `ReactTextInputManager` table), which a `TextInput` may be given as they are,
 * and `"off"`. Any other value would turn autofill off for the field there, so it is left out: the field keeps Android's own guess (`autocomplete="on"`).
 */
const ANDROID_NAMES: ReadonlySet<string> = new Set([
  "2fa-app-otp", "birthdate-day", "birthdate-full", "birthdate-month", "birthdate-year", "cc-csc", "cc-exp", "cc-exp-day", "cc-exp-month", "cc-exp-year", "cc-number",
  "email", "email-otp", "flight-confirmation-code", "flight-number", "gender", "gift-card-number", "gift-card-pin", "loyalty-account-number", "name", "name-family",
  "name-given", "name-middle", "name-middle-initial", "name-prefix", "name-suffix", "password", "password-new", "postal-address", "postal-address-country",
  "postal-address-dependent-locality", "postal-address-extended", "postal-address-extended-postal-code", "postal-address-locality", "postal-address-region",
  "postal-address-unit", "postal-code", "promo-code", "street-address", "sms-otp", "tel", "tel-country-code", "tel-national", "tel-device", "upi-vpa", "wifi-password",
  "username", "username-new",
  "off",
]);

/** HTML `autocomplete` tokens as iOS's `textContentType`. */
const IOS_CONTENT_TYPES: Readonly<Record<string, string>> = {
  "additional-name": "middleName", "address-line1": "streetAddressLine1", "address-line2": "streetAddressLine2", bday: "birthdate", "bday-day": "birthdateDay",
  "bday-month": "birthdateMonth", "bday-year": "birthdateYear", "cc-additional-name": "creditCardMiddleName", "cc-csc": "creditCardSecurityCode",
  "cc-exp": "creditCardExpiration", "cc-exp-month": "creditCardExpirationMonth", "cc-exp-year": "creditCardExpirationYear", "cc-family-name": "creditCardFamilyName",
  "cc-given-name": "creditCardGivenName", "cc-name": "creditCardName", "cc-number": "creditCardNumber", "cc-type": "creditCardType", country: "countryName",
  "current-password": "password", email: "emailAddress", "family-name": "familyName", "given-name": "givenName", "honorific-prefix": "namePrefix",
  "honorific-suffix": "nameSuffix", name: "name", "new-password": "newPassword", nickname: "nickname", off: "none", "one-time-code": "oneTimeCode",
  organization: "organizationName", "organization-title": "jobTitle", "postal-code": "postalCode", "street-address": "fullStreetAddress", tel: "telephoneNumber",
  url: "URL", username: "username",
};

const known = (table: Readonly<Record<string, string>>, key: unknown): string | undefined => (typeof key === "string" && Object.hasOwn(table, key) ? table[key] : undefined);

/** The words of an HTML `autocomplete` value that say where the field belongs rather than what it holds (`section-blue shipping home tel webauthn`). */
const DETAIL = /^(section-.*|shipping|billing|home|work|mobile|fax|pager|webauthn)$/i;

/** What a field holds, from an `autocomplete` value: the token among its words (`shipping email` is `email`), lowercased as HTML compares it; the value as it is when it has one word. */
function fieldName(value: string): string {
  const words = value.trim().split(/\s+/);
  if (words.length === 1) return words[0] ?? value;
  return (words.filter((word) => !DETAIL.test(word)).at(-1) ?? value).toLowerCase();
}

/**
 * The native props of a `TextInput` from the props it was given, as React Native's component computes them: a defined `enterKeyHint` or `inputMode` wins over
 * `returnKeyType` or `keyboardType`, a defined `readOnly` over `editable`, and a defined `textContentType` over the one `autoComplete` implies on iOS. A value
 * React Native does not know is ignored, as the web ignores one, so the native prop stays. `os` is the platform's, a parameter for the tests.
 */
export function textInputProps(props: Props, os: string = Platform.OS): Props {
  const { readOnly, enterKeyHint, inputMode, autoComplete, ...out } = props;
  if (readOnly !== undefined && readOnly !== null) out.editable = !readOnly;
  const returnKey = known(ENTER_KEY_HINTS, enterKeyHint);
  if (returnKey !== undefined) out.returnKeyType = returnKey;
  const keyboard = known(inputModes(os === "ios"), inputMode);
  if (keyboard !== undefined) {
    out.keyboardType = keyboard;
    out.showSoftInputOnFocus = inputMode !== "none";
  }
  if (typeof autoComplete === "string") {
    const name = fieldName(autoComplete);
    if (os === "ios") out.textContentType ??= known(IOS_CONTENT_TYPES, name);
    else out.autoComplete = known(ANDROID_AUTOCOMPLETE, name) ?? (ANDROID_NAMES.has(name) ? name : undefined);
  }
  return out;
}
