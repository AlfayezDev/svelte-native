/**
 * The web's `navigator` members on the device, each over what the platform has:
 *
 * - `clipboard` (and the global `ClipboardItem`): the system clipboard, through the library's native module (`clipboard.ts`);
 * - `share()` and `canShare()`: the Web Share API, on the system share sheet (React Native's `Share`);
 * - `vibrate()`: the Vibration API (React Native's `Vibration`);
 * - `language` and `languages`: the device's language, as a BCP 47 tag;
 * - `geolocation` and `permissions` (and the globals `GeolocationPositionError`, `GeolocationPosition`, `GeolocationCoordinates`, `PermissionStatus`): the
 *   Geolocation API over the library's own `SvelteLocation` native module, in a build with the location capability (`capabilities: { location }`; `geolocation.ts`).
 *
 * `polyfills.ts` installs them on the `navigator` React Native's start-up made. Nothing is loaded until it is used: `clipboard` and `ClipboardItem` are
 * lazy globals, and the others require their React Native module on the first call or read. A member the platform or a library defined already is kept.
 */
import { defineLazyGlobal } from "./lazy-global.ts";

type ShareData = { title?: string; text?: string; url?: string; files?: readonly unknown[] };
type ShareModule = {
  share(content: { title?: string; message?: string; url?: string }, options?: { dialogTitle?: string; subject?: string }): Promise<{ action: string }>;
  dismissedAction: string;
};

/* eslint-disable @typescript-eslint/no-require-imports -- each required on first use: the boot loads none of them */
const shareModule = (): ShareModule => (require("react-native/Libraries/Share/Share") as { default: ShareModule }).default;
const vibration = (): { vibrate(pattern: number | number[]): void; cancel(): void } =>
  (require("react-native/Libraries/Vibration/Vibration") as { default: { vibrate(pattern: number | number[]): void; cancel(): void } }).default;
const platformOS = (): string => (require("react-native/Libraries/Utilities/Platform") as { default: { OS: string } }).default.OS;
const i18n = (): { getConstants(): { localeIdentifier?: string } } =>
  (require("react-native/Libraries/ReactNative/I18nManager") as { default: { getConstants(): { localeIdentifier?: string } } }).default;
/* eslint-enable @typescript-eslint/no-require-imports */

function domException(message: string, name: string): Error {
  return typeof DOMException === "function" ? new DOMException(message, name) : Object.assign(new Error(message), { name });
}

/** Whether `share(data)` would share it: a title, a text or an absolute URL, and no files (the system share sheet takes text and links here). */
export function canShare(data?: ShareData): boolean {
  if (data === undefined || data === null) return false;
  if (data.files !== undefined && data.files.length > 0) return false;
  if (data.title === undefined && data.text === undefined && data.url === undefined) return false;
  if (data.url !== undefined) {
    try {
      new URL(String(data.url));
    } catch {
      return false;
    }
  }
  return true;
}

let sharing = false;

/**
 * The Web Share API on the system share sheet. Rejects with a `TypeError` for what `canShare` refuses, an `InvalidStateError` while another share is open,
 * and an `AbortError` when the user dismisses the sheet (iOS reports it; Android does not, so there a share resolves when the sheet is shown).
 */
export async function share(data?: ShareData): Promise<void> {
  if (!canShare(data)) throw new TypeError("Failed to execute 'share' on 'Navigator': give a title, a text or an absolute url (files can't be shared)");
  if (sharing) throw domException("An earlier share has not yet completed.", "InvalidStateError");
  const { title, text, url } = data as ShareData;
  const titleText = title === undefined ? undefined : String(title);
  const body = text === undefined ? undefined : String(text);
  const link = url === undefined ? undefined : new URL(String(url)).href;
  sharing = true;
  try {
    const module = shareModule();
    // iOS shares a message and a URL as two items; Android's sheet takes one text, so the URL follows the message on a line of its own.
    const content = platformOS() === "ios"
      ? { title: titleText, message: body ?? (link === undefined ? titleText : undefined), url: link }
      : { title: titleText, message: [body, link].filter((part) => part !== undefined && part !== "").join("\n") || (titleText ?? "") };
    const result = await module.share(content, { dialogTitle: titleText, subject: titleText });
    if (result.action === module.dismissedAction) throw domException("Share canceled", "AbortError");
  } finally {
    sharing = false;
  }
}

/** Longest vibration or pause of a pattern, in milliseconds (Chrome's limit). */
const MAX_DURATION = 10_000;

/**
 * The Vibration API: a duration, or a pattern of vibrations and the pauses between them; `0` or `[]` stops it, and a call replaces the pattern playing. On Android
 * the pattern plays as given; iOS has one fixed vibration, so each vibration of the pattern starts one, at its time. Returns `false` for a value that is not a duration
 * (the web's conversion would throw).
 */
export function vibrate(pattern: number | Iterable<number>): boolean {
  const list = typeof pattern === "number" ? [pattern] : [...pattern].map(Number);
  if (list.some((value) => !Number.isFinite(value))) return false;
  const durations = list.map((value) => Math.min(MAX_DURATION, Math.max(0, Math.trunc(value))));
  // A pattern's last pause does nothing.
  if (durations.length % 2 === 0) durations.pop();
  const module = vibration();
  // A new call replaces the pattern that is playing, as on the web (React Native's iOS ignores a call while one plays).
  module.cancel();
  if (durations.length === 0 || durations.every((value) => value === 0)) return true;
  if (durations.length === 1) module.vibrate(durations[0]);
  else if (platformOS() === "ios") {
    // iOS's pattern is the waits before each of its fixed vibrations: one at the start of each of the web's, after the vibration and pause before it.
    const starts = [0];
    for (let i = 0; i + 2 < durations.length; i += 2) starts.push(durations[i] + durations[i + 1]);
    module.vibrate(starts);
  } else {
    // Android's pattern starts with a pause; the web's with a vibration.
    module.vibrate([0, ...durations]);
  }
  return true;
}

/**
 * A locale identifier as React Native reports it, as a BCP 47 tag: Android's is Java's `Locale.toString()` (`en_US`, `zh_CN_#Hans`,
 * `ar_SA_#u-nu-latn`, `sr_RS_#Latn`: language, country, variant, then `#` and the script and extensions), an older form an ICU one
 * (`en_US@calendar=gregorian`). Undefined when it is not one.
 */
export function bcp47(identifier: string): string | undefined {
  const [base = "", extra = ""] = identifier.replace(/@.*$/, "").split("_#");
  const [language, country, variant] = base.split("_");
  if (!language) return undefined;
  const script = /^[A-Z][a-z]{3}/.exec(extra)?.[0];
  const extensions = (script ? extra.slice(script.length) : extra).replace(/^[_-]/, "");
  const tag = [language, script, country, variant, extensions].filter((part) => part !== undefined && part !== "").join("-");
  try {
    return Intl.getCanonicalLocales(tag)[0];
  } catch {
    return undefined;
  }
}

/**
 * The device's language as a BCP 47 tag (`en-US`, `ar-SA`, `zh-Hans-CN`): on Android the locale React Native reports when the app starts; on iOS
 * (React Native reports none there) and for an identifier that is not a locale, the runtime's default locale, which is the language and region the app runs in.
 */
export function deviceLanguage(): string {
  let identifier: string | undefined;
  try {
    identifier = i18n().getConstants().localeIdentifier;
  } catch {
    identifier = undefined;
  }
  return (identifier && bcp47(identifier)) || new Intl.DateTimeFormat().resolvedOptions().locale;
}

/** Adds what `navigator` lacks: the members above, and the global `ClipboardItem`. */
export function installNavigator(scope: { navigator?: object }): void {
  scope.navigator ??= {};
  const navigator = scope.navigator as Record<string, unknown>;
  const method = (name: string, value: (...args: never[]) => unknown) => {
    if (!(name in navigator)) Object.defineProperty(navigator, name, { value, writable: true, configurable: true, enumerable: true });
  };
  method("share", share);
  method("canShare", canShare);
  method("vibrate", vibrate);
  if (!("language" in navigator)) Object.defineProperty(navigator, "language", { get: deviceLanguage, configurable: true, enumerable: true });
  let languages: readonly string[] = [];
  // The same array while the language stays the same, as a browser's.
  const currentLanguages = () => {
    const language = deviceLanguage();
    if (languages[0] !== language) languages = Object.freeze([language]);
    return languages;
  };
  if (!("languages" in navigator)) Object.defineProperty(navigator, "languages", { get: currentLanguages, configurable: true, enumerable: true });
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- required on the first read
  defineLazyGlobal(navigator, "clipboard", () => (require("./clipboard.ts") as typeof import("./clipboard.ts")).loadClipboard());
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- required on the first read
  defineLazyGlobal(scope, "ClipboardItem", () => (require("./clipboard.ts") as typeof import("./clipboard.ts")).ClipboardItem);
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- required on the first read
  const geolocation = () => require("./geolocation.ts") as typeof import("./geolocation.ts");
  defineLazyGlobal(navigator, "geolocation", () => geolocation().loadGeolocation());
  defineLazyGlobal(navigator, "permissions", () => new (geolocation().Permissions)(geolocation().optionalGeolocation));
  for (const name of ["GeolocationPositionError", "GeolocationPosition", "GeolocationCoordinates", "PermissionStatus"] as const)
    defineLazyGlobal(scope, name, () => geolocation()[name]);
}
