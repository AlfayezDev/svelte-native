/**
 * The colours of what an app has not coloured itself: a screen's background and a text's colour, in the light and the dark mode. React Native leaves a screen transparent
 * and draws a text black in both modes, so a pushed screen showed the one below it through itself while it slid in, and a text with no colour vanished on a dark background.
 *
 * They are the platform's own: on iOS the system background (`systemBackground`, and the elevated one of a modal or a sheet in the dark mode) and `label`; on Android the
 * Material 3 surface and on-surface, the colours the engine's header already draws in (`EngineHeader.surface` and `onSurface`). The light or dark mode is the app's
 * (`colorScheme`): an app whose `userInterfaceStyle` is `light`, Expo's default, gets the light colours whatever the system's mode is.
 */
export type Scheme = "light" | "dark";
export type ColorPlatform = "ios" | "android";

type Colors = { background: string; elevated: string; text: string };

const colors: Record<ColorPlatform, Record<Scheme, Colors>> = {
  ios: {
    light: { background: "#FFFFFF", elevated: "#FFFFFF", text: "#000000" },
    dark: { background: "#000000", elevated: "#1C1C1E", text: "#FFFFFF" },
  },
  android: {
    light: { background: "#FFFBFE", elevated: "#FFFBFE", text: "#1C1B1F" },
    dark: { background: "#1C1B1F", elevated: "#1C1B1F", text: "#E6E1E5" },
  },
};

const platformOf = (os: string): ColorPlatform => (os === "ios" ? "ios" : "android");

/**
 * The system's background of a screen that neither gives itself one nor is inside a screen that has one (`Screen.svelte`): the elevated one for a screen presented over another
 * (a modal, a sheet). A transparent modal has none: it is there to show the screen below.
 */
export function screenBackground(scheme: Scheme, os: string, presentation: string): string | undefined {
  if (presentation === "transparentModal") return undefined;
  const set = colors[platformOf(os)][scheme];
  return presentation === "push" ? set.background : set.elevated;
}

/** The `backgroundColor` a style gives, as the platform reads it: the last of an array that has one. */
export function backgroundOf(style: unknown): string | undefined {
  if (Array.isArray(style)) {
    for (let index = style.length - 1; index >= 0; index--) {
      const found = backgroundOf(style[index]);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  const value = style !== null && typeof style === "object" ? (style as { backgroundColor?: unknown }).backgroundColor : undefined;
  return typeof value === "string" ? value : undefined;
}

/** The colour of a text, or of the text typed in an input, that does not give itself one (`fabric/host.ts`). */
export function textColor(scheme: Scheme, os: string): string {
  return colors[platformOf(os)][scheme].text;
}
