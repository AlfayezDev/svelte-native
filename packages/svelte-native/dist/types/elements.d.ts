// The declarations of the React Native modules the library's own source imports by path (`react-native/Libraries/…`): `react-native` ships no
// types for some of them and none with a default export. A type check of the source (this repository's apps, which take the `svelte-native-source` condition of the
// exports map) reaches every source file the library's entries import, so a public declaration file carries them along instead of leaving each app
// to declare them again. The declarations in `dist/types` (what an installed app reads) name none of these modules, and their copy of this file leaves the
// reference out (`scripts/build-types.ts`).
import "svelte/elements";
import type { ActivityIndicatorProps, ImageProps, Insets, KeyboardAvoidingViewProps, ModalProps, PressableProps, ScrollViewProps, SwitchProps, TextInputProps, TextProps, ViewProps } from "react-native";
import type { BarStyle, Detent, DetentChange, HeaderMetrics, Presentation, ScreenAnimation } from "./fabric/navigation.js";
import type { GestureProps } from "./gestures/types.js";

/** What a `ref` attribute on a host element receives: the host's handle for the element (see `fabric/host.ts`), or null on unmount. */
// biome-ignore lint/suspicious/noExplicitAny: the handle type depends on the element
type HostRef = (handle: any) => void; // eslint-disable-line @typescript-eslint/no-explicit-any -- The handle type depends on the element.

/**
 * What the host's `Pressability` (a port of React Native's, `fabric/pressability.ts`) reads besides the press handlers React Native types. Any node that has a
 * press handler (`onPress`, `onPressIn`, `onPressOut`, `onLongPress`, `onPressChange`) takes it: `Pressable` always, `Text` and `View` when one is set.
 */
export type PressConfig = {
  /** Svelte's own: called with `true` when the press becomes active and `false` when it ends (after `delayPressOut`), to keep `let pressed = $state(false)`. */
  onPressChange?: (pressed: boolean) => void;
  /** How far outside the node, in points, a press may move and still count; the name of Pressability's config, which `Pressable` also takes as `pressRetentionOffset`. */
  pressRectOffset?: Insets | number | null;
  /** Milliseconds from touch down to the press becoming active (React Native's `unstable_pressDelay`). */
  delayPressIn?: number | null;
  /** Milliseconds from touch up to the press ending. */
  delayPressOut?: number | null;
  /** The press stays active at least this long (default 130). */
  minPressDuration?: number | null;
};
/** The press handlers and options of `View`, which React Native's `View` does not have and this host's does (`<View onPress>`). */
export type PressHandlers = Pick<PressableProps, "onPress" | "onPressIn" | "onPressOut" | "onLongPress" | "delayLongPress" | "cancelable"> & PressConfig;

/**
 * A native element takes the React Native props of its primitive directly as attributes.
 * `nativeProps` is the legacy object form; attributes win over its keys.
 * `nativeStyle` carries a style object where Svelte would stringify a `style` attribute, and `nativeClass` the style of a `class` (`lower.ts`).
 * `gesture` takes a gesture from `@alfayez/svelte-native` (react-native-gesture-handler's builders): the host attaches
 * native recognisers to the element's view, which then keeps its own native view (`collapsable` is forced to `false`).
 */
type PressHandlerAttributes<Props> = {
  /** What a lowered tag passes for the press handler it was given as an expression that may be `undefined` (`onPress={enabled ? go : undefined}`): the prop `onPress`, only while it is a function (`lower.ts`). */
  nativeOnPress?: Props extends { onPress?: infer Handler } ? Handler : unknown;
  nativeOnPressIn?: Props extends { onPressIn?: infer Handler } ? Handler : unknown;
  nativeOnPressOut?: Props extends { onPressOut?: infer Handler } ? Handler : unknown;
  nativeOnLongPress?: Props extends { onLongPress?: infer Handler } ? Handler : unknown;
  nativeOnPressChange?: Props extends { onPressChange?: infer Handler } ? Handler : unknown;
};
type NativeElementAttributes<Props> = Omit<Props, "children" | "ref"> & GestureProps & PressHandlerAttributes<Props> & { nativeProps?: Record<string, unknown>; nativeStyle?: Props extends { style?: infer Style } ? Style : unknown; nativeClass?: unknown; /** A style under the class and the style (an `<hr>`'s default). */ nativeBase?: unknown; /** Set by the lowering of an HTML element: text style inherits through it (`fabric/text-inherit.ts`). */ nativeHtml?: boolean; /** Set on a lowered `<form>`: submit buttons and Enter in its inputs fire its `submit` (`hostSubmit`). */ nativeForm?: boolean; ref?: HostRef };
type ElementProps = NativeElementAttributes<Record<string, unknown>>;
/**
 * What the engine's navigation container reads from a `native-screen` (see `fabric/navigation.ts`, SPEC.md "Navigation"
 * and "Screen API contract"). `Screen` fills these from its own options; they are consumed by the encoder and never
 * reach the view as props.
 */
type NativeScreenProps = NativeElementAttributes<ViewProps & {
  /** 0 detached/inactive, 1 transitioning, 2 active; only the top active screen takes touches. */
  activityState?: 0 | 1 | 2;
  /** Fixed for the life of the screen. */
  stackPresentation?: Presentation;
  stackAnimation?: ScreenAnimation;
  /** Edge swipe back and predictive back drag; default true. */
  gestureEnabled?: boolean;
  /** The Android back button pops the top screen natively (then `onDismissed`); default true, false leaves it to `BackHandler`. */
  nativeBackButtonDismissalEnabled?: boolean;
  /** `sheet` and `formSheet`: detents as fractions of `availableHeight` or `"auto"`, the one shown first, grabber, dismissal, scrim. */
  sheetDetents?: readonly Detent[];
  sheetInitialDetent?: Detent;
  sheetGrabber?: boolean;
  sheetDismissible?: boolean;
  sheetBackdrop?: "dim" | "none";
  /** Surface height below the top inset, and the top inset itself, in dp: they size the sheet box. */
  availableHeight?: number;
  topInset?: number;
  statusBarStyle?: BarStyle;
  statusBarHidden?: boolean;
  navigationBarColor?: string;
  navigationBarStyle?: BarStyle;
  onAppear?: () => void;
  onDisappear?: () => void;
  /** The user dismissed the screen (back button or gesture, after the transition): the router removes it. */
  onDismissed?: (event: { nativeEvent: { dismissCount?: number } }) => void;
  /** A screen whose `activityState` was set to 0 has left (iOS: SPEC.md "Screen exit"); sent once, after the exit transition. */
  onExited?: () => void;
  onDetentChange?: (event: { nativeEvent: DetentChange }) => void;
}>;
/** The header band of a screen: the engine draws its chrome (background, title, back arrow, divider, search) in the node's frame. */
type NativeHeaderProps = NativeElementAttributes<ViewProps & {
  title?: string;
  subtitle?: string;
  backTitle?: string;
  large?: boolean;
  translucent?: boolean;
  /** Draw the back arrow and reserve its width. */
  back?: boolean;
  hideShadow?: boolean;
  tint?: string;
  background?: string;
  /** Mask of the slots present: 1 left, 2 center, 4 right, 8 search. */
  slots?: number;
  /** Estimated total height and status bar inset in dp until the native side reports its own. */
  headerHeight?: number;
  headerInset?: number;
  onMetrics?: (event: { nativeEvent: HeaderMetrics }) => void;
}>;
/** A header slot (`native-header-left|center|right`): a row of the bar's height. */
type NativeHeaderSlotProps = NativeElementAttributes<ViewProps & { align?: "start" | "center" }>;
/** The search slot: hosts the results shown while the search is active, and carries the search field's state. */
type NativeHeaderSearchProps = NativeElementAttributes<ViewProps & {
  placeholder?: string;
  value?: string;
  /** Native edits already seen; `value` applies only when no newer native edit is pending. */
  eventCount?: number;
  surfaceHeight?: number;
  headerHeight?: number;
  onChange?: (event: { nativeEvent: { text: string; eventCount: number } }) => void;
  onSubmitEditing?: (event: { nativeEvent: { text: string } }) => void;
  onCancel?: () => void;
}>;
/** The tab container: the engine draws the bar below the panes. */
type NativeTabsProps = NativeElementAttributes<ViewProps & {
  selectedIndex?: number;
  /** Counts presses; the native side re-applies `selectedIndex` whenever this or the index changes. */
  selectCount?: number;
  tint?: string;
  inactiveTint?: string;
  background?: string;
  labels?: "always" | "never";
  /** Bar height in dp (inset included) the panes leave free. */
  barHeight?: number;
  onSelect?: (event: { nativeEvent: { key: string; index: number } }) => void;
  onMetrics?: (event: { nativeEvent: HeaderMetrics }) => void;
}>;
/** One tab: its pane (the node's children) and the bar item the engine draws for it. */
type NativeTabProps = NativeElementAttributes<ViewProps & {
  tabKey?: string;
  title?: string;
  icon?: string;
  selectedIcon?: string;
  /** The icon is the `native-tab-icon` child, drawn as a template. */
  iconView?: boolean;
  badge?: string | number | boolean;
  disabled?: boolean;
  barHeight?: number;
}>;

/**
 * The toolbar band at the bottom of a screen (SPEC.md "Toolbar"): the engine draws its chrome (background, items, badges) in the
 * node's frame and reports its real size with `onMetrics`. Its children are `native-toolbar-item`s in order, then the optional
 * `native-toolbar-center`.
 */
type NativeToolbarProps = NativeElementAttributes<ViewProps & {
  /** No toolbar is drawn; `Screen` omits the node instead. */
  hidden?: boolean;
  translucent?: boolean;
  tint?: string;
  background?: string;
  /** Mask of the slots present: 1 center. */
  slots?: number;
  /** Estimated total height and bottom inset in dp until the native side reports its own. */
  toolbarHeight?: number;
  toolbarInset?: number;
  /** The platform whose row metrics (`TOOLBAR_METRICS`) the band's Yoga style uses. */
  toolbarPlatform?: "android" | "ios";
  /** An item was pressed; `index` is its position among the item nodes. */
  onPress?: (event: { nativeEvent: { key: string; index: number } }) => void;
  onMetrics?: (event: { nativeEvent: HeaderMetrics }) => void;
}>;
/** One toolbar action, or flexible space with `spacer`. A snippet icon is the node's child, drawn live. */
type NativeToolbarItemProps = NativeElementAttributes<ViewProps & {
  itemKey?: string;
  title?: string;
  icon?: string;
  /** The icon is the node's child content. */
  iconView?: boolean;
  badge?: string | number | boolean;
  disabled?: boolean;
  spacer?: boolean;
  /** The toolbar has a center slot: a spacer does not grow, the center takes all the free width. */
  centered?: boolean;
  /** The platform whose row metrics (`TOOLBAR_METRICS`) the item's Yoga style uses. */
  toolbarPlatform?: "android" | "ios";
}>;

/**
 * A component another library mounts through React Native's own mounting (a WebView, a map, an Expo module's view), by its
 * Fabric component name. Every other attribute is a prop of that component; `fabric/view-configs.ts` says which ones it
 * takes. Its children are mounted by the same library (a map's markers). See SPEC.md, "Foreign views".
 */
type NativeForeignProps = NativeElementAttributes<ViewProps & { component: string; [prop: string]: unknown }>;

declare module "svelte/elements" {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- Must match Svelte's interface parameters.
  interface HTMLAttributes<T> { nativeProps?: object; }
  /** The element names the host maps to native views; see `viewNames` in `fabric/host.ts`. */
  interface SvelteHTMLElements {
    "native-view": NativeElementAttributes<ViewProps & PressHandlers>;
    "native-text": NativeElementAttributes<TextProps & PressConfig>;
    "native-input": NativeElementAttributes<TextInputProps>;
    "native-pressable": NativeElementAttributes<PressableProps & PressConfig>;
    "native-scroll": NativeElementAttributes<ScrollViewProps>;
    "native-image": NativeElementAttributes<ImageProps>;
    "native-switch": NativeElementAttributes<SwitchProps>;
    "native-spinner": NativeElementAttributes<ActivityIndicatorProps>;
    "native-modal": NativeElementAttributes<ModalProps>;
    "native-safe-area": NativeElementAttributes<ViewProps>;
    "native-keyboard": NativeElementAttributes<KeyboardAvoidingViewProps>;
    "native-screen": NativeScreenProps;
    "native-stack": NativeElementAttributes<ViewProps>;
    "native-header": NativeHeaderProps;
    "native-header-left": NativeHeaderSlotProps;
    "native-header-center": NativeHeaderSlotProps;
    "native-header-right": NativeHeaderSlotProps;
    "native-header-search": NativeHeaderSearchProps;
    "native-tabs": NativeTabsProps;
    "native-tab": NativeTabProps;
    "native-tab-icon": NativeElementAttributes<ViewProps>;
    "native-toolbar": NativeToolbarProps;
    "native-toolbar-item": NativeToolbarItemProps;
    "native-toolbar-center": NativeElementAttributes<ViewProps>;
    "native-animated-view": ElementProps;
    "native-foreign": NativeForeignProps;
    /** Draws nothing and has no native view: a place in the tree. Its `ref` gets a handle whose `position()` says where it is among its siblings (react-native-svg's `Stop` and `FeMergeNode`). */
    "native-anchor": { ref?: HostRef };
  }
}
