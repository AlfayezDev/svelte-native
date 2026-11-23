import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";

/**
 * `aria-*` is resolved in React Native's `View.js` (React Native 0.88 maps the aliases there for every app; the flag `enableNativeViewPropTransformations` of 0.86 is gone); the host has no `View.js`, so
 * `src/fabric/accessibility.ts` does it, once for both platforms (`components/accessibility.test.ts` pins that function). If React Native moves the transformation to the native side again, the
 * shadow node resolves the aliases itself and our function is redundant (a second pass over the same props is harmless but dead code). If `View.js` changes a rule, our
 * function is out of date. Either is an upgrade to look at.
 */
const reactNative = resolve(createRequire(import.meta.url).resolve("react-native/package.json"), "..");

test("View.js maps the aria aliases as accessibility.ts does, and the native transformation is off", async () => {
  const view = await readFile(resolve(reactNative, "Libraries/Components/View/View.js"), "utf8");
  // React Native 0.88 removed `enableNativeViewPropTransformations`: View.js always maps the aliases, in JavaScript, and nothing is left to the native side.
  const flags = await readFile(resolve(reactNative, "src/private/featureflags/ReactNativeFeatureFlags.js"), "utf8");
  expect(flags).not.toContain("enableNativeViewPropTransformations");
  expect(view).not.toContain("enableNativeViewPropTransformations");
  for (const rule of [
    "resolvedProps.accessibilityLabel = ariaLabel;",
    "ariaLive === 'off' ? 'none' : ariaLive;",
    "resolvedProps.accessibilityElementsHidden = ariaHidden;",
    "resolvedProps.importantForAccessibility = 'no-hide-descendants';",
    "ariaLabelledBy?.split(/\\s*,\\s*/g)",
    "busy: ariaBusy ?? accessibilityState?.busy,",
    "checked: ariaChecked ?? accessibilityState?.checked,",
    "disabled: ariaDisabled ?? accessibilityState?.disabled,",
    "expanded: ariaExpanded ?? accessibilityState?.expanded,",
    "selected: ariaSelected ?? accessibilityState?.selected,",
    "max: ariaValueMax ?? accessibilityValue?.max,",
    "min: ariaValueMin ?? accessibilityValue?.min,",
    "now: ariaValueNow ?? accessibilityValue?.now,",
    "text: ariaValueText ?? accessibilityValue?.text,",
  ]) expect(view).toContain(rule);
});
