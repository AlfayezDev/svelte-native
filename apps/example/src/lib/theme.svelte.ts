// The colours of the app in light and dark, and three text styles. The theme follows the system: React Native's `Appearance` says which one
// is on and tells us when it changes, and every screen that reads `theme.colors` redraws, because `scheme` is Svelte state.
import type { TextStyle } from "react-native";
import * as Appearance from "react-native/Libraries/Utilities/Appearance";

const light = {
  background: "#f4f4f6",
  surface: "#ffffff",
  text: "#17181c",
  muted: "#5f6470",
  border: "#d9dbe1",
  accent: "#d42b1e",
  onAccent: "#ffffff",
  danger: "#b3261e",
};
const dark: typeof light = {
  background: "#121317",
  surface: "#1d1f25",
  text: "#f2f3f5",
  muted: "#a3a8b4",
  border: "#33363f",
  accent: "#ff6b5b",
  onAccent: "#121317",
  danger: "#ff8a80",
};

let scheme = $state(Appearance.getColorScheme());
Appearance.addChangeListener(({ colorScheme }) => { scheme = colorScheme; });

const colors = $derived(scheme === "dark" ? dark : light);

export const theme = {
  /** Whether the system is in dark mode. */
  get dark() { return scheme === "dark"; },
  get colors() { return colors; },
};

/** Text styles for the explanations and captions around the examples. */
export const text = {
  get body(): TextStyle { return { color: colors.text, fontSize: 16, lineHeight: 22 }; },
  get heading(): TextStyle { return { color: colors.text, fontSize: 17, fontWeight: "600" }; },
  get caption(): TextStyle { return { color: colors.muted, fontSize: 14, lineHeight: 20 }; },
};
