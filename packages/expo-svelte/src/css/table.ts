/**
 * The class table: what a CSS file's classes are in React Native styles, written at build time (`css/build.ts` runs Tailwind and
 * `css/convert.ts` converts its output) and read at run time (`css/runtime.ts`). It is plain data, so the generated module
 * (`.expo-svelte/classes.<variant>.ts`) is `export default <ClassTable as JSON>`.
 *
 * A class has one or more rules. A rule applies when its condition holds (`when`), and the style of a class list is the rules of
 * all its classes that apply, merged in `order` (the cascade: a later rule wins), then `dynamic` resolved against the device.
 */

/** A value a style key takes in React Native: a number (dp), a string (a colour, a percentage, a keyword), or a transform/shadow list. */
export type StyleValue = string | number | readonly Record<string, string | number>[];

/** A value only the device knows: an inset of the safe area, or a share of the window, each times `scale` plus `add` (dp). */
export type DynamicValue =
  | { inset: "top" | "right" | "bottom" | "left"; scale?: number; add?: number }
  | { window: "width" | "height"; scale: number; add?: number };

export type ClassCondition = {
  /** The system's appearance (`prefers-color-scheme`, Tailwind's `dark:`). */
  scheme?: "light" | "dark";
  /** The window's width in dp: `min-width` inclusive, `max-width` exclusive (`width >= 48rem` is `minWidth: 768`, `width < 48rem` is `maxWidth: 768`). */
  minWidth?: number;
  maxWidth?: number;
  /** Tailwind's `ios:` / `android:` custom variants, when the CSS file defines them as `@media (platform: ios)`-like conditions. */
  platform?: "ios" | "android";
};

export type ClassRule = {
  /** Position in the cascade, unique across the table: layer first (theme < base < components < utilities < unlayered), then the CSS order. */
  order: number;
  when?: ClassCondition;
  /**
   * React Native style keys with their resolved values. `null` removes the key from what earlier rules set (`shadow-none` after
   * `shadow-md`, `dark:translate-none`), as a later declaration of the CSS property's initial value would.
   */
  style: Record<string, StyleValue | null>;
  /** Keys whose value depends on the device (safe-area insets, window size). */
  dynamic?: Record<string, DynamicValue>;
  /**
   * Keys whose value is relative to the font size: a unitless `line-height` (Tailwind's `leading-*`, `text-*`'s default leading) and an
   * `em` `letter-spacing` (`tracking-*`). React Native wants dp, so the runtime multiplies each by the merged style's `fontSize` (14 when none).
   */
  fontRelative?: Partial<Record<"lineHeight" | "letterSpacing", number>>;
};

/**
 * CSS has `translate`, `rotate` and `scale` as separate properties; React Native has one `transform` list. A rule writes them as these
 * keys in `style`, and the runtime composes the merged ones into `transform` in CSS's order (translate, rotate, scale), so
 * `translate-x-2 rotate-45` keeps both. Values: dp for the translations, a CSS angle string (`"45deg"`) for the rotations, numbers for scales.
 */
export const TRANSFORM_KEYS = ["transform:translateX", "transform:translateY", "transform:rotate", "transform:rotateX", "transform:rotateY", "transform:scaleX", "transform:scaleY"] as const;

export type ClassTable = {
  version: 1;
  /** By class name as written in markup (`p-4`, `md:p-10`, `bg-sky-500/50`, `card`): unescaped. */
  classes: Record<string, readonly ClassRule[]>;
  /**
   * The classes the source mentions that the converter could not express (`hover:bg-sky-600`, `grid`, `transition`), each with a one-line reason; they are
   * not in `classes`. The runtime reads it when a class that has no rules is used, so the warning says why. Absent when there are none.
   */
  unsupported?: Record<string, string>;
};

/** What the converter could not express, for a build-time warning: the class, the CSS property and why. */
export type Unsupported = { className: string; property: string; reason: string };
