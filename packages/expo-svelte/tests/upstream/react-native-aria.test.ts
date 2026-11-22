import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";

/**
 * `aria-*` is resolved in React Native's `View.js` (the branch for `enableNativeViewPropTransformations` being off, its default); the host has no `View.js`, so
 * `src/fabric/accessibility.ts` does it, once for both platforms (`components/accessibility.test.ts` pins that function). If React Native turns its native transformation on, the
 * shadow node resolves the aliases itself and our function is redundant (a second pass over the same props is harmless but dead code). If `View.js` changes a rule, our
 * function is out of date. Either is an upgrade to look at.
 */
const reactNative = resolve(createRequire(import.meta.url).resolve("react-native/package.json"), "..");

test("View.js maps the aria aliases as accessibility.ts does, and the native transformation is off", async () => {
  const view = await readFile(resolve(reactNative, "Libraries/Components/View/View.js"), "utf8");
  const flags = await readFile(resolve(reactNative, "src/private/featureflags/ReactNativeFeatureFlags.js"), "utf8");
  expect(flags).toContain("enableNativeViewPropTransformations: Getter<boolean> = createNativeFlagGetter('enableNativeViewPropTransformations', false)");
  for (const rule of [
    "processedProps.accessibilityLabel = ariaLabel;",
    "ariaLive === 'off' ? 'none' : ariaLive;",
    "processedProps.accessibilityElementsHidden = ariaHidden;",
    "processedProps.importantForAccessibility = 'no-hide-descendants';",
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
