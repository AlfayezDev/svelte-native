import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyUserInterfaceStyle, hasSystemUi, userInterfaceStyleMetaData, userInterfaceStyleOf } from "../../src/user-interface-style.ts";

/**
 * The app's light or dark mode on Android (`src/user-interface-style.ts`): the plugin writes the app's `userInterfaceStyle` as meta-data, which svelte-core sets as the night mode
 * (`SvelteAppearancePackage`, whose rules `src/test/appearance.sh` checks against this name), so Android keeps the mode iOS keeps. An app with `expo-system-ui` keeps that package's way.
 */
test("the style is Android's own, else the app's, else Expo's default, and nothing else is one", () => {
  expect(userInterfaceStyleOf({})).toBe("light");
  expect(userInterfaceStyleOf({ userInterfaceStyle: "automatic" })).toBe("automatic");
  expect(userInterfaceStyleOf({ userInterfaceStyle: "automatic", android: { userInterfaceStyle: "dark" } })).toBe("dark");
  expect(() => userInterfaceStyleOf({ userInterfaceStyle: "sepia" as never })).toThrow('userInterfaceStyle must be "light", "dark" or "automatic", not "sepia"');
});

test("the meta-data is written once, replaced by the next prebuild's, and taken away for an app with expo-system-ui", () => {
  const application = { $: { "android:name": ".MainApplication" }, "meta-data": [{ $: { "android:name": "other", "android:value": "kept" } }] } as Parameters<typeof applyUserInterfaceStyle>[0];
  applyUserInterfaceStyle(application, "light");
  applyUserInterfaceStyle(application, "automatic");
  expect(application["meta-data"]).toEqual([
    { $: { "android:name": "other", "android:value": "kept" } },
    { $: { "android:name": userInterfaceStyleMetaData, "android:value": "automatic" } },
  ]);
  applyUserInterfaceStyle(application, null);
  expect(application["meta-data"]).toEqual([{ $: { "android:name": "other", "android:value": "kept" } }]);
});

test("expo-system-ui is found among the app's dependencies or dev dependencies, and a project without a package.json has none", () => {
  const root = mkdtempSync(join(tmpdir(), "ui-style-"));
  try {
    expect(hasSystemUi(root)).toBe(false);
    writeFileSync(join(root, "package.json"), JSON.stringify({ dependencies: { expo: "57.0.30" } }));
    expect(hasSystemUi(root)).toBe(false);
    writeFileSync(join(root, "package.json"), JSON.stringify({ devDependencies: { "expo-system-ui": "~57.0.0" } }));
    expect(hasSystemUi(root)).toBe(true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
