import { getContext, type Snippet } from "svelte";
import type { NavigationState } from "../hmr-state.ts";

/**
 * The navigation tags on the Fabric host. They are plain `RCTView` nodes: the engine tells them apart by `nativeID`
 * and reads their configuration from it, because `RCTView` has no codegen props for them and Fabric keeps no raw
 * props it could rely on. The contract (API, grammar, records, events) is `native/svelte-core/SPEC.md`,
 * "Screen API contract (header, sheet, tabs)"; this module is its executable form: pure encoders, a reference decoder
 * (`decodeRecords`) that native decoders are tested against, and the layout constants JavaScript and native share.
 *
 * `nativeID` = `svelte:<kind>` followed by `;key=value` pairs. Values are `encodeURIComponent` output (so `;`, `=`, `,`
 * and `%` never appear raw); a list is its items encoded and joined by `,`. Keys are unique per kind, unknown keys are
 * ignored by decoders, and a key that is absent means its default. Kinds and keys:
 *
 * - `stack`
 * - `screen`: `a` activityState, `p` presentation, `g` gesture, `s` animation, `b` nativeBack (always present, in this order);
 *   `dt` detents and `di` initial detent index (sheet only), `gr` grabber (`0` off for a sheet, `1` on for a form sheet),
 *   `dm=0` not dismissible, `bd=1` no backdrop (sheet and formSheet);
 *   `ss` status bar style (`l`|`d`), `sx=1` status bar hidden, `nc` navigation bar color, `ns` navigation bar style (`l`|`d`)
 * - `header`: `t` title, `st` subtitle, `bt` backTitle, `l=1` large, `tl=1` translucent, `bk=1` back button, `hs=1` no shadow,
 *   `tc` tint, `bg` background, `sl` slot mask
 * - `header-left`, `header-center`, `header-right`
 * - `header-search`: `ph` placeholder, `v` value, `ec` event count
 * - `tabs`: `sel` selected index, `sc` select count, `tc` tint, `uc` inactive tint, `bg` background, `lb=1` no labels
 * - `tab`: `k` key, `t` title, `ic` icon uri, `is` selected icon uri, `iv=1` icon is a view, `bd` badge text (present and empty = dot), `ds=1` disabled
 * - `tab-icon`
 * - `toolbar`: `hd=1` hidden, `tl=1` translucent, `tc` tint, `bg` background, `sl` slot mask (bit 1 center)
 * - `toolbar-item`: `k` key, `t` title, `ic` icon uri, `iv=1` icon is a view, `bd` badge text (present and empty = dot), `ds=1` disabled, `sp=1` flexible space (a spacer carries no other key)
 * - `toolbar-center`
 *
 * Colors are `rrggbbaa` (8 hex digits). Events are ordinary handlers: the engine emits `top<Name>` on the node's emitter
 * and the host maps it to the `on<Name>` attribute.
 */
export const navigationTags: ReadonlySet<string> = new Set([
  "native-stack",
  "native-screen",
  "native-header",
  "native-header-left",
  "native-header-center",
  "native-header-right",
  "native-header-search",
  "native-tabs",
  "native-tab",
  "native-tab-icon",
  "native-toolbar",
  "native-toolbar-item",
  "native-toolbar-center",
]);

/** Context keys shared by the components: the nearest `Screen` (nested screens register into it) and its header geometry. */
export const SCREEN_CONTEXT = Symbol.for("svelte-native.screen");
export const HEADER_CONTEXT = Symbol.for("svelte-native.header");
export const TOOLBAR_CONTEXT = Symbol.for("svelte-native.toolbar");
/** Set by a router (`Router.svelte`), by a `Screen` that makes a stack of its own and by `<Native name="native-stack">` (`Host.svelte`), for everything inside the `native-stack`; `Modal` and `Tabs` clear it. A `Screen` with no stack above it (and no screen around it) makes a one-entry stack of its own: on iOS only a stack draws a screen's header. */
export const IN_STACK_CONTEXT = Symbol.for("svelte-native.in-stack");
/** Set by `Tabs` for everything inside a pane: the pane ends at the tab bar, which already covers the bottom inset. */
export const PANE_CONTEXT = Symbol.for("svelte-native.pane");
/**
 * Set by a `Screen` for everything inside it: the background it is drawn with (its own, else the one it took). A screen of a stack inside it (a tab's, a nested stack's) that has
 * none of its own takes it, so a tab's screens look as the screen of the tab bar does, and only a screen inside no screen has the system's (`system-colors.ts`).
 */
export const BACKGROUND_CONTEXT = Symbol.for("svelte-native.background");

/** The header geometry of the screen around the caller, in dp: `height` includes the status bar `inset`. Read it to pad content under a `large` or `translucent` header. */
export function useHeader(): { readonly height: number; readonly inset: number } {
  return getContext<{ readonly height: number; readonly inset: number } | undefined>(HEADER_CONTEXT) ?? { height: 0, inset: 0 };
}

/** The toolbar geometry of the screen around the caller, in dp: `height` includes the bottom `inset`. Read it to pad content under a `translucent` toolbar. */
export function useToolbar(): { readonly height: number; readonly inset: number } {
  return getContext<{ readonly height: number; readonly inset: number } | undefined>(TOOLBAR_CONTEXT) ?? { height: 0, inset: 0 };
}

/** Whether the caller sits in a tab pane: the pane ends at the tab bar, which already covers the bottom inset, so content there pads no bottom inset of its own. */
export function inTabPane(): boolean {
  return getContext<boolean | undefined>(PANE_CONTEXT) === true;
}

/** A source `resolveAssetSource` accepts: a `require`d asset or `{ uri }`. Drawn as a template image, tinted by the bar. */
export type TabIconSource = number | { uri: string };
export type TabItem = {
  key: string;
  title: string;
  /** An asset, or a snippet drawn as a template (alpha only) by the bar; it receives whether the tab is selected. */
  icon?: TabIconSource | Snippet<[selected: boolean]>;
  selectedIcon?: TabIconSource;
  /** Text or a number (above 99 it reads "99+"); `true` shows a dot. */
  badge?: string | number | boolean;
  disabled?: boolean;
  /** Label of the tab bar item (default: its title and badge); not the pane's. */
  accessibilityLabel?: string;
  testID?: string;
};
/** What a tab's `content` snippet receives. Hand it to the tab's router as `{ scope: tab.key, active: () => tab.selected }`. */
export type TabHandle = { readonly key: string; readonly selected: boolean };

/**
 * What `createRouter` takes to keep one stack per tab: the router answers `useRouter(scope)`, and handles back and links only while `active()`.
 * `restore` is for the root router: the state a process that died left (`parseNavigation(initialProps.navigation)`), adopted unless a stopped surface left a fresher one.
 */
export type RouterScopeOptions = { scope?: string; active?: () => boolean; restore?: NavigationState };

// Layout constants shared by the encoders, the components and both native sides (dp on Android, pt on iOS).
export type NavigationPlatform = "android" | "ios";
/** Bar height without the status bar inset: Material app bar height, UIKit navigation bar height. */
export const HEADER_BAR: Record<NavigationPlatform, number> = { android: 56, ios: 44 };
/** Extra height of an expanded large title: a second 56 dp row on Android, the 52 pt large title area of UIKit. */
export const HEADER_LARGE_EXTRA: Record<NavigationPlatform, number> = { android: 56, ios: 52 };
/** Tab bar height without the bottom inset: icon 24 + label 12 sp + padding on Android, UITabBar on iOS. */
export const TAB_BAR: Record<NavigationPlatform, number> = { android: 64, ios: 49 };
/** Toolbar height without the bottom inset: Material bottom app bar, UIKit toolbar. */
export const TOOLBAR_BAR: Record<NavigationPlatform, number> = { android: 56, ios: 44 };
/**
 * The toolbar row's horizontal geometry, in dp on Android and pt on iOS. Yoga lays the row out with these numbers (`edge` is the
 * band's horizontal padding, `item` the width of an item, `gap` the margin on each side of one) and the native side places the
 * items by the same numbers, so the center's Yoga width is the free span between the items: an Android item occupies 48, an
 * iOS one `item + 2 * gap` = 52 (UIKit's 44 pt button and the 8 pt between two), the iOS band's edges 32.
 */
export const TOOLBAR_METRICS: Record<NavigationPlatform, { readonly edge: number; readonly item: number; readonly gap: number }> = {
  android: { edge: 4, item: 48, gap: 0 },
  ios: { edge: 16, item: 44, gap: 4 },
};
/**
 * Whether the native stack of a platform keeps a screen whose `activityState` JavaScript set to 0 on screen, takes it
 * away with its exit transition and then sends `topExited` (SPEC.md, "Screen exit"). Where it does, the router keeps a
 * popped entry mounted until that event, so the unmount of the page leaves the transition's frames; where it does not,
 * the router removes the entry at once and the stack animates the removal itself (how Android worked before `EngineStack.exitScreen`).
 */
export const EXIT_REPORTED: Record<NavigationPlatform, boolean> = { android: true, ios: true };
/** How long the router waits for `topExited` before it removes a popped entry anyway (and says so). The longest exit is a sheet's, about 0.5 s. */
export const EXIT_TIMEOUT_MS = 2500;
/** Width reserved at the start of the header for the back button; also the minimum hit area. */
export const BACK_BUTTON_WIDTH = 48;
/** Size of a tab icon slot. */
export const TAB_ICON_SIZE = 24;
export const SHEET_MAX_DETENTS = 4;
export const SHEET_DEFAULT_DETENTS: readonly Detent[] = [0.5, 1];

/** Total header height (status bar inset included) before the native side reports its own with `onMetrics`. */
export function headerHeight(platform: NavigationPlatform, inset: number, large: boolean): number {
  return inset + HEADER_BAR[platform] + (large ? HEADER_LARGE_EXTRA[platform] : 0);
}

/** Total toolbar height (bottom inset included) before the native side reports its own with `onMetrics`. */
export function toolbarHeight(platform: NavigationPlatform, inset: number): number {
  return TOOLBAR_BAR[platform] + inset;
}

export type Detent = number | "auto";
export type Presentation = "push" | "modal" | "transparentModal" | "sheet" | "formSheet";
export type BarStyle = "auto" | "light" | "dark";
export type HeaderOptions = {
  hidden?: boolean;
  /** Large title that collapses with the screen's first scroll view. */
  large?: boolean;
  /** The header overlays the content instead of reserving space. */
  translucent?: boolean;
  hideBack?: boolean;
  /** iOS back button label; the Android arrow's accessibility label. */
  backTitle?: string;
  tint?: string;
  background?: string;
  hideShadow?: boolean;
};
export type SearchOptions = {
  value?: string;
  placeholder?: string;
  onChangeText?: (text: string) => void;
  onSubmit?: (text: string) => void;
  onCancel?: () => void;
};
export type SheetOptions = {
  /** Heights as fractions of the space below the top inset, ascending; `"auto"` is the content height. Default `[0.5, 1]`. */
  detents?: readonly Detent[];
  /** The detent shown first, one of `detents`; default the first. */
  initialDetent?: Detent;
  grabber?: boolean;
  dismissible?: boolean;
  backdrop?: "dim" | "none";
};
/** One action of a screen's toolbar; `{ key, spacer: true }` is flexible space and takes nothing else. */
export type ToolbarItem = {
  key: string;
  title?: string;
  /** An asset, drawn as a template image and tinted by the bar; or a snippet, which receives `pressed` (always `false` for now: the contract has no pressed-state event). A snippet is drawn, not pressed: a `Pressable` inside it never fires, the item is the only press (`ToolbarOptions.onPress`). */
  icon?: TabIconSource | Snippet<[pressed: boolean]>;
  /** Text or a number (above 99 it reads "99+"); `true` shows a dot. */
  badge?: string | number | boolean;
  disabled?: boolean;
  accessibilityLabel?: string;
  testID?: string;
  spacer?: boolean;
};
export type ToolbarOptions = {
  items?: readonly ToolbarItem[];
  /** No toolbar node at all. */
  hidden?: boolean;
  /** The toolbar overlays the content instead of reserving space; pad content with `useToolbar().height`. */
  translucent?: boolean;
  tint?: string;
  background?: string;
  /** A press on an item, by its key. */
  onPress?: (key: string) => void;
};
export type StatusBarOptions = { style?: BarStyle; hidden?: boolean };
export type NavigationBarOptions = { color?: string; style?: BarStyle };
export type DetentChange = { index: number; fraction: number };
export type HeaderMetrics = { height: number; inset: number };
export type ScreenAnimation =
  | "default" | "none" | "fade" | "slide_from_right" | "slide_from_left" | "slide_from_bottom" | "fade_from_bottom" | "simple_push" | "flip" | "android_activity";

/** Everything a `Screen` takes besides its content. Nested screens of one stack entry merge into one of these. */
export type ScreenOptions = {
  title?: string;
  subtitle?: string;
  header?: HeaderOptions;
  headerLeft?: Snippet;
  headerRight?: Snippet;
  headerCenter?: Snippet;
  headerSearch?: Snippet;
  search?: SearchOptions;
  toolbar?: ToolbarOptions;
  /** Custom content in the toolbar between its items (a composer, a segmented control). */
  toolbarCenter?: Snippet;
  presentation?: Presentation;
  sheet?: SheetOptions;
  statusBar?: StatusBarOptions;
  navigationBar?: NavigationBarOptions;
  animation?: ScreenAnimation;
  gestureEnabled?: boolean;
  nativeBackButtonDismissalEnabled?: boolean;
  /** 0 detached/inactive, 1 transitioning, 2 active; only the top active screen takes touches. */
  activityState?: 0 | 1 | 2;
  /** Whether the stack has a screen below this one; the header then reserves and draws the back button. */
  canGoBack?: boolean;
  style?: unknown;
  onAppear?: () => void;
  onDisappear?: () => void;
  onDismiss?: () => void;
  /** The exit transition of a screen whose `activityState` JavaScript set to 0 ended (only on platforms in `EXIT_REPORTED`): the router removes it. */
  onExited?: () => void;
  onDetentChange?: (event: DetentChange) => void;
};

const definedEntries = (value: object) => Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
const objectOptions = ["header", "search", "sheet", "statusBar", "navigationBar", "toolbar"] as const;
const eventOptions = ["onAppear", "onDisappear", "onDismiss", "onExited", "onDetentChange"] as const;

/**
 * One option set laid over another, as nested `Screen`s do: a defined value of `over` wins, object options (`header`,
 * `sheet`, ...) merge key by key, and event handlers are chained (`base` first) so neither side loses its callbacks.
 */
export function mergeScreenOptions(base: Readonly<ScreenOptions>, over: Readonly<ScreenOptions>): ScreenOptions {
  const merged: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(over)) if (value !== undefined) merged[key] = value;
  for (const key of objectOptions) if (base[key] && over[key]) merged[key] = { ...base[key], ...definedEntries(over[key]) };
  for (const key of eventOptions) {
    const first = base[key] as ((event?: never) => void) | undefined;
    const second = over[key] as ((event?: never) => void) | undefined;
    if (first && second) merged[key] = (event?: never) => { first(event); second(event); };
  }
  return merged as ScreenOptions;
}

// Grammar.

type Pair = readonly [key: string, value: string | number | undefined];
const encode = (value: string | number) => encodeURIComponent(String(value));

/** `svelte:<kind>` plus the pairs whose value is defined; values are percent-encoded, a pre-joined list goes through `list`. */
export function encodeNativeID(kind: string, pairs: readonly Pair[]): string {
  let id = `svelte:${kind}`;
  for (const [key, value] of pairs) if (value !== undefined) id += `;${key}=${value}`;
  return id;
}
const text = (value: unknown): string | undefined => typeof value === "string" && value !== "" ? encode(value) : undefined;
const list = (items: readonly (string | number)[]): string => items.map(encode).join(",");
const flag = (value: unknown): 1 | undefined => value === true ? 1 : undefined;

/** The parts of a `nativeID`: its kind and its raw (still encoded) values; use `decodeValue` and `decodeList` to read them. */
export function parseNativeID(id: string): { kind: string; pairs: Record<string, string> } | null {
  if (!id.startsWith("svelte:")) return null;
  const [kind, ...rest] = id.slice("svelte:".length).split(";");
  const pairs: Record<string, string> = {};
  for (const part of rest) {
    const at = part.indexOf("=");
    if (at > 0) pairs[part.slice(0, at)] = part.slice(at + 1);
  }
  return { kind, pairs };
}
export const decodeValue = (raw: string): string => decodeURIComponent(raw);
export const decodeList = (raw: string): string[] => raw === "" ? [] : raw.split(",").map(decodeValue);

/** `rrggbbaa` for `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`, `rgb(r, g, b)`, `rgba(r, g, b, a)`, `transparent` and React Native's processed `0xAARRGGBB` numbers; undefined for anything else. */
export function colorToWire(value: unknown): string | undefined {
  const byte = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
  if (typeof value === "number") return Number.isInteger(value) ? `${byte((value >>> 16) & 255)}${byte((value >>> 8) & 255)}${byte(value & 255)}${byte((value >>> 24) & 255)}` : undefined;
  if (typeof value !== "string") return undefined;
  const source = value.trim().toLowerCase();
  if (source === "transparent") return "00000000";
  const hex = /^#([0-9a-f]+)$/.exec(source)?.[1];
  if (hex && [3, 4, 6, 8].includes(hex.length)) {
    const full = hex.length <= 4 ? [...hex].map((digit) => digit + digit).join("") : hex;
    return full.length === 6 ? `${full}ff` : full;
  }
  const rgb = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*(\d*\.?\d+)\s*)?\)$/.exec(source);
  if (rgb) return `${byte(Number(rgb[1]))}${byte(Number(rgb[2]))}${byte(Number(rgb[3]))}${byte(rgb[4] === undefined ? 255 : Number(rgb[4]) * 255)}`;
  return undefined;
}

const wireInt = (raw: string | undefined, fallback: number): number => {
  const value = raw === undefined ? Number.NaN : Number.parseInt(raw, 10);
  return Number.isNaN(value) ? fallback : value;
};
const argb = (raw: string | undefined): [number, number] => {
  if (!raw || !/^[0-9a-f]{8}$/.test(raw)) return [0, 0];
  const rgba = Number.parseInt(raw, 16);
  return [1, (((rgba & 255) << 24) | (rgba >>> 8)) >>> 0];
};

// Screen.

const presentations = new Set<string>(["push", "modal", "transparentModal", "sheet", "formSheet"]);
const animations = new Set<string>(["default", "none", "fade", "slide_from_right", "slide_from_left", "slide_from_bottom", "fade_from_bottom", "simple_push", "flip", "android_activity"]);
const screenStyle = { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 };
const stackStyle = { flex: 1 };
const barStyleCode: Record<string, string> = { light: "l", dark: "d" };

/** At most `SHEET_MAX_DETENTS` valid entries (fractions in (0, 1] or `"auto"`) in the given order without repeats; the default when none is valid. */
export function normalizeDetents(input: unknown): Detent[] {
  const out: Detent[] = [];
  if (Array.isArray(input)) {
    for (const item of input) {
      const valid = item === "auto" || (typeof item === "number" && item > 0 && item <= 1);
      if (valid && !out.includes(item) && out.length < SHEET_MAX_DETENTS) out.push(item);
    }
  }
  return out.length ? out : [...SHEET_DEFAULT_DETENTS];
}

/**
 * The Yoga box of a sheet screen: anchored to the bottom, as tall as its tallest fractional detent of `available`
 * (the surface height below the top inset; a percentage of the stack while unknown); with an `"auto"` detent the
 * height follows the content, at least the tallest fraction and at most `available`.
 */
export function sheetStyle(detents: readonly Detent[], available: number | undefined): Record<string, unknown> {
  const fractions = detents.filter((detent): detent is number => detent !== "auto");
  const tallest = fractions.length ? Math.max(...fractions) : 0;
  const size = (fraction: number) => available === undefined ? `${Math.round(fraction * 100)}%` : Math.round(fraction * available);
  const box: Record<string, unknown> = { position: "absolute", left: 0, right: 0, bottom: 0, maxHeight: available === undefined ? "100%" : Math.round(available) };
  if (detents.includes("auto")) { if (tallest) box.minHeight = size(tallest); }
  else box.height = size(tallest);
  return box;
}

const SCREEN_KEYS = ["activityState", "stackPresentation", "gestureEnabled", "stackAnimation", "nativeBackButtonDismissalEnabled", "sheetDetents", "sheetInitialDetent", "sheetGrabber", "sheetDismissible", "sheetBackdrop", "availableHeight", "topInset", "statusBarStyle", "statusBarHidden", "navigationBarColor", "navigationBarStyle"];

function screenProps(attributes: Record<string, unknown>): Record<string, unknown> {
  const presentation = typeof attributes.stackPresentation === "string" && presentations.has(attributes.stackPresentation) ? attributes.stackPresentation : "push";
  const animation = typeof attributes.stackAnimation === "string" && animations.has(attributes.stackAnimation) ? attributes.stackAnimation : "default";
  const state = typeof attributes.activityState === "number" ? attributes.activityState : 2;
  const pairs: Pair[] = [
    ["a", state], ["p", presentation], ["g", attributes.gestureEnabled === false ? 0 : 1], ["s", animation], ["b", attributes.nativeBackButtonDismissalEnabled === false ? 0 : 1],
  ];
  let style: Record<string, unknown> = screenStyle;
  const dismissible = ["dm", attributes.sheetDismissible === false ? 0 : undefined] as const;
  const backdrop = ["bd", attributes.sheetBackdrop === "none" ? 1 : undefined] as const;
  if (presentation === "sheet") {
    const detents = normalizeDetents(attributes.sheetDetents);
    const initial = Math.max(0, detents.indexOf(attributes.sheetInitialDetent as Detent));
    pairs.push(["dt", list(detents)], ["di", initial === 0 ? undefined : initial], ["gr", attributes.sheetGrabber === false ? 0 : undefined], dismissible, backdrop);
    style = sheetStyle(detents, typeof attributes.availableHeight === "number" ? attributes.availableHeight : undefined);
  } else if (presentation === "formSheet") {
    // One fixed detent below the top inset; no grabber unless asked for.
    pairs.push(["gr", attributes.sheetGrabber === true ? 1 : undefined], dismissible, backdrop);
    style = { position: "absolute", top: typeof attributes.topInset === "number" ? attributes.topInset : 0, left: 0, right: 0, bottom: 0 };
  }
  pairs.push(
    ["ss", barStyleCode[attributes.statusBarStyle as string]], ["sx", flag(attributes.statusBarHidden)],
    ["nc", colorToWire(attributes.navigationBarColor)], ["ns", barStyleCode[attributes.navigationBarStyle as string]],
  );
  return withId(attributes, SCREEN_KEYS, encodeNativeID("screen", pairs), style);
}

// Header.

const HEADER_KEYS = ["title", "subtitle", "backTitle", "large", "translucent", "back", "hideShadow", "tint", "background", "slots", "headerHeight", "headerInset", "align"];

/** Slot mask bits of the `sl` key and record 121. */
export const SLOT_LEFT = 1;
export const SLOT_CENTER = 2;
export const SLOT_RIGHT = 4;
export const SLOT_SEARCH = 8;

function headerProps(attributes: Record<string, unknown>): Record<string, unknown> {
  const overlay = attributes.large === true || attributes.translucent === true;
  const inset = typeof attributes.headerInset === "number" ? attributes.headerInset : 0;
  const height = typeof attributes.headerHeight === "number" ? attributes.headerHeight : 0;
  // An overlay header sits over the content view, which comes after it in the tree: the z-index keeps it drawn and hit first.
  const box = {
    ...(overlay ? { position: "absolute", top: 0, left: 0, right: 0, zIndex: 1 } : {}),
    height, paddingTop: inset, paddingStart: attributes.back === true ? BACK_BUTTON_WIDTH : 0, flexDirection: "row", alignItems: "center",
  };
  const id = encodeNativeID("header", [
    ["t", text(attributes.title)], ["st", text(attributes.subtitle)], ["bt", text(attributes.backTitle)],
    ["l", flag(attributes.large)], ["tl", flag(attributes.translucent)], ["bk", flag(attributes.back)], ["hs", flag(attributes.hideShadow)],
    ["tc", colorToWire(attributes.tint)], ["bg", colorToWire(attributes.background)], ["sl", typeof attributes.slots === "number" && attributes.slots > 0 ? attributes.slots : undefined],
  ]);
  return withId(attributes, HEADER_KEYS, id, box);
}

const SLOT_KEYS = ["placeholder", "value", "eventCount", "align", "surfaceHeight", "headerHeight"];

function slotProps(name: string, attributes: Record<string, unknown>): Record<string, unknown> {
  const row = { flexDirection: "row", alignItems: "center" };
  if (name === "native-header-left") return withId(attributes, SLOT_KEYS, encodeNativeID("header-left", []), row);
  if (name === "native-header-right") return withId(attributes, SLOT_KEYS, encodeNativeID("header-right", []), row);
  if (name === "native-header-center") {
    return withId(attributes, SLOT_KEYS, encodeNativeID("header-center", []), { ...row, flex: 1, justifyContent: attributes.align === "start" ? "flex-start" : "center" });
  }
  // The search slot hosts the results shown while the search is active: absolute, from the header's bottom edge to the surface's.
  const below = typeof attributes.surfaceHeight === "number" && typeof attributes.headerHeight === "number" ? Math.max(0, attributes.surfaceHeight - attributes.headerHeight) : undefined;
  const box = { position: "absolute", top: "100%", left: 0, right: 0, ...(below === undefined ? { bottom: 0 } : { height: below }) };
  const id = encodeNativeID("header-search", [
    ["ph", text(attributes.placeholder)], ["v", text(attributes.value)], ["ec", typeof attributes.eventCount === "number" && attributes.eventCount > 0 ? attributes.eventCount : undefined],
  ]);
  return withId(attributes, SLOT_KEYS, id, box);
}

// Tabs.

const TABS_KEYS = ["selectedIndex", "selectCount", "tint", "inactiveTint", "background", "labels", "barHeight"];
const TAB_KEYS = ["tabKey", "title", "icon", "selectedIcon", "iconView", "badge", "disabled", "barHeight"];

/** The badge of a tab as the wire carries it: a number or text, `true` for a dot (empty text), undefined for none; numbers above 99 read "99+". */
export function badgeText(badge: unknown): string | undefined {
  if (badge === true) return "";
  if (typeof badge === "number" && Number.isFinite(badge) && badge > 0) return badge > 99 ? "99+" : String(Math.floor(badge));
  return typeof badge === "string" && badge !== "" ? badge : undefined;
}

function tabsProps(name: string, attributes: Record<string, unknown>): Record<string, unknown> {
  if (name === "native-tabs") {
    const id = encodeNativeID("tabs", [
      ["sel", typeof attributes.selectedIndex === "number" ? attributes.selectedIndex : 0], ["sc", typeof attributes.selectCount === "number" && attributes.selectCount > 0 ? attributes.selectCount : undefined],
      ["tc", colorToWire(attributes.tint)], ["uc", colorToWire(attributes.inactiveTint)], ["bg", colorToWire(attributes.background)], ["lb", attributes.labels === "never" ? 1 : undefined],
    ]);
    return withId(attributes, TABS_KEYS, id, stackStyle);
  }
  if (name === "native-tab") {
    const badge = badgeText(attributes.badge);
    const id = encodeNativeID("tab", [
      ["k", text(attributes.tabKey)], ["t", text(attributes.title)], ["ic", text(attributes.icon)], ["is", text(attributes.selectedIcon)],
      ["iv", flag(attributes.iconView)], ["bd", badge === undefined ? undefined : encode(badge)], ["ds", flag(attributes.disabled)],
    ]);
    const bottom = typeof attributes.barHeight === "number" ? attributes.barHeight : 0;
    return withId(attributes, TAB_KEYS, id, { position: "absolute", top: 0, left: 0, right: 0, bottom });
  }
  // Out of the pane's flow, so the content below is not pushed down; the bar draws it, the pane does not.
  return withId(attributes, TAB_KEYS, encodeNativeID("tab-icon", []), { position: "absolute", top: 0, left: 0, width: TAB_ICON_SIZE, height: TAB_ICON_SIZE, alignItems: "center", justifyContent: "center" });
}

// Toolbar.

const TOOLBAR_KEYS = ["hidden", "translucent", "tint", "background", "slots", "toolbarHeight", "toolbarInset", "toolbarPlatform"];
const TOOLBAR_ITEM_KEYS = ["itemKey", "title", "icon", "iconView", "badge", "disabled", "spacer", "centered", "toolbarPlatform"];
/** Slot mask bit of the toolbar's `sl` key and record 128. */
export const SLOT_TOOLBAR_CENTER = 1;

function toolbarProps(name: string, attributes: Record<string, unknown>): Record<string, unknown> {
  // `Screen` passes the platform like the band's height; a node without it is laid out as on Android.
  const metrics = TOOLBAR_METRICS[attributes.toolbarPlatform === "ios" ? "ios" : "android"];
  if (name === "native-toolbar") {
    const inset = typeof attributes.toolbarInset === "number" ? attributes.toolbarInset : 0;
    const height = typeof attributes.toolbarHeight === "number" ? attributes.toolbarHeight : 0;
    // In flow below the content view (`flex: 1`), or over it at the bottom edge when translucent; the node is the last child of the screen, so it is drawn and hit last.
    const box = {
      ...(attributes.translucent === true ? { position: "absolute", left: 0, right: 0, bottom: 0 } : {}),
      height, paddingBottom: inset, paddingHorizontal: metrics.edge, flexDirection: "row", alignItems: "center",
    };
    const id = encodeNativeID("toolbar", [
      ["hd", flag(attributes.hidden)], ["tl", flag(attributes.translucent)],
      ["tc", colorToWire(attributes.tint)], ["bg", colorToWire(attributes.background)], ["sl", typeof attributes.slots === "number" && attributes.slots > 0 ? attributes.slots : undefined],
    ]);
    return withId(attributes, TOOLBAR_KEYS, id, box);
  }
  if (name === "native-toolbar-item") {
    // Flexible space carries no other key. With a center slot the center takes all the free width (natively, on both platforms,
    // the other spacers are then zero), so Yoga must not share it with the spacers: they do not grow.
    if (attributes.spacer === true) return withId(attributes, TOOLBAR_ITEM_KEYS, encodeNativeID("toolbar-item", [["sp", 1]]), { flexGrow: attributes.centered === true ? 0 : 1 });
    const badge = badgeText(attributes.badge);
    const id = encodeNativeID("toolbar-item", [
      ["k", text(attributes.itemKey)], ["t", text(attributes.title)], ["ic", text(attributes.icon)],
      ["iv", flag(attributes.iconView)], ["bd", badge === undefined ? undefined : encode(badge)], ["ds", flag(attributes.disabled)],
    ]);
    // A fixed width, not a minimum: the native side places every item at exactly `item` (plus `gap` each side), so the center's
    // Yoga width is the span it gets. A snippet icon is drawn inside, centered by the native side.
    const style = { width: metrics.item, marginHorizontal: metrics.gap, flexDirection: "row", alignItems: "center", justifyContent: "center" };
    // The item is the only press (`toolbar.onPress(key)`, from the native control): `box-only` ends a JavaScript touch at the item
    // node, which has no press handler, so a Pressable inside a snippet never fires, on either platform.
    return { ...withId(attributes, TOOLBAR_ITEM_KEYS, id, style), pointerEvents: "box-only" };
  }
  // The custom content between the items: fills what they leave, centered like the header's center slot.
  return withId(attributes, TOOLBAR_ITEM_KEYS, encodeNativeID("toolbar-center", []), { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center" });
}

/** Attributes the encoder consumed leave the props; the rest (handlers, `ref`, accessibility, `testID`) pass through. */
function withId(attributes: Record<string, unknown>, consumed: readonly string[], nativeID: string, style: Record<string, unknown>): Record<string, unknown> {
  const rest: Record<string, unknown> = {};
  for (const key in attributes) if (!consumed.includes(key)) rest[key] = attributes[key];
  return { ...rest, nativeID, style: [style, attributes.style] };
}

/** `activityState` 0 detached/inactive, 1 transitioning, 2 active; the other props default as in react-native-screens. */
export function navigationProps(name: string, attributes: Record<string, unknown>): Record<string, unknown> {
  if (name === "native-stack") return { ...attributes, nativeID: "svelte:stack", style: [stackStyle, attributes.style] };
  if (name === "native-screen") return screenProps(attributes);
  if (name === "native-header") return headerProps(attributes);
  if (name === "native-header-left" || name === "native-header-center" || name === "native-header-right" || name === "native-header-search") return slotProps(name, attributes);
  if (name === "native-toolbar" || name === "native-toolbar-item" || name === "native-toolbar-center") return toolbarProps(name, attributes);
  return tabsProps(name, attributes);
}

// Reference decoder: what the engine's C++ (Android) and the iOS components must read out of a `nativeID`.

export type NavRecord = { id: number; values: (number | string)[] };
/** Engine view kinds of the navigation tags (10 and 11 predate the screen API). */
export const NAV_KINDS: Record<string, number> = { stack: 10, screen: 11, header: 12, "header-left": 13, "header-center": 13, "header-right": 13, "header-search": 13, tabs: 14, tab: 15, "tab-icon": 16, toolbar: 17, "toolbar-item": 18, "toolbar-center": 13 };
/** Slot codes of record 126: the toolbar's center content is slot 4 of the header slots' kind. */
const SLOTS: Record<string, number> = { "header-left": 0, "header-center": 1, "header-right": 2, "header-search": 3, "toolbar-center": 4 };
const PRESENTATION_CODE: Record<string, number> = { push: 0, modal: 1, transparentModal: 2, sheet: 3, formSheet: 4 };
const ANIMATION_CODE: Record<string, number> = {
  default: 0, none: 1, fade: 2, slide_from_right: 3, slide_from_bottom: 4, slide_from_left: 5, fade_from_bottom: 6, android_activity: 7, flip: 8, simple_push: 9,
};
const barCode = (raw: string | undefined) => raw === "l" ? 1 : raw === "d" ? 2 : 0;

/**
 * The prop records a `nativeID` stands for, in the order the batch carries them, as the SPEC tables define them.
 * Strings are the decoded text or -1 when absent, colors are `hasColor` then unsigned `0xAARRGGBB`, flags and enums
 * are their codes, detents are fractions with -1 for `"auto"`. Null for a string that is not a navigation `nativeID`.
 */
export function decodeRecords(nativeID: string): { kind: number; records: NavRecord[] } | null {
  const parsed = parseNativeID(nativeID);
  const kind = parsed ? NAV_KINDS[parsed.kind] : undefined;
  if (!parsed || kind === undefined) return null;
  const { pairs } = parsed;
  const string = (key: string): string | number => pairs[key] === undefined ? -1 : decodeValue(pairs[key]);
  const records: NavRecord[] = [];
  switch (parsed.kind) {
    case "screen": {
      records.push({ id: 110, values: [wireInt(pairs.a, 2), PRESENTATION_CODE[pairs.p] ?? 0, wireInt(pairs.g, 1), ANIMATION_CODE[pairs.s] ?? 0, wireInt(pairs.b, 1)] });
      if (pairs.p === "sheet" || pairs.p === "formSheet") {
        const form = pairs.p === "formSheet";
        const detents = form ? [1] : pairs.dt === undefined ? [...SHEET_DEFAULT_DETENTS] : decodeList(pairs.dt).map((item) => item === "auto" ? "auto" : Number(item));
        const fractions = detents.slice(0, SHEET_MAX_DETENTS).map((item) => item === "auto" ? -1 : item);
        records.push({ id: 122, values: [fractions.length, ...fractions, Math.min(wireInt(pairs.di, 0), fractions.length - 1), wireInt(pairs.gr, form ? 0 : 1), wireInt(pairs.dm, 1), wireInt(pairs.bd, 0)] });
      }
      if (["ss", "sx", "nc", "ns"].some((key) => pairs[key] !== undefined)) {
        records.push({ id: 125, values: [barCode(pairs.ss), wireInt(pairs.sx, 0), ...argb(pairs.nc), barCode(pairs.ns)] });
      }
      break;
    }
    case "header": {
      const flags = (pairs.l === "1" ? 1 : 0) | (pairs.tl === "1" ? 2 : 0) | (pairs.bk === "1" ? 4 : 0) | (pairs.hs === "1" ? 8 : 0);
      records.push({ id: 120, values: [flags, string("t"), string("st"), string("bt"), ...argb(pairs.tc), ...argb(pairs.bg)] });
      records.push({ id: 121, values: [wireInt(pairs.sl, 0)] });
      break;
    }
    case "header-left": case "header-center": case "header-right": case "header-search": case "toolbar-center": {
      records.push({ id: 126, values: [SLOTS[parsed.kind]] });
      if (parsed.kind === "header-search") records.push({ id: 127, values: [string("ph"), string("v"), wireInt(pairs.ec, 0)] });
      break;
    }
    case "tabs":
      records.push({ id: 123, values: [wireInt(pairs.sel, 0), wireInt(pairs.sc, 0), ...argb(pairs.tc), ...argb(pairs.uc), ...argb(pairs.bg), wireInt(pairs.lb, 0)] });
      break;
    case "tab":
      records.push({ id: 124, values: [string("k"), string("t"), string("ic"), string("is"), wireInt(pairs.iv, 0), pairs.bd === undefined ? 0 : decodeValue(pairs.bd) === "" ? 1 : 2, pairs.bd === undefined ? -1 : decodeValue(pairs.bd), wireInt(pairs.ds, 0)] });
      break;
    case "toolbar":
      records.push({ id: 128, values: [(pairs.hd === "1" ? 1 : 0) | (pairs.tl === "1" ? 2 : 0), ...argb(pairs.tc), ...argb(pairs.bg), wireInt(pairs.sl, 0)] });
      break;
    case "toolbar-item":
      records.push({ id: 129, values: [string("k"), string("t"), string("ic"), wireInt(pairs.iv, 0), pairs.bd === undefined ? 0 : decodeValue(pairs.bd) === "" ? 1 : 2, pairs.bd === undefined ? -1 : decodeValue(pairs.bd), wireInt(pairs.ds, 0), wireInt(pairs.sp, 0)] });
      break;
  }
  return { kind, records };
}
