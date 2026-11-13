import * as Appearance from "react-native/Libraries/Utilities/Appearance";
import { setStatusBarStyle } from "expo-status-bar";
import * as SecureStore from "expo-secure-store";
import { getLocales } from "expo-localization";
import { applicationId } from "expo-application";
import { ar, en, createTranslator, type Locale, type Translate } from "./messages.ts";
import { lab as bundleLab, variant as bundleVariant } from "@alfayez/svelte-native/routes";
import { smokeApplicationId } from "./app-ids.ts";
import { labDecision } from "./lab-flag.ts";

// What the bundle carries of the development lab is its route table's `lab` (the variant Metro bundled); the application id only adds to it (lab-flag.ts).
const labDecided = labDecision({ bundleLab: bundleLab === true, applicationId, dev: __DEV__ });
export const nativeLabEnabled = labDecided.enabled;
if (labDecided.refused) console.error(`[Svelte lab] this ${bundleVariant} bundle carries the development lab, which the ${applicationId} app does not run (publish with APP_VARIANT=production): the lab is off`);
/** Only the smoke app links the libraries the smoke test calls: in the QA app they are not there, and every check would fail. */
export const nativeSmokeEnabled = nativeLabEnabled && applicationId === smokeApplicationId;
const storedLanguage = SecureStore.getItem("interface_language");
let locale = $state<Locale>(storedLanguage === "ar" || storedLanguage === "en" ? storedLanguage : getLocales()[0]?.languageCode === "ar" ? "ar" : "en");
let appearance = $state<"system" | "light" | "dark">("system");
let deviceTheme = $state(Appearance.getColorScheme());
const translator = $derived(createTranslator(locale === "ar" ? ar : en));
export const t: Translate = (key, values) => translator(key, values);
export const getLocale = () => locale;
export function setLocale(next: Locale): void { locale = next; SecureStore.setItem("interface_language", next); }
export function watchAppearance(): () => void {
  const stored = SecureStore.getItem("appearance");
  if (stored === "light" || stored === "dark" || stored === "system") appearance = stored;
  const listener = Appearance.addChangeListener(({ colorScheme }) => { deviceTheme = colorScheme; });
  return () => listener.remove();
}
export function setAppearance(next: "system" | "light" | "dark"): void {
  appearance = next;
  SecureStore.setItem("appearance", next);
}
export function syncStatusBar(): void { setStatusBarStyle(theme.dark ? "light" : "dark"); }
const dark = $derived(appearance === "dark" || (appearance === "system" && deviceTheme === "dark"));
export const theme = {
  get appearance() { return appearance; },
  get dark() { return dark; },
  get rtl() { return locale === "ar"; },
  get direction(): "rtl" | "ltr" { return locale === "ar" ? "rtl" : "ltr"; },
  get background() { return dark ? "#101113" : "#f6f6f7"; },
  get surface() { return dark ? "#1d1f22" : "#ffffff"; },
  get foreground() { return dark ? "#f3f3f4" : "#191b1e"; },
  get muted() { return dark ? "#a6a8ad" : "#646970"; },
  get border() { return dark ? "#393c42" : "#d6d8dd"; },
  get accent() { return dark ? "#f3f3f4" : "#191b1e"; },
  get onAccent() { return dark ? "#191b1e" : "#ffffff"; },
  danger: "#d94343",
};
