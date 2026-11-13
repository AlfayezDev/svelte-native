import { type Snippet } from "svelte";
import type { NavigationState } from "../hmr-state.js";
/**
 * The navigation tags on the Fabric host. They are plain `RCTView` nodes: the engine tells them apart by `nativeID`
 * and reads their configuration from it, because `RCTView` has no codegen props for them and Fabric keeps no raw
 * props it could rely on. The contract (API, grammar, records, events) is `native/svelte-engine/SPEC.md`,
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
export declare const navigationTags: ReadonlySet<string>;
/** Context keys shared by the components: the nearest `Screen` (nested screens register into it) and its header geometry. */
export declare const SCREEN_CONTEXT: unique symbol;
export declare const HEADER_CONTEXT: unique symbol;
export declare const TOOLBAR_CONTEXT: unique symbol;
/** Set by a router (`Router.svelte`), by a `Screen` that makes a stack of its own and by `<Native name="native-stack">` (`Host.svelte`), for everything inside the `native-stack`; `Modal` and `Tabs` clear it. A `Screen` with no stack above it (and no screen around it) makes a one-entry stack of its own: on iOS only a stack draws a screen's header. */
export declare const IN_STACK_CONTEXT: unique symbol;
/** Set by `Tabs` for everything inside a pane: the pane ends at the tab bar, which already covers the bottom inset. */
export declare const PANE_CONTEXT: unique symbol;
/** The header geometry of the screen around the caller, in dp: `height` includes the status bar `inset`. Read it to pad content under a `large` or `translucent` header. */
export declare function useHeader(): {
    readonly height: number;
    readonly inset: number;
};
/** The toolbar geometry of the screen around the caller, in dp: `height` includes the bottom `inset`. Read it to pad content under a `translucent` toolbar. */
export declare function useToolbar(): {
    readonly height: number;
    readonly inset: number;
};
/** Whether the caller sits in a tab pane: the pane ends at the tab bar, which already covers the bottom inset, so content there pads no bottom inset of its own. */
export declare function inTabPane(): boolean;
/** A source `resolveAssetSource` accepts: a `require`d asset or `{ uri }`. Drawn as a template image, tinted by the bar. */
export type TabIconSource = number | {
    uri: string;
};
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
export type TabHandle = {
    readonly key: string;
    readonly selected: boolean;
};
/**
 * What `createRouter` takes to keep one stack per tab: the router answers `useRouter(scope)`, and handles back and links only while `active()`.
 * `restore` is for the root router: the state a process that died left (`parseNavigation(initialProps.navigation)`), adopted unless a stopped surface left a fresher one.
 */
export type RouterScopeOptions = {
    scope?: string;
    active?: () => boolean;
    restore?: NavigationState;
};
export type NavigationPlatform = "android" | "ios";
/** Bar height without the status bar inset: Material app bar height, UIKit navigation bar height. */
export declare const HEADER_BAR: Record<NavigationPlatform, number>;
/** Extra height of an expanded large title: a second 56 dp row on Android, the 52 pt large title area of UIKit. */
export declare const HEADER_LARGE_EXTRA: Record<NavigationPlatform, number>;
/** Tab bar height without the bottom inset: icon 24 + label 12 sp + padding on Android, UITabBar on iOS. */
export declare const TAB_BAR: Record<NavigationPlatform, number>;
/** Toolbar height without the bottom inset: Material bottom app bar, UIKit toolbar. */
export declare const TOOLBAR_BAR: Record<NavigationPlatform, number>;
/**
 * The toolbar row's horizontal geometry, in dp on Android and pt on iOS. Yoga lays the row out with these numbers (`edge` is the
 * band's horizontal padding, `item` the width of an item, `gap` the margin on each side of one) and the native side places the
 * items by the same numbers, so the center's Yoga width is the free span between the items: an Android item occupies 48, an
 * iOS one `item + 2 * gap` = 52 (UIKit's 44 pt button and the 8 pt between two), the iOS band's edges 32.
 */
export declare const TOOLBAR_METRICS: Record<NavigationPlatform, {
    readonly edge: number;
    readonly item: number;
    readonly gap: number;
}>;
/**
 * Whether the native stack of a platform keeps a screen whose `activityState` JavaScript set to 0 on screen, takes it
 * away with its exit transition and then sends `topExited` (SPEC.md, "Screen exit"). Where it does, the router keeps a
 * popped entry mounted until that event, so the unmount of the page leaves the transition's frames; where it does not,
 * the router removes the entry at once and the stack animates the removal itself (how Android worked before `EngineStack.exitScreen`).
 */
export declare const EXIT_REPORTED: Record<NavigationPlatform, boolean>;
/** How long the router waits for `topExited` before it removes a popped entry anyway (and says so). The longest exit is a sheet's, about 0.5 s. */
export declare const EXIT_TIMEOUT_MS = 2500;
/** Width reserved at the start of the header for the back button; also the minimum hit area. */
export declare const BACK_BUTTON_WIDTH = 48;
/** Size of a tab icon slot. */
export declare const TAB_ICON_SIZE = 24;
export declare const SHEET_MAX_DETENTS = 4;
export declare const SHEET_DEFAULT_DETENTS: readonly Detent[];
/** Total header height (status bar inset included) before the native side reports its own with `onMetrics`. */
export declare function headerHeight(platform: NavigationPlatform, inset: number, large: boolean): number;
/** Total toolbar height (bottom inset included) before the native side reports its own with `onMetrics`. */
export declare function toolbarHeight(platform: NavigationPlatform, inset: number): number;
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
export type StatusBarOptions = {
    style?: BarStyle;
    hidden?: boolean;
};
export type NavigationBarOptions = {
    color?: string;
    style?: BarStyle;
};
export type DetentChange = {
    index: number;
    fraction: number;
};
export type HeaderMetrics = {
    height: number;
    inset: number;
};
export type ScreenAnimation = "default" | "none" | "fade" | "slide_from_right" | "slide_from_bottom";
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
/**
 * One option set laid over another, as nested `Screen`s do: a defined value of `over` wins, object options (`header`,
 * `sheet`, ...) merge key by key, and event handlers are chained (`base` first) so neither side loses its callbacks.
 */
export declare function mergeScreenOptions(base: Readonly<ScreenOptions>, over: Readonly<ScreenOptions>): ScreenOptions;
type Pair = readonly [key: string, value: string | number | undefined];
/** `svelte:<kind>` plus the pairs whose value is defined; values are percent-encoded, a pre-joined list goes through `list`. */
export declare function encodeNativeID(kind: string, pairs: readonly Pair[]): string;
/** The parts of a `nativeID`: its kind and its raw (still encoded) values; use `decodeValue` and `decodeList` to read them. */
export declare function parseNativeID(id: string): {
    kind: string;
    pairs: Record<string, string>;
} | null;
export declare const decodeValue: (raw: string) => string;
export declare const decodeList: (raw: string) => string[];
/** `rrggbbaa` for `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`, `rgb(r, g, b)`, `rgba(r, g, b, a)`, `transparent` and React Native's processed `0xAARRGGBB` numbers; undefined for anything else. */
export declare function colorToWire(value: unknown): string | undefined;
/** At most `SHEET_MAX_DETENTS` valid entries (fractions in (0, 1] or `"auto"`) in the given order without repeats; the default when none is valid. */
export declare function normalizeDetents(input: unknown): Detent[];
/**
 * The Yoga box of a sheet screen: anchored to the bottom, as tall as its tallest fractional detent of `available`
 * (the surface height below the top inset; a percentage of the stack while unknown); with an `"auto"` detent the
 * height follows the content, at least the tallest fraction and at most `available`.
 */
export declare function sheetStyle(detents: readonly Detent[], available: number | undefined): Record<string, unknown>;
/** Slot mask bits of the `sl` key and record 121. */
export declare const SLOT_LEFT = 1;
export declare const SLOT_CENTER = 2;
export declare const SLOT_RIGHT = 4;
export declare const SLOT_SEARCH = 8;
/** The badge of a tab as the wire carries it: a number or text, `true` for a dot (empty text), undefined for none; numbers above 99 read "99+". */
export declare function badgeText(badge: unknown): string | undefined;
/** Slot mask bit of the toolbar's `sl` key and record 128. */
export declare const SLOT_TOOLBAR_CENTER = 1;
/** `activityState` 0 detached/inactive, 1 transitioning, 2 active; the other props default as in react-native-screens. */
export declare function navigationProps(name: string, attributes: Record<string, unknown>): Record<string, unknown>;
export type NavRecord = {
    id: number;
    values: (number | string)[];
};
/** Engine view kinds of the navigation tags (10 and 11 predate the screen API). */
export declare const NAV_KINDS: Record<string, number>;
/**
 * The prop records a `nativeID` stands for, in the order the batch carries them, as the SPEC tables define them.
 * Strings are the decoded text or -1 when absent, colors are `hasColor` then unsigned `0xAARRGGBB`, flags and enums
 * are their codes, detents are fractions with -1 for `"auto"`. Null for a string that is not a navigation `nativeID`.
 */
export declare function decodeRecords(nativeID: string): {
    kind: number;
    records: NavRecord[];
} | null;
export {};
