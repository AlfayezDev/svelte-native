import { expect, test } from "bun:test";
import { applyAriaProps } from "../src/fabric/accessibility.ts";

function aria(props: Record<string, unknown>) { applyAriaProps(props); return props; }

test("literal HTML ARIA booleans reach Fabric as booleans, mixed stays mixed", () => {
  expect(aria({ "aria-hidden": "true", "aria-disabled": "false", "aria-expanded": "true", "aria-checked": "mixed" }))
    .toEqual({ accessibilityElementsHidden: true, importantForAccessibility: "no-hide-descendants",
      accessibilityState: { disabled: false, expanded: true, checked: "mixed" } });
  expect(aria({ "aria-hidden": "false" })).toEqual({ accessibilityElementsHidden: false });
});

test("HTML ID reference lists and legacy native comma lists both work", () => {
  expect(aria({ "aria-labelledby": " heading\t help\nextra " }))
    .toEqual({ accessibilityLabelledBy: ["heading", "help", "extra"] });
  expect(aria({ "aria-labelledby": "heading, help,, extra" }))
    .toEqual({ accessibilityLabelledBy: ["heading", "help", "extra"] });
  expect(aria({ "aria-labelledby": "  " })).toEqual({ accessibilityLabelledBy: [] });
});

test("numeric ARIA literals are numbers while value text stays text", () => {
  expect(aria({ "aria-valuemin": "0", "aria-valuemax": "100", "aria-valuenow": "12.5", "aria-valuetext": "12.5" }))
    .toEqual({ accessibilityValue: { min: 0, max: 100, now: 12.5, text: "12.5" } });
});

test("null aliases preserve explicit native accessibility props", () => {
  expect(aria({ "aria-label": null, "aria-live": null, "aria-hidden": null,
    accessibilityLabel: "Kept", accessibilityLiveRegion: "polite", accessibilityElementsHidden: true }))
    .toEqual({ accessibilityLabel: "Kept", accessibilityLiveRegion: "polite", accessibilityElementsHidden: true });
});
