/**
 * The `aria-*` props of a host element, turned into the accessibility props Fabric understands, the way React Native's `View.js`
 * (and `Text.js`) do it in JavaScript. React Native 0.86 only does this in C++ behind `enableNativeViewPropTransformations`, which is
 * off, so without this step `aria-checked` and its kin reach the shadow tree as unknown props on both platforms and nothing reads them.
 *
 * The rules are `View.js`'s (the branch for the flag being off):
 * - `aria-label` becomes `accessibilityLabel`, and wins over it;
 * - `aria-live` becomes `accessibilityLiveRegion` (`off` is `none`);
 * - `aria-hidden` becomes `accessibilityElementsHidden`, and `true` also makes the view `importantForAccessibility: "no-hide-descendants"`;
 * - `aria-labelledby` (HTML whitespace-separated or legacy comma-separated ids) becomes the list `accessibilityLabelledBy`;
 * - `aria-busy`, `aria-checked`, `aria-disabled`, `aria-expanded` and `aria-selected` are laid over `accessibilityState`, one key each;
 * - `aria-valuemin`, `aria-valuemax`, `aria-valuenow` and `aria-valuetext` are laid over `accessibilityValue`.
 * An `aria-*` value that is `null` or `undefined` says nothing and leaves the matching `accessibility*` prop alone (`??`, as in React Native).
 * HTML compatibility extensions: string boolean/numeric tokens are normalized and whitespace-separated ID lists are accepted.
 * A state or value key nobody set is left out of the object, where React Native sends it as `undefined`.
 * `role` needs nothing: the shadow node parses it, and the Android engine reads it next to `accessibilityRole` (SPEC.md, "Accessibility props").
 */
const state = ["busy", "checked", "disabled", "expanded", "selected"] as const;
const value = ["max", "min", "now", "text"] as const;
type Bag = Record<string, unknown>;

/** Whether `key` is one of the aliases handled here; the host asks while it walks the attributes, so a node without any pays one character test per key. */
export function isAriaKey(key: string): boolean {
  return key.charCodeAt(0) === 97 /* a */ && key.startsWith("aria-");
}

function overlay(into: Bag, key: string, aria: unknown, plain: Bag | undefined, name: string): void {
  const chosen = aria ?? plain?.[name];
  if (chosen !== undefined && chosen !== null) into[key] = chosen;
}

// HTML/Svelte literal attributes carry strings; Fabric expects typed state/value props.
function booleanToken(value: unknown): unknown {
  return value === "true" ? true : value === "false" ? false : value;
}
function numberToken(value: unknown): unknown {
  if (typeof value !== "string" || !value.trim()) return value;
  const number = Number(value);
  return Number.isFinite(number) ? number : value;
}

/** Rewrites `props` in place: the `aria-*` keys are consumed and the accessibility props they stand for are set. */
export function applyAriaProps(props: Bag): void {
  const label = props["aria-label"];
  const labelledBy = props["aria-labelledby"];
  const live = props["aria-live"];
  const hidden = booleanToken(props["aria-hidden"]);
  const touchesState = props.accessibilityState != null || state.some((name) => props[`aria-${name}`] != null);
  const touchesValue = props.accessibilityValue != null || value.some((name) => props[`aria-value${name}`] != null);

  if (touchesState) {
    const next: Bag = {};
    const plain = props.accessibilityState as Bag | undefined;
    for (const name of state) overlay(next, name, booleanToken(props[`aria-${name}`]), plain, name);
    props.accessibilityState = next;
  }
  if (touchesValue) {
    const next: Bag = {};
    const plain = props.accessibilityValue as Bag | undefined;
    for (const name of value) overlay(next, name, name === "text" ? props[`aria-value${name}`] : numberToken(props[`aria-value${name}`]), plain, name);
    props.accessibilityValue = next;
  }
  if (typeof labelledBy === "string") props.accessibilityLabelledBy = labelledBy.trim().split(/[\s,]+/).filter(Boolean);
  if (label != null) props.accessibilityLabel = label;
  if (live != null) props.accessibilityLiveRegion = live === "off" ? "none" : live;
  if (hidden != null) {
    props.accessibilityElementsHidden = hidden;
    if (hidden === true) props.importantForAccessibility = "no-hide-descendants";
  }

  for (const key of Object.keys(props)) if (isAriaKey(key)) delete props[key];
}
