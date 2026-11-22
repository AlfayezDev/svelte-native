/**
 * The class resolver: a class list to a React Native style, from the class table the build wrote (`table.ts`; `build.ts` makes it, `load-table.ts`
 * hands it over). A class has rules, each with the condition it applies under; the style of a list is the rules that apply, merged in cascade order.
 *
 * It runs in a component's template (`classes.ts`), so what it reads is tracked there: a rule that depends on the color scheme, the window or the
 * insets subscribes the view to that source, and the view draws again when it changes. Each source is one `createSubscriber`, listened to
 * while a view reads it and not after, as `colorScheme` is. A source is read only when a rule of the list depends on it, matching or not
 * (a `md:` rule that does not apply yet still has to notice the window grow), so a plain `p-4` listens to nothing.
 *
 * A list is worked out once per condition state: what it resolves to is cached by the list and which of its conditional rules apply, so a
 * resize that crosses no breakpoint gives back the very same object, and so does every other view with the same classes.
 */
import { createSubscriber } from "svelte/reactivity";
import { colorScheme } from "../color-scheme.ts";
import { subscribeInsets } from "../fabric/insets.ts";
import { Dimensions, Platform } from "../platform.ts";
import { TRANSFORM_KEYS, type ClassRule, type ClassTable, type DynamicValue } from "./table.ts";

const dev = () => typeof __DEV__ !== "undefined" && __DEV__;

/** Not set by the element's style or a `font-size` class: what `fontRelative` values (a unitless `line-height`, an `em` `letter-spacing`) are relative to, React Native's own default text size. */
const DEFAULT_FONT_SIZE = 14;

/** The generic families Tailwind's `font-mono` and `font-serif` name, and what iOS has instead (Android has the generic names). */
const IOS_FONTS: Record<string, string> = { monospace: "Menlo", serif: "Georgia" };

/** How many styles a variant keeps for the device values and font sizes it was asked for. */
const MAX_RESOLVED = 32;

/** `group` and `peer` (and `group/name`, `peer/name`) mark an element for the variants of others: they have no CSS of their own. */
const MARKER = /^(?:group|peer)(?:\/.+)?$/;

type Style = Record<string, unknown>;

/** One of the styles a class list can have: the merged rules of one set of conditions, and the values of that set that only the device knows. */
type Variant = {
  style: Style | undefined;
  dynamic: Record<string, DynamicValue> | undefined;
  /** The line height and letter spacing that are relative to the font size, which is the element's, so they wait for it. */
  relative: Partial<Record<"lineHeight" | "letterSpacing", number>> | undefined;
  /** What `finish` made of it, by the device values and font size it was made for: the same object for the same ones (a few, and a resize makes many: `finish` empties it). */
  resolved?: Map<string, Style>;
};

/** A class list against the table: its rules in cascade order, what they depend on, and the styles worked out so far. */
type Analysis = {
  rules: readonly ClassRule[];
  /** The rules whose condition is the color scheme or the window's width: which of them apply is what tells the variants apart. */
  conditional: readonly ClassRule[];
  scheme: boolean;
  width: boolean;
  variants: Map<string, Variant>;
};

let table: ClassTable = { version: 1, classes: {} };
let empty = true;
const analyses = new Map<string, Analysis>();

// --- The state a rule can depend on ---

// The window: one listener for every reader. It tells the readers when the size changed, not for each scale or font scale event.
const subscribeWindow = createSubscriber((update) => {
  const size = () => {
    const { width, height } = Dimensions.get("window");
    return `${width}x${height}`;
  };
  let last = size();
  const subscription = Dimensions.addEventListener("change", () => {
    const now = size();
    if (now === last) return;
    last = now;
    update();
  });
  return () => subscription.remove();
});

function windowSize(): { width: number; height: number } {
  subscribeWindow();
  return Dimensions.get("window");
}

// The safe area: connected to the engine on the first read and kept (as the `insets` store of `SafeAreaView` is), so what a read sees is current whether or not
// a template is reading. The views that read it are told when one of the four values changes; the keyboard moving is an insets event too, and tells them nothing.
let insets = { top: 0, right: 0, bottom: 0, left: 0 };
let insetsConnected = false;
const insetListeners = new Set<() => void>();
const subscribeInsetValues = createSubscriber((update) => {
  insetListeners.add(update);
  return () => insetListeners.delete(update);
});

function safeArea(): typeof insets {
  // Without the engine module (it is not linked) there is nothing to connect to: the next read tries again.
  if (!insetsConnected) {
    insetsConnected =
      subscribeInsets(({ top, right, bottom, left }) => {
        if (top === insets.top && right === insets.right && bottom === insets.bottom && left === insets.left) return;
        insets = { top, right, bottom, left };
        for (const update of [...insetListeners]) update();
      }) !== null;
  }
  subscribeInsetValues();
  return insets;
}

// The table itself, in development only: the build writes it again when a source or the CSS changes (`load-table.ts`).
const tableListeners = new Set<() => void>();
const subscribeTable = createSubscriber((update) => {
  tableListeners.add(update);
  return () => tableListeners.delete(update);
});

/**
 * Replaces the class table: the lists are worked out again, and the views that read a class draw again (in development, where a table can change
 * while the app runs).
 */
export function setClassTable(next: ClassTable): void {
  table = next;
  empty = Object.keys(next.classes).length === 0;
  analyses.clear();
  for (const update of [...tableListeners]) update();
}

// --- Warnings (development) ---

let warnedEmpty = false;
const reportedMissing = new Set<string>();
const pending = new Set<string>();
let pendingTimer: ReturnType<typeof setTimeout> | undefined;

/**
 * How long a used class that has no rules, or only some, waits before it is reported. In development the build writes a new table after an edit, and
 * Metro applies the edited file first: a class the edit just added would be reported for as long as the build takes.
 */
export const UNKNOWN_CLASS_DELAY = 500;

/** Used classes the table does not fully express: one that has no rules, or one the converter left parts of out (`truncate`, `line-clamp-2`). */
function reportMissing(names: readonly string[]): void {
  for (const name of names) {
    if (reportedMissing.has(name)) continue;
    reportedMissing.add(name);
    pending.add(name);
  }
  if (pending.size === 0 || pendingTimer !== undefined) return;
  pendingTimer = setTimeout(() => {
    pendingTimer = undefined;
    for (const name of pending) {
      const expressed = Object.hasOwn(table.classes, name);
      // The converter knew it and could not express it, or some of it (`hover:bg-sky-600`, `truncate`): the table says why. Otherwise the build never saw it.
      const reason = table.unsupported !== undefined && Object.hasOwn(table.unsupported, name) ? table.unsupported[name] : undefined;
      if (expressed && reason === undefined) continue;
      console.warn(
        expressed
          ? `expo-svelte: class "${name}" is partly supported on native: ${reason}`
          : reason === undefined
            ? `expo-svelte: class "${name}" is not in the class table: is the file under src/, and is the css option set?`
            : `expo-svelte: class "${name}" is not supported on native: ${reason}`,
      );
    }
    pending.clear();
  }, UNKNOWN_CLASS_DELAY);
}

// --- A list against the table ---

const isWidthCondition = (rule: ClassRule): boolean => rule.when?.minWidth !== undefined || rule.when?.maxWidth !== undefined;

function analyze(className: string): Analysis {
  const rules: ClassRule[] = [];
  const flagged: string[] = [];
  for (const name of new Set(className.split(/\s+/))) {
    if (!Object.hasOwn(table.classes, name)) {
      if (!MARKER.test(name)) flagged.push(name);
      continue;
    }
    if (table.unsupported !== undefined && Object.hasOwn(table.unsupported, name)) flagged.push(name);
    // A rule for the other system never applies: the platform does not change while the app runs.
    for (const rule of table.classes[name] ?? []) if (rule.when?.platform === undefined || rule.when.platform === Platform.OS) rules.push(rule);
  }
  if (dev() && flagged.length > 0) reportMissing(flagged);
  rules.sort((a, b) => a.order - b.order);
  return {
    rules,
    conditional: rules.filter((rule) => rule.when?.scheme !== undefined || isWidthCondition(rule)),
    scheme: rules.some((rule) => rule.when?.scheme !== undefined),
    width: rules.some(isWidthCondition),
    variants: new Map(),
  };
}

/** Whether a conditional rule applies. `width` is only read when a rule has a width condition (the caller reads it for that). */
function applies(rule: ClassRule, scheme: string, width: number): boolean {
  const when = rule.when;
  if (when === undefined) return true;
  if (when.scheme !== undefined && when.scheme !== scheme) return false;
  if (when.minWidth !== undefined && width < when.minWidth) return false;
  if (when.maxWidth !== undefined && width >= when.maxWidth) return false;
  return true;
}

const RELATIVE_KEYS = ["lineHeight", "letterSpacing"] as const;
const TRANSFORM_PREFIX = "transform:";

/**
 * The rules that apply, merged in cascade order: a later rule wins a key, whether it is a plain value, a device value or relative to the font size
 * (`text-lg`'s font-relative line height and `leading-6`'s own are one key), and a `null` removes the key.
 */
function merge(rules: readonly ClassRule[]): Variant {
  const style: Style = {};
  const dynamic: Record<string, DynamicValue> = {};
  const relative: Partial<Record<(typeof RELATIVE_KEYS)[number], number>> = {};
  const forget = (key: string) => {
    delete style[key];
    delete dynamic[key];
    delete (relative as Record<string, number>)[key];
  };
  for (const rule of rules) {
    // A null takes the key away from what the rules before it set (`dark:shadow-none`): a later rule can set it again.
    for (const key in rule.style) {
      forget(key);
      const value = rule.style[key];
      if (value !== null && value !== undefined) style[key] = value;
    }
    for (const key in rule.dynamic) {
      forget(key);
      dynamic[key] = rule.dynamic[key] as DynamicValue;
    }
    for (const key of RELATIVE_KEYS) {
      const value = rule.fontRelative?.[key];
      if (value === undefined) continue;
      forget(key);
      relative[key] = value;
    }
  }
  if (Platform.OS === "ios" && typeof style.fontFamily === "string" && Object.hasOwn(IOS_FONTS, style.fontFamily)) style.fontFamily = IOS_FONTS[style.fontFamily];
  // CSS's `translate`, `rotate` and `scale` are properties of their own, applied in that order before `transform`: React Native has the one list.
  const transform: Record<string, string | number>[] = [];
  for (const key of TRANSFORM_KEYS) {
    if (!(key in style)) continue;
    transform.push({ [key.slice(TRANSFORM_PREFIX.length)]: style[key] as string | number });
    delete style[key];
  }
  if (transform.length > 0) style.transform = [...transform, ...(Array.isArray(style.transform) ? (style.transform as typeof transform) : [])];
  return {
    style: Object.keys(style).length > 0 ? style : undefined,
    dynamic: Object.keys(dynamic).length > 0 ? dynamic : undefined,
    relative: Object.keys(relative).length > 0 ? relative : undefined,
  };
}

/** The font size of an element's own style (an object, or arrays and falsy values of them: the last one that has a size wins), which is the size its text is drawn at. */
function fontSizeOf(style: unknown): number | undefined {
  if (Array.isArray(style)) {
    let size: number | undefined;
    for (const item of style) size = fontSizeOf(item) ?? size;
    return size;
  }
  const size = style !== null && typeof style === "object" ? (style as Style).fontSize : undefined;
  return typeof size === "number" ? size : undefined;
}

/**
 * The variant's style with what only the element or the device knows filled in: the values of the safe area and the window, and the line height and letter
 * spacing that are relative to the font size (the element's own style's, else the classes', else 14). The same object while those are the same.
 */
function finish(variant: Variant, elementStyle: unknown, defer: boolean): Style | undefined {
  if (variant.dynamic === undefined && variant.relative === undefined) return variant.style;
  const values: Record<string, unknown> = {};
  let key = "";
  // Each source is read once, so a view listens to it once.
  let size: { width: number; height: number } | undefined;
  let area: typeof insets | undefined;
  for (const property in variant.dynamic) {
    const value = variant.dynamic[property] as DynamicValue;
    let base: number;
    if ("inset" in value) {
      area ??= safeArea();
      base = area[value.inset] * (value.scale ?? 1);
    } else {
      size ??= windowSize();
      base = size[value.window] * value.scale;
    }
    values[property] = base + (value.add ?? 0);
    key += `${values[property]},`;
  }
  if (variant.relative !== undefined && defer) {
    // The element inherits its font size (a lowered HTML element, `fabric/text-inherit.ts`): the host works the values out, so they stay what the classes said.
    values.fontRelative = variant.relative;
    key += "d";
  } else if (variant.relative !== undefined) {
    const own = variant.style?.fontSize;
    const fontSize = fontSizeOf(elementStyle) ?? (typeof own === "number" ? own : DEFAULT_FONT_SIZE);
    for (const property of RELATIVE_KEYS) {
      const factor = variant.relative[property];
      if (factor !== undefined) values[property] = Math.round(factor * fontSize * 10_000) / 10_000;
    }
    key += `f${fontSize}`;
  }
  const known = variant.resolved?.get(key);
  if (known !== undefined) return known;
  variant.resolved ??= new Map();
  if (variant.resolved.size >= MAX_RESOLVED) variant.resolved.clear();
  const style = { ...variant.style, ...values };
  variant.resolved.set(key, style);
  return style;
}

/**
 * The style of a class list (the names separated by spaces, not empty), or `undefined` when none of its classes gives one. `style` is the element's own
 * style, which sets the font size its relative line height is made from. With `defer` the relative values stay in the result, under a `fontRelative` key (see `ClassResolver`).
 * Call it where a template or a `$derived` tracks it: what the rules depend on is read here.
 */
export function resolveClasses(className: string, style?: unknown, defer?: boolean): unknown {
  if (dev()) subscribeTable();
  if (empty) {
    if (dev() && !warnedEmpty) {
      warnedEmpty = true;
      console.warn(`expo-svelte: class="${className}" has no effect: the class table is empty. Set the css option of withExpoSvelte to your CSS file (css: "src/global.css") and use the classes in files under src/ (docs: styling#classes).`);
    }
    return undefined;
  }
  let analysis = analyses.get(className);
  if (analysis === undefined) {
    analysis = analyze(className);
    analyses.set(className, analysis);
  }
  const scheme = analysis.scheme ? colorScheme.current : "light";
  const width = analysis.width ? windowSize().width : 0;
  let key = "";
  for (const rule of analysis.conditional) key += applies(rule, scheme, width) ? "1" : "0";
  let variant = analysis.variants.get(key);
  if (variant === undefined) {
    variant = merge(analysis.rules.filter((rule) => applies(rule, scheme, width)));
    analysis.variants.set(key, variant);
  }
  return finish(variant, style, defer === true);
}
