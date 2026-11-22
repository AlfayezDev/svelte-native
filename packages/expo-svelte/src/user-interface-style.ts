import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ExpoConfig } from "expo/config";
import type { AndroidConfig } from "expo/config-plugins";

/**
 * The app's light or dark mode on Android. Expo's `userInterfaceStyle` (`light` unless the config says otherwise) decides it on iOS, where the prebuild writes
 * `UIUserInterfaceStyle`; on Android Expo leaves it to `expo-system-ui`, and without that package the app followed the system's mode: an app made for the light mode only
 * went dark on Android and stayed light on iOS. The plugin writes the style into the manifest's meta-data and svelte-core's `SvelteAppearancePackage` sets it as the night
 * mode when the application starts, before any activity, as `expo-system-ui` does. An app that has `expo-system-ui` keeps that package's way, and gets no meta-data.
 */
export const userInterfaceStyleMetaData = "expo.modules.svelteappearance.user_interface_style";

export type UserInterfaceStyle = "light" | "dark" | "automatic";

/** The app's style on Android: the Android one of the config, else the app's, else Expo's default, `light`. */
export function userInterfaceStyleOf(config: Pick<ExpoConfig, "userInterfaceStyle" | "android">): UserInterfaceStyle {
  const style = config.android?.userInterfaceStyle ?? config.userInterfaceStyle ?? "light";
  if (style !== "light" && style !== "dark" && style !== "automatic") throw new Error(`Svelte native: userInterfaceStyle must be "light", "dark" or "automatic", not ${JSON.stringify(style)}`);
  return style;
}

/** Whether the app lists `expo-system-ui`, which sets the Android night mode from the same config itself. */
export function hasSystemUi(projectRoot: string): boolean {
  let manifest: Record<string, unknown>;
  try {
    manifest = JSON.parse(readFileSync(join(projectRoot, "package.json"), "utf8")) as Record<string, unknown>;
  } catch {
    return false;
  }
  return ["dependencies", "devDependencies"].some((group) => {
    const entries = manifest[group];
    return typeof entries === "object" && entries !== null && Object.hasOwn(entries, "expo-system-ui");
  });
}

/** Writes the style as the application's meta-data, or takes it away (`null`: an app with `expo-system-ui`). */
export function applyUserInterfaceStyle(application: AndroidConfig.Manifest.ManifestApplication, style: UserInterfaceStyle | null): void {
  const others = (application["meta-data"] ?? []).filter((item) => item.$["android:name"] !== userInterfaceStyleMetaData);
  application["meta-data"] = style === null ? others : [...others, { $: { "android:name": userInterfaceStyleMetaData, "android:value": style } }];
}
