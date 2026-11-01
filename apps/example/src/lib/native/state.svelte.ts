import * as Appearance from "react-native/Libraries/Utilities/Appearance";
import { setStatusBarStyle } from "expo-status-bar";
import * as SecureStore from "expo-secure-store";
import { getLocales } from "expo-localization";
import { applicationId } from "expo-application";
import { ar, en, arCounts, enCounts, createTranslator, type Locale, type Translate } from "@rasheed/client/messages";

export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? "https://dev.qarnos.com";
/** The QA app `io.rasheed.svelteqa` measures the engine; the smoke app `io.rasheed.svelteqa.smoke` is the same app plus the production app's native libraries (SPEC.md, "Native modules (smoke test)"). */
export const smokeApplicationId = "io.rasheed.svelteqa.smoke";
/** The product (`APP_VARIANT=production`): its bundle has no lab, so the lab is off in it, whatever `__DEV__` says (a development run of the product variant has no `/__dev` route to open). */
export const productApplicationId = "io.rasheed.app";
export const nativeLabEnabled = applicationId !== productApplicationId && (__DEV__ || applicationId === "io.rasheed.svelteqa" || applicationId === smokeApplicationId);
/** Only the smoke app links the libraries the smoke test calls: in the QA app they are not there, and every check would fail. */
export const nativeSmokeEnabled = applicationId === smokeApplicationId;
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
export function formatCount(key: keyof typeof enCounts, count: number): string {
  const category = new Intl.PluralRules(locale).select(count);
  const message = locale === "ar" ? arCounts[key][category] : enCounts[key][category === "one" ? "one" : "other"];
  return message.replaceAll("{{count}}", new Intl.NumberFormat(locale).format(count));
}
export const isolateText = (value: string) => `${String.fromCharCode(0x2068)}${value}${String.fromCharCode(0x2069)}`;
