import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { textInputProps } from "../../src/text-input-props.ts";

/**
 * `src/text-input-props.ts` is what React Native's `TextInput` component does to its props (`Libraries/Components/TextInput/TextInput.js`), for a
 * component that mounts the native view directly: every entry of React Native's tables gives the native prop React Native gives, and the Android
 * autofill names it produces are ones the engine has a hint for (`InputAutofill.kt`, which the engine's host check compares with React Native's).
 */
const require = createRequire(import.meta.url);
const reactNative = dirname(require.resolve("react-native/package.json"));
const wrapper = readFileSync(resolve(reactNative, "Libraries/Components/TextInput/TextInput.js"), "utf8");
const autofill = readFileSync(resolve(import.meta.dirname, "../../native/svelte-core/android/src/main/java/expo/modules/svelteengine/InputAutofill.kt"), "utf8");

/** The plain `key: 'value'` entries of a table of the wrapper (an entry whose value is an expression is left out). */
function table(name: string): [string, string][] {
  const start = wrapper.indexOf(`const ${name} = {`);
  expect(start).toBeGreaterThan(0);
  const body = wrapper.slice(start, wrapper.indexOf("} as const;", start));
  return [...body.matchAll(/^\s*'?([\w-]+)'?:\s*'([^']*)',?$/gm)].map((match) => [match[1] as string, match[2] as string]);
}

test("enterKeyHint, inputMode and autoComplete give the native props React Native's TextInput gives, on Android and iOS", () => {
  const hints = table("enterKeyHintToReturnTypeMap");
  expect(hints.length).toBe(7);
  for (const [hint, returnKey] of hints) {
    expect(textInputProps({ enterKeyHint: hint }, "android").returnKeyType).toBe(returnKey);
    expect(textInputProps({ enterKeyHint: hint }, "ios").returnKeyType).toBe(returnKey);
  }
  const modes = table("inputModeToKeyboardTypeMap");
  expect(modes.length).toBe(7); // and search, whose value is per platform
  for (const [mode, keyboard] of modes) {
    expect(textInputProps({ inputMode: mode }, "android").keyboardType).toBe(keyboard);
    expect(textInputProps({ inputMode: mode }, "ios").keyboardType).toBe(keyboard);
  }
  expect(wrapper).toContain("Platform.OS === 'ios' ? ('web-search' as const) : ('default' as const)");
  expect(textInputProps({ inputMode: "search" }, "ios").keyboardType).toBe("web-search");
  expect(textInputProps({ inputMode: "search" }, "android").keyboardType).toBe("default");
  const android = table("autoCompleteWebToAutoCompleteAndroidMap");
  expect(android.length).toBeGreaterThan(25);
  for (const [token, name] of android) expect(textInputProps({ autoComplete: token }, "android").autoComplete).toBe(name);
  const ios = table("autoCompleteWebToTextContentTypeMap");
  expect(ios.length).toBeGreaterThan(30);
  for (const [token, type] of ios) {
    const props = textInputProps({ autoComplete: token }, "ios");
    expect(props.textContentType).toBe(type);
    expect(props.autoComplete).toBeUndefined(); // the iOS views have no autoComplete
  }
  // Every Android name but "off" is one the engine has an autofill hint for, and every name the engine has passes as it is.
  for (const [, name] of android) if (name !== "off") expect(autofill).toContain(`"${name}" to HintConstants.`);
  const engine = [...autofill.matchAll(/"([^"]+)" to HintConstants\./g)].map((match) => match[1] as string);
  expect(engine.length).toBe(48);
  for (const name of engine) expect(textInputProps({ autoComplete: name }, "android").autoComplete).toBe(name);
});

test("an autocomplete value is read for its token, and one with no hint on the platform is left out rather than turning autofill off", () => {
  expect(textInputProps({ autoComplete: "shipping email" }, "android").autoComplete).toBe("email");
  expect(textInputProps({ autoComplete: "section-a billing tel" }, "ios").textContentType).toBe("telephoneNumber");
  expect(textInputProps({ autoComplete: "home Email webauthn" }, "ios").textContentType).toBe("emailAddress");
  // One token is compared as HTML compares it too, whatever its case (#114).
  expect(textInputProps({ autoComplete: "CURRENT-PASSWORD" }, "android").autoComplete).toBe("password");
  expect(textInputProps({ autoComplete: "CURRENT-PASSWORD" }, "ios").textContentType).toBe("password");
  expect(textInputProps({ autoComplete: "OFF" }, "android").autoComplete).toBe("off");
  expect(textInputProps({ autoComplete: "OFF" }, "ios").textContentType).toBe("none");
  expect(textInputProps({ autoComplete: " One-Time-Code " }, "android").autoComplete).toBe("sms-otp");
  for (const token of ["on", "nickname", "organization", "url", "cc-name"]) {
    const props = textInputProps({ autoComplete: token }, "android");
    expect(Object.hasOwn(props, "autoComplete") ? props.autoComplete : undefined, token).toBeUndefined();
  }
  expect(textInputProps({ autoComplete: "nickname" }, "ios").textContentType).toBe("nickname");
  expect(textInputProps({ autoComplete: "on" }, "ios").textContentType).toBeUndefined();
});

test("which prop wins, as in React Native's TextInput: the web name over the native one, a defined textContentType over autoComplete's, and a value it does not know changes nothing", () => {
  expect(textInputProps({ inputMode: "numeric", keyboardType: "email-address" }, "android").keyboardType).toBe("number-pad");
  expect(textInputProps({ enterKeyHint: "go", returnKeyType: "search" }, "ios").returnKeyType).toBe("go");
  expect(textInputProps({ inputMode: "none" }, "android")).toMatchObject({ keyboardType: "default", showSoftInputOnFocus: false });
  expect(textInputProps({ inputMode: "text", showSoftInputOnFocus: false }, "android").showSoftInputOnFocus).toBe(true);
  expect(textInputProps({ inputMode: "dial", keyboardType: "phone-pad", showSoftInputOnFocus: false }, "android")).toMatchObject({ keyboardType: "phone-pad", showSoftInputOnFocus: false });
  expect(textInputProps({ enterKeyHint: "launch", returnKeyType: "send" }, "android").returnKeyType).toBe("send");
  expect(textInputProps({ autoComplete: "one-time-code", textContentType: "username" }, "ios").textContentType).toBe("username");
  expect(textInputProps({ autoComplete: "password-new" }, "android").autoComplete).toBe("password-new"); // React Native's own Android name passes
  expect(textInputProps({ autoComplete: "not-a-token" }, "ios").textContentType).toBeUndefined();
  expect(textInputProps({ readOnly: true, editable: true }, "android").editable).toBe(false);
  expect(textInputProps({ readOnly: false, editable: false }, "ios").editable).toBe(true);
  expect(textInputProps({ editable: false }, "ios").editable).toBe(false);
  const plain = { placeholder: "Name", keyboardType: "email-address" };
  expect(textInputProps(plain, "android")).toEqual(plain);
});
