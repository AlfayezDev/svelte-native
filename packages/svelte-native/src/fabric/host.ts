/**
 * Svelte Native host for React Native's Fabric renderer, without React.
 *
 * The Svelte custom renderer keeps a mutable node tree; this module mirrors it into Fabric's
 * persistent shadow tree through the `nativeFabricUIManager` JSI binding, the same contract the
 * React reconciler uses: `createNode` for new nodes, `cloneNodeWithNew…` for changed ones,
 * `appendChild` to rebuild a changed node's child list, and one `completeRoot` per flush.
 * Props go through the host's own payload builder and static view configs (`view-configs.ts`: style
 * flattening, colours, transforms), and events arrive through `registerEventHandler` with the Svelte node as target.
 */
import { bootSummary, mark, runBootTasks } from "../boot-marks.ts";
import { loadReanimated } from "./reanimated-load.ts";
import { onFirstCommit } from "../updates/launch.ts";
import { resolveAssetSource, Platform } from "./deps-rn.ts";
import { createPayload, diffPayload, viewConfigFor } from "./view-configs.ts";
import { requireOptionalNativeModule } from "./deps-expo.ts";
import { mount, unmount, type Component } from "./deps-svelte.ts";
// The animation layer (Reanimated + worklets, ≈ 90 ms of bundle evaluation and a second Hermes runtime on a mid-range
// phone) loads on the first node that needs it; a plain first screen boots without it.
type AnimationModule = typeof import("./animation.ts");
let animation: AnimationModule | null = null;
const ANIMATION_ATTRIBUTES = new Set(["animatedStyle", "animatedProps", "entering", "exiting", "layout"]);
const CSS_ANIMATION_KEY = /^(?:animation|transition)[A-Z]/;
function styleWantsAnimation(style: unknown): boolean {
  if (Array.isArray(style)) { for (let index = 0; index < style.length; index++) if (styleWantsAnimation(style[index])) return true; return false; }
  if (!style || typeof style !== "object") return false;
  for (const key in style as Record<string, unknown>) {
    // Only `animation…` and `transition…` keys can match; the first letter rules out nearly every style key without a regex.
    const first = key.charCodeAt(0);
    if ((first === 97 || first === 116) && CSS_ANIMATION_KEY.test(key)) return true;
  }
  return false;
}
function wantsAnimation(attributes: Record<string, unknown>): boolean {
  for (const key in attributes) if (ANIMATION_ATTRIBUTES.has(key)) return true;
  return styleWantsAnimation(attributes.style);
}
/** Loads Reanimated (also upgrading the public `animation` module's exports to its own functions) and tells the engine once. */
function ensureReanimated(): void {
  loadReanimated();
  if (reanimatedAnnounced) return;
  reanimatedAnnounced = true;
  // The engine's mounting delegate must sit behind Reanimated's layout-animation proxy; the engine re-orders itself.
  if (engineInstalled && !reanimatedAtInstall) engineModule?.reanimatedLoaded?.();
}
function loadAnimation(): AnimationModule {
  if (animation) return animation;
  ensureReanimated();
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  animation = require("./animation.ts") as AnimationModule;
  return animation;
}
// The gesture host (react-native-gesture-handler's detector, `fabric/gestures.ts`) loads on the first node with a `gesture`
// attribute, after Reanimated: UI-thread callbacks are worklets, which must be created against the real functions.
type GesturesModule = typeof import("./gestures.ts");
let gestures: GesturesModule | null = null;
function loadGestures(): GesturesModule {
  if (gestures) return gestures;
  ensureReanimated();
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  gestures = require("./gestures.ts") as GesturesModule;
  return gestures;
}
import { navigationProps, navigationTags } from "./navigation.ts";
import { iosNavigationViewName } from "./navigation.ios.ts";
import { mergeHostProps } from "../native-props.ts";
import { foreignText, type ForeignText } from "./foreign-text.ts";
import renderer, { NativeNode, setInvalidationSink, setUnlinkSink, type Invalidation } from "../renderer.ts";
import { Pressability, type PressabilityConfig, type ResponderHandlers } from "./pressability.ts";
import { createResponder } from "./responder.ts";

type FabricNode = object;
type Binding = {
  createNode(tag: number, viewName: string, rootTag: number, payload: object | null, instanceHandle: object): FabricNode;
  cloneNodeWithNewChildren(node: FabricNode): FabricNode;
  cloneNodeWithNewProps(node: FabricNode, payload: object): FabricNode;
  cloneNodeWithNewChildrenAndProps(node: FabricNode, payload: object): FabricNode;
  createChildSet(rootTag: number): object;
  appendChild(parent: FabricNode, child: FabricNode): void;
  appendChildToSet(set: object, child: FabricNode): void;
  completeRoot(rootTag: number, set: object): void;
  registerEventHandler(handler: (target: unknown, type: string, nativeEvent: object) => void): void;
  measure?(node: FabricNode, callback: (x: number, y: number, width: number, height: number, pageX: number, pageY: number) => void): void;
  measureInWindow?(node: FabricNode, callback: (x: number, y: number, width: number, height: number) => void): void;
  dispatchCommand?(node: FabricNode, name: string, args: unknown[]): void;
  setNativeProps?(node: FabricNode, props: object): void;
};
/** What a `ref` attribute on a host element receives. */
export type HostHandle = {
  readonly tag: number;
  measure(callback: (x: number, y: number, width: number, height: number, pageX: number, pageY: number) => void): void;
  measureInWindow(callback: (x: number, y: number, width: number, height: number) => void): void;
  dispatchCommand(name: string, args?: unknown[]): void;
  /**
   * Where the element is in the document: the index among the siblings at each level, from the root down. Two positions compare as the
   * elements do in the document (the first index that differs decides), which is how a component that has no native view tells which of
   * its kind comes first (`components/svg/registry.ts`). Read when asked, from the tree as it is then.
   */
  position(): number[];
  /** `scrollTo`, `scrollToEnd`, `focus`, `blur` and `setNativeProps` keep React Native's instance signatures. */
  scrollTo(options?: { x?: number; y?: number; animated?: boolean } | number, deprecatedY?: number, deprecatedAnimated?: boolean): void;
  scrollToEnd(options?: { animated?: boolean }): void;
  focus(): void;
  blur(): void;
  setNativeProps(props: Record<string, unknown>): void;
};
type Handler = (event: { nativeEvent: object }) => void;
type State = {
  tag: number;
  viewName: string;
  node: FabricNode | null;
  /** The React Native props the current Fabric node was built from, for diffing. */
  props: Record<string, unknown>;
  handlers: Record<string, Handler>;
  propsDirty: boolean;
  childrenDirty: boolean;
  /** The inner content view a scroll view wraps its children in, as React Native's ScrollView does. */
  content: FabricNode | null;
  /** The `ref` callback last handed a handle, so it is called again only when the attribute changes. */
  ref: unknown;
  /** Text inputs: the `eventCount` of the last native change, echoed back as `mostRecentEventCount` (React Native's controlled-text protocol). */
  eventCount: number;
  /** A foreign view or a node inside one: React Native's own mounting owns its view, so commands and props go through React Native, not the engine. */
  foreign: boolean;
  /** Whether the node's view config declares a prop as an attribute of the view (the animation layer leaves those to the view: `fabric/animation.ts`, `AnimationTarget.declares`). */
  declares?: (key: string) => boolean;
  /** The last build gave the node a lone string as its `content` (`loneText`): when that stops being true the prop has to go, though no attribute changed. */
  lone: boolean;
};
type Root = { rootTag: number; node: NativeNode; instance: Record<string, unknown> };

const raw = (globalThis as { nativeFabricUIManager?: Binding }).nativeFabricUIManager;
const debug = (globalThis as { __svelteFabricTrace?: boolean }).__svelteFabricTrace === true; // set the flag before the first commit to log every binding call
const tagsOf = new WeakMap<object, string>();
const trace: string[] = [];
function labelled<T extends object>(handle: T, label: string): T { tagsOf.set(handle, label); return handle; }
const binding: Binding | undefined = raw && debug ? {
  createNode: (tag, viewName, rootTag, payload, instanceHandle) => { trace.push(`create ${viewName}#${tag}`); return labelled(raw.createNode(tag, viewName, rootTag, payload, instanceHandle), `${viewName}#${tag}`); },
  cloneNodeWithNewChildren: (node) => { const l = tagsOf.get(node); trace.push(`cloneChildren ${l}`); return labelled(raw.cloneNodeWithNewChildren(node), `${l}'`); },
  cloneNodeWithNewProps: (node, payload) => { const l = tagsOf.get(node); trace.push(`cloneProps ${l}`); return labelled(raw.cloneNodeWithNewProps(node, payload), `${l}'`); },
  cloneNodeWithNewChildrenAndProps: (node, payload) => { const l = tagsOf.get(node); trace.push(`cloneBoth ${l}`); return labelled(raw.cloneNodeWithNewChildrenAndProps(node, payload), `${l}'`); },
  createChildSet: (rootTag) => raw.createChildSet(rootTag),
  appendChild: (parent, child) => { trace.push(`append ${tagsOf.get(child)} -> ${tagsOf.get(parent)}`); raw.appendChild(parent, child); },
  appendChildToSet: (set, child) => { trace.push(`toSet ${tagsOf.get(child)}`); raw.appendChildToSet(set, child); },
  completeRoot: (rootTag, set) => { console.log("[fabric trace]", trace.join(" | ")); trace.length = 0; raw.completeRoot(rootTag, set); },
  registerEventHandler: (handler) => raw.registerEventHandler(handler),
} : raw;
const android = () => Platform.OS === "android";
const viewConfig = (viewName: string) => viewConfigFor(viewName, android() ? "android" : "ios");
/** Fabric component names, as React Native registers them; a function picks by platform and props. */
const viewNames: Record<string, string | ((props: Record<string, unknown>) => string)> = {
  "native-view": "RCTView",
  "native-pressable": "RCTView",
  "native-animated-view": "RCTView",
  "native-text": "RCTText",
  "native-scroll": "RCTScrollView",
  "native-input": (props) => android() ? "AndroidTextInput" : props.multiline === true ? "RCTMultilineTextInputView" : "RCTSinglelineTextInputView",
  "native-image": "RCTImageView",
  "native-switch": () => android() ? "AndroidSwitch" : "RCTSwitch",
  "native-spinner": () => android() ? "AndroidProgressBar" : "RCTActivityIndicatorView",
  "native-modal": "RCTModalHostView",
  "native-keyboard": "RCTView",
  "native-safe-area": () => android() ? "RCTView" : "RCTSafeAreaView",
  "native-stack": () => android() ? "RCTView" : iosNavigationViewName("native-stack"),
  "native-screen": () => android() ? "RCTView" : iosNavigationViewName("native-screen"),
  "native-header": () => android() ? "RCTView" : iosNavigationViewName("native-header"),
  "native-header-left": () => android() ? "RCTView" : iosNavigationViewName("native-header-left"),
  "native-header-center": () => android() ? "RCTView" : iosNavigationViewName("native-header-center"),
  "native-header-right": () => android() ? "RCTView" : iosNavigationViewName("native-header-right"),
  "native-header-search": () => android() ? "RCTView" : iosNavigationViewName("native-header-search"),
  "native-tabs": () => android() ? "RCTView" : iosNavigationViewName("native-tabs"),
  "native-tab": () => android() ? "RCTView" : iosNavigationViewName("native-tab"),
  "native-tab-icon": "RCTView",
  "native-toolbar": () => android() ? "RCTView" : iosNavigationViewName("native-toolbar"),
  "native-toolbar-item": () => android() ? "RCTView" : iosNavigationViewName("native-toolbar-item"),
  "native-toolbar-center": () => android() ? "RCTView" : iosNavigationViewName("native-toolbar-center"),
  // A component another library mounts through React Native's own mounting (SPEC.md, "Foreign views"), by its Fabric name.
  "native-foreign": (props) => {
    if (typeof props.component !== "string" || !props.component) throw new Error("native-foreign needs the name of the component to mount");
    return props.component;
  },
};
const stateOf = (node: NativeNode): State | null => node.hostState as State | null;
const dirty = new Set<NativeNode>();
const roots = new Map<number, Root>();
let nextTag = 2;
let flushScheduled = false;
let childrenInvalidated = false;
let engineInstalled = false;
let reanimatedAtInstall = false;
let reanimatedAnnounced = false;
let engineModule: { reanimatedLoaded?: () => void; dispatchCommand?: (tag: number, name: string, args: unknown[]) => void; setNativeProps?: (tag: number, props: Record<string, unknown>) => void; registerForeign?: (name: string) => boolean; saveNavigation?: (json: string) => void; finishing?: () => boolean } | null = null;
/** The foreign components the engine was told about: its mounting delegate must know a component's name before the first node of it is committed. */
const foreignNames = new Set<string>();
function registerForeign(viewName: string): void {
  if (foreignNames.has(viewName)) return;
  foreignNames.add(viewName);
  if (engineInstalled) engineModule?.registerForeign?.(viewName);
}
let engineTried = false;
const stats = { flushes: 0, lastFlushMs: 0, lastCreated: 0, lastCloned: 0, lastCompleted: 0, payloadMs: 0, createMs: 0, appendMs: 0, completeMs: 0 };
/** When `globalThis.__svelteFabricProfile` is set, each flush also records time spent in payload building and in each binding call. */
const profiling = () => (globalThis as { __svelteFabricProfile?: boolean }).__svelteFabricProfile === true;
let profile = false;
const now = () => performance.now();

/** Timings of the most recent flush, for the lab; also published on `globalThis.__svelteFabric` so app code needs no import. */
/** Hands the root router's navigation state to the host, which keeps it for a restart of the process (Android: the Activity's saved instance state). Nothing happens without the engine module. */
export function saveNavigation(json: string): void { engineModule?.saveNavigation?.(json); }
/** Whether the host's window went away because the user left (Back, a swipe from Recents) and not because it is being recreated: Android's `Activity.isFinishing`. */
export function hostFinishing(): boolean { return engineModule?.finishing?.() === true; }
export function fabricStats() { return { ...stats, engineInstalled, animationLoaded: animation !== null, gesturesLoaded: gestures !== null, gestures: gestures?.stats() ?? null }; }
/**
 * Spike instrumentation: the cost of the Fabric binding itself, per call, measured without Svelte.
 * Nodes created here are never committed; they are released when garbage collected.
 */
export function microbench(count = 900): Record<string, number> | null {
  const root = roots.values().next().value;
  if (!binding || !root) return null;
  const rootTag = root.rootTag;
  const viewConfigOfView = viewConfig("RCTView");
  const viewConfigOfText = viewConfig("RCTText");
  const style = { padding: 10, borderRadius: 8, backgroundColor: "#ffffff" };
  const textStyle = { fontSize: 14, color: "#191b1e" };
  const viewPayload = createPayload({ style }, viewConfigOfView) ?? {};
  const textPayload = createPayload({ style: textStyle }, viewConfigOfText) ?? {};
  const handle = {};
  let tag = 1_000_000;
  const nextTag = () => { tag += 2; return tag; };
  const perCall = (run: () => void): number => { const t0 = now(); run(); return Math.round(((now() - t0) * 1000) / count * 100) / 100; };
  const result: Record<string, number> = {};
  result.crossingUs = perCall(() => { for (let i = 0; i < count; i++) binding.createChildSet(rootTag); });
  result.payloadViewUs = perCall(() => { for (let i = 0; i < count; i++) createPayload({ style }, viewConfigOfView); });
  result.createViewEmptyUs = perCall(() => { for (let i = 0; i < count; i++) binding.createNode(nextTag(), "RCTView", rootTag, {}, handle); });
  result.createViewStyledUs = perCall(() => { for (let i = 0; i < count; i++) binding.createNode(nextTag(), "RCTView", rootTag, viewPayload, handle); });
  result.createTextUs = perCall(() => { for (let i = 0; i < count; i++) binding.createNode(nextTag(), "RCTText", rootTag, textPayload, handle); });
  result.createRawTextUs = perCall(() => { for (let i = 0; i < count; i++) binding.createNode(nextTag(), "RCTRawText", rootTag, { text: `Row ${i}` }, handle); });
  const parent = binding.createNode(nextTag(), "RCTView", rootTag, viewPayload, handle);
  const children: FabricNode[] = [];
  for (let i = 0; i < count; i++) children.push(binding.createNode(nextTag(), "RCTView", rootTag, viewPayload, handle));
  result.appendUs = perCall(() => { for (let i = 0; i < count; i++) binding.appendChild(parent, children[i]); });
  result.cloneChildrenUs = perCall(() => { for (let i = 0; i < count; i++) binding.cloneNodeWithNewChildren(children[i]); });
  result.clonePropsUs = perCall(() => { for (let i = 0; i < count; i++) binding.cloneNodeWithNewProps(children[i], textPayload); });
  result.count = count;
  return result;
}
(globalThis as { __svelteFabric?: { stats: typeof fabricStats; microbench: typeof microbench; engine: boolean } }).__svelteFabric = { stats: fabricStats, microbench, engine: false };

function allocateTag(): number {
  const tag = nextTag;
  nextTag += 2;
  return tag;
}

function state(node: NativeNode, viewName: string): State {
  let current = stateOf(node);
  if (!current) {
    current = { tag: allocateTag(), viewName, node: null, props: {}, handlers: {}, propsDirty: true, childrenDirty: true, content: null, ref: undefined, eventCount: 0, foreign: false, lone: false };
    node.hostState = current;
  }
  return current;
}

/** The element's attributes as React Native props (see `mergeHostProps`), with each listener registered on the node as its `on…` handler. */
function nativeProps(node: NativeNode): Record<string, unknown> {
  const props = mergeHostProps(node.peekProps());
  for (const type of node.listeners.keys()) props[`on${type[0]?.toUpperCase()}${type.slice(1)}`] = node.dispatcher(type);
  return props;
}

/** `ref` for a Fabric element: the shadow node handle is read at call time, so it is always the latest committed clone. */
function handleFor(current: State, node: NativeNode | null = null): HostHandle {
  return {
    tag: current.tag,
    position: () => {
      const path: number[] = [];
      for (let at = node; at?.parent; at = at.parent) {
        let index = 0;
        for (let before = at.previousSibling; before; before = before.previousSibling) index++;
        path.push(index);
      }
      return path.reverse();
    },
    measure: (callback) => { if (current.node) binding?.measure?.(current.node, callback); },
    measureInWindow: (callback) => { if (current.node) binding?.measureInWindow?.(current.node, callback); },
    // Engine views take their commands from the engine; a foreign view's view is React Native's, so its commands go through Fabric.
    dispatchCommand: (name, args = []) => {
      if (!current.foreign && engineInstalled && engineModule?.dispatchCommand) engineModule.dispatchCommand(current.tag, name, args);
      else if (current.node) binding?.dispatchCommand?.(current.node, name, args);
    },
    scrollTo(options, deprecatedY, deprecatedAnimated) {
      const spec = typeof options === "number" ? { x: options, y: deprecatedY, animated: deprecatedAnimated } : options ?? {};
      this.dispatchCommand("scrollTo", [spec.x ?? 0, spec.y ?? 0, spec.animated !== false]);
    },
    scrollToEnd(options) { this.dispatchCommand("scrollToEnd", [options?.animated !== false]); },
    focus() { this.dispatchCommand("focus"); },
    blur() { this.dispatchCommand("blur"); },
    setNativeProps(props) {
      if (!current.foreign && engineInstalled && engineModule?.setNativeProps) engineModule.setNativeProps(current.tag, props);
      else if (current.node) binding?.setNativeProps?.(current.node, props);
    },
  };
}

/** The `source` array and default style React Native's Image.android.js builds for the native image. */
function imageProps(props: Record<string, unknown>): Record<string, unknown> {
  const resolved = Array.isArray(props.source) ? props.source : [resolveAssetSource(props.source as never) ?? { uri: "" }];
  const first = (resolved[0] ?? {}) as { width?: number; height?: number };
  const next: Record<string, unknown> = { ...props, source: resolved, style: [resolved.length === 1 && { width: first.width, height: first.height }, { overflow: "hidden" }, props.style] };
  if (props.onLoadStart || props.onLoad || props.onLoadEnd || props.onError) next.shouldNotifyLoadEvents = true;
  return next;
}

/** Splits a primitive's attributes into React Native props (functions become `true`, as React does) and event handlers. */
const scrollBaseVertical = { flexGrow: 1, flexShrink: 1, flexDirection: "column", overflow: "scroll" };
const scrollBaseHorizontal = { flexGrow: 1, flexShrink: 1, flexDirection: "row", overflow: "scroll" };

function splitProps(attributes: Record<string, unknown>, into: State, navigation = false): Record<string, unknown> {
  const props: Record<string, unknown> = {};
  const handlers: Record<string, Handler> = {};
  const textInput = isTextInputView(into.viewName);
  for (const key in attributes) {
    const value = attributes[key];
    if (key === "ref" || key === "contentContainerStyle") continue;
    if (value === undefined) continue;
    if (typeof value === "function" && key.startsWith("on")) { handlers[key] = value as Handler; props[key] = true; }
    else if (textInput && key === "value") props.text = value; // the native text input prop is `text`, as React Native's TextInput passes it
    else props[key] = value;
  }
  if (textInput) props.mostRecentEventCount = into.eventCount;
  // React Native's ScrollView merges this under the caller's style. `overflow: scroll` is what makes Yoga lay the content
  // out at its own height; without it a `flexGrow: 1` content container took the viewport's height and nothing scrolled.
  // `flexShrink: 1` keeps the scroll view inside its parent: with Yoga's FixFlexBasisFitContent (on in React Native) a
  // container child's flex basis is its content height, and only shrink brings it back to the viewport. Done here, not
  // in ScrollView.svelte: the lowering rewrites `<ScrollView>` to `<native-scroll>` at compile time, so the component
  // never runs for lowered call sites.
  if (into.viewName === "RCTScrollView") props.style = [attributes.horizontal === true ? scrollBaseHorizontal : scrollBaseVertical, props.style];
  // A pressable node listens for `click`: Fabric's view props carry the event, and the Android engine makes the view
  // clickable for accessibility services, whose activation comes back as `click` (see `responder.click`).
  // On iOS a view is not an accessibility element unless it says so. React Native's Text sets `accessible` (a block of text is
  // read by VoiceOver) and so does its Pressable (a button is a button with a label of its own); the lowered tags and the
  // components that bypass them must do the same, unless the caller says `accessible={false}`.
  if (Platform.OS === "ios" && props.accessible === undefined && into.viewName === "RCTText") props.accessible = true;
  // A navigation tag's `onPress` is the engine's own event (the toolbar's `topPress { key, index }`), not a responder
  // handler: it must neither make the node clickable and an accessibility element nor start Pressability on it.
  for (let index = 0; index < pressHandlerNames.length && !navigation; index++) {
    if (!handlers[pressHandlerNames[index] as string]) continue;
    props.onClick = true;
    if (Platform.OS === "ios" && props.accessible === undefined) props.accessible = true;
    break;
  }
  if (into.viewName === "AndroidProgressBar") {
    // React Native's ActivityIndicator always sends these; the native measure path dereferences `styleAttr`.
    props.styleAttr = props.styleAttr ?? (props.size === "large" ? "Large" : "Normal");
    props.indeterminate = props.indeterminate ?? true;
    props.animating = props.animating ?? true;
    // React Native gives the indicator a fixed size style, so Yoga never calls the Java measure path (which crashes without state).
    const dimension = props.size === "large" ? 36 : 20;
    props.style = [props.style, { width: dimension, height: dimension }];
  }
  into.handlers = handlers;
  return props;
}

const isTextInputView = (viewName: string) => viewName === "AndroidTextInput" || viewName === "RCTSinglelineTextInputView" || viewName === "RCTMultilineTextInputView";

function isText(node: NativeNode): boolean { return node.name === "native-text"; }

/**
 * The text that is all of [node]'s content, when it is: what a span of a foreign text component takes as its `content` (`foreign-text.ts`). Comments
 * and the empty strings Svelte leaves where a block starts are not content; an empty string alone is (`<TSpan>{""}</TSpan>` has an empty `content`).
 */
function loneText(node: NativeNode): NativeNode | null {
  let only: NativeNode | null = null;
  let empty: NativeNode | null = null;
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.kind === "comment") continue;
    if (child.kind === "text" && child.textValue === "") { empty ??= child; continue; }
    if (only) return null;
    only = child;
  }
  if (only) return only.kind === "text" ? only : null;
  return empty;
}

/** A string inside a foreign text component, built as the span the library makes of it (`foreign-text.ts`). */
function buildSpan(child: NativeNode, rootTag: number, text: ForeignText): FabricNode {
  if (!binding) throw new Error("nativeFabricUIManager is not installed");
  const { viewName, props } = text.span(child.textValue);
  registerForeign(viewName);
  const current = state(child, viewName);
  current.foreign = true;
  const config = viewConfig(viewName);
  if (!current.node) {
    current.node = binding.createNode(current.tag, viewName, rootTag, createPayload(props, config), child);
    stats.lastCreated++;
  } else if (current.propsDirty) {
    const payload = diffPayload(current.props, props, config);
    if (payload) { current.node = binding.cloneNodeWithNewProps(current.node, payload); stats.lastCloned++; }
  }
  current.props = props;
  current.propsDirty = false;
  current.childrenDirty = false;
  return current.node;
}

/** Builds (or rebuilds) the Fabric node for a Svelte element and returns the handle to append into its parent. */
function build(node: NativeNode, rootTag: number, insideText: boolean, insideForeign = false): FabricNode | null {
  if (!binding) throw new Error("nativeFabricUIManager is not installed");
  if (node.kind === "comment" || node.kind === "fragment") return null;
  // A place in the tree with no view (`Stop`, `FeMergeNode`): only its `ref` is served.
  if (node.name === "native-anchor") {
    const current = state(node, node.name);
    current.propsDirty = false;
    current.childrenDirty = false;
    callRef(current, node, node.getProp("ref"));
    return null;
  }
  if (node.kind === "text") {
    const text = node.textValue;
    if (!insideText) return null; // bare text outside a Text is not renderable, as in React Native
    const current = state(node, "RCTRawText");
    if (!current.node) {
      const t0 = profile ? now() : 0;
      current.node = binding.createNode(current.tag, "RCTRawText", rootTag, { text }, node);
      if (profile) stats.createMs += now() - t0;
      stats.lastCreated++;
    }
    else if (current.propsDirty) { current.node = binding.cloneNodeWithNewProps(current.node, { text }); stats.lastCloned++; }
    current.propsDirty = false;
    return current.node;
  }
  let attributes = nativeProps(node);
  const entry = viewNames[node.name];
  if (!entry) throw new Error(`Svelte Native (Fabric) has no mapping for ${node.name}`);
  const viewName = insideText && isText(node) ? "RCTVirtualText" : typeof entry === "function" ? entry(attributes) : entry;
  const foreign = insideForeign || node.name === "native-foreign";
  if (node.name === "native-foreign") registerForeign(viewName);
  // A foreign library's text component takes the strings between its tags itself (`foreign-text.ts`): as the `content` of the span it is, or as spans of their own.
  const text = foreignText.handler;
  const textMode = text && node.name === "native-foreign" ? text.mode(viewName) : null;
  // `childrenAsArray`: the library's XML renderer hands its elements an array of children even for one string, which makes a span of it rather than its `content`.
  const lone = textMode === "span" && attributes.childrenAsArray !== true ? loneText(node) : null;
  if (lone) attributes = { ...attributes, content: lone.textValue };
  const current = state(node, viewName);
  current.foreign = foreign;
  const config = viewConfig(viewName);
  current.declares = (key) => Object.hasOwn(config.attributes, key);
  // `animatedStyle`, `animatedProps` and the CSS keys never reach the payload; once loaded, the animation layer sees every node so it can detach.
  const animated = animation || wantsAnimation(attributes) ? loadAnimation().animationProps(node, current, attributes) : attributes;
  // `gesture` never reaches the payload either; the gesture host forces `collapsable: false` so the view keeps its tag.
  const gestured = gestures || attributes.gesture !== undefined ? loadGestures().gestureProps(node, current, animated) : animated;
  const rnProps = splitProps(node.name === "native-image" ? imageProps(gestured) : navigationTags.has(node.name) ? navigationProps(node.name, gestured) : gestured, current, navigationTags.has(node.name));
  const scroll = viewName === "RCTScrollView";
  const childrenHost = (parent: FabricNode) => {
    for (let child = node.firstChild; child; child = child.nextSibling) {
      if (textMode && child.kind === "text" && text) {
        if (child === lone || child.textValue === "") continue; // the text of `lone` is the `content` above
        binding.appendChild(parent, buildSpan(child, rootTag, text));
        continue;
      }
      const handle = build(child, rootTag, insideText || isText(node), foreign);
      if (!handle) continue;
      const t0 = profile ? now() : 0;
      binding.appendChild(parent, handle);
      if (profile) stats.appendMs += now() - t0;
    }
  };
  if (!current.node) {
    const t0 = profile ? now() : 0;
    const payload = createPayload(rnProps, config);
    const t1 = profile ? now() : 0;
    current.node = binding.createNode(current.tag, viewName, rootTag, payload, node);
    if (profile) { const t2 = now(); stats.payloadMs += t1 - t0; stats.createMs += t2 - t1; }
    stats.lastCreated++;
    if (scroll) {
      const content = state(contentNode(node), "RCTView");
      content.props = contentProps(attributes);
      content.node = binding.createNode(content.tag, "RCTView", rootTag, createPayload(content.props, viewConfig("RCTView")), contentNode(node));
      stats.lastCreated++;
      childrenHost(content.node);
      binding.appendChild(current.node, content.node);
      current.content = content.node;
    } else childrenHost(current.node);
  } else {
    // The text of a span is one of its props: a change of it alone (the node's children changed, its attributes did not) still has to reach the payload,
    // and so does the lone string turning into mixed content, which takes `content` away.
    const payload = current.propsDirty || lone || current.lone ? diffPayload(current.props, rnProps, config) : null;
    if (scroll && current.content && (current.childrenDirty || current.propsDirty)) {
      // The content container follows the scroll view's own attributes (`contentContainerStyle`, `horizontal`), which
      // `splitProps` keeps out of the scroll view's payload: a change of them alone (a direction switch, a padding) is a
      // clone of the container with its rows kept, and the scroll view takes that clone.
      const content = state(contentNode(node), "RCTView");
      const nextContent = contentProps(attributes);
      const contentPayload = diffPayload(content.props, nextContent, viewConfig("RCTView"));
      if (current.childrenDirty || contentPayload) {
        content.node = current.childrenDirty
          ? contentPayload ? binding.cloneNodeWithNewChildrenAndProps(content.node as FabricNode, contentPayload) : binding.cloneNodeWithNewChildren(content.node as FabricNode)
          : binding.cloneNodeWithNewProps(content.node as FabricNode, contentPayload as Record<string, unknown>);
        content.props = nextContent;
        stats.lastCloned++;
        if (current.childrenDirty) childrenHost(content.node);
        current.node = payload ? binding.cloneNodeWithNewChildrenAndProps(current.node, payload) : binding.cloneNodeWithNewChildren(current.node);
        stats.lastCloned++;
        binding.appendChild(current.node, content.node);
        current.content = content.node;
      } else if (payload) {
        current.node = binding.cloneNodeWithNewProps(current.node, payload);
        stats.lastCloned++;
      }
    } else if (current.childrenDirty) {
      current.node = payload ? binding.cloneNodeWithNewChildrenAndProps(current.node, payload) : binding.cloneNodeWithNewChildren(current.node);
      stats.lastCloned++;
      childrenHost(current.node);
    } else if (payload) {
      current.node = binding.cloneNodeWithNewProps(current.node, payload);
      stats.lastCloned++;
    }
  }
  current.props = rnProps;
  current.lone = lone !== null;
  current.propsDirty = false;
  current.childrenDirty = false;
  callRef(current, node, attributes.ref);
  return current.node;
}

/**
 * React's contract for a callback `ref`: it gets the handle when the element is built; when the attribute changes the old callback hears `null`
 * before the new one gets the handle (and one that is taken away hears `null`); `releaseRefs` gives it `null` when the element is destroyed.
 */
function callRef(current: State, node: NativeNode, ref: unknown): void {
  const previous = current.ref;
  if (ref === previous) return;
  current.ref = ref;
  if (typeof previous === "function") { refCount--; (previous as (handle: null) => void)(null); }
  if (typeof ref === "function") { refCount++; (ref as (handle: HostHandle) => void)(handleFor(current, node)); }
}

/** Nodes with a function `ref` that are alive: while there are none, a removal costs the host nothing. */
let refCount = 0;
/** Nodes taken out of their parent since the last flush ended (`setUnlinkSink`): destroyed unless they were moved. */
const unlinked = new Set<NativeNode>();
function onUnlink(node: NativeNode): void { if (refCount > 0) unlinked.add(node); }

/** `ref(null)` for the node and everything below it, parents first (as React detaches): the subtree is gone. */
function releaseRefs(node: NativeNode): void {
  const own = stateOf(node);
  if (own && typeof own.ref === "function") {
    const ref = own.ref as (handle: null) => void;
    own.ref = undefined;
    refCount--;
    ref(null);
  }
  for (let child = node.firstChild; child; child = child.nextSibling) releaseRefs(child);
}

/** After a flush: the nodes that were unlinked and are not under a live root any more were destroyed (the others were moved). */
function sweepRefs(): void {
  if (unlinked.size === 0) return;
  const candidates = [...unlinked];
  unlinked.clear();
  const live = new Set<NativeNode>();
  for (const root of roots.values()) live.add(root.node);
  for (const node of candidates) {
    let top = node;
    while (top.parent) top = top.parent;
    if (!live.has(top)) releaseRefs(node);
  }
}

/** The scroll content container keeps `collapsable: false`, as React Native's ScrollView does, so Fabric never flattens it into the ScrollView. */
// The content container of a scroll view, as React Native's ScrollView builds it: a row for a horizontal one.
const contentProps = (attributes: Record<string, unknown>): Record<string, unknown> => ({ style: [attributes.horizontal ? { flexDirection: "row" } : null, attributes.contentContainerStyle], collapsable: false });
const contentNodes = new WeakMap<NativeNode, NativeNode>();
/** A stand-in Svelte node for a scroll view's content container, so it can carry Fabric state like any other element. */
function contentNode(scroll: NativeNode): NativeNode {
  let node = contentNodes.get(scroll);
  if (!node) { node = new NativeNode("element", "native-view"); contentNodes.set(scroll, node); }
  return node;
}

function onInvalidate(node: NativeNode, reason: Invalidation): void {
  const current = stateOf(node);
  if (current) {
    if (reason === "children") current.childrenDirty = true;
    else current.propsDirty = true;
  }
  if (reason === "children") childrenInvalidated = true;
  dirty.add(node);
  if (!flushScheduled) { flushScheduled = true; queueMicrotask(flush); }
}

/** Whether a node is still under a mounted surface. */
function isLive(node: NativeNode): boolean {
  let top = node;
  while (top.parent) top = top.parent;
  for (const root of roots.values()) if (root.node === top) return true;
  return false;
}

/** Nodes that left the tree are not reported by the renderer (a move unlinks and relinks), so after a commit that changed children, animated and gesture nodes no longer under a live root are detached. */
function detachRemovedAnimations(): void {
  animation?.sweepAnimations(isLive);
  gestures?.sweepGestures(isLive);
}

/** Commits every pending change in one Fabric transaction per root. */
export function flush(): void {
  flushScheduled = false;
  if (!binding || dirty.size === 0) return;
  const started = performance.now();
  profile = profiling();
  stats.lastCreated = 0; stats.lastCloned = 0; stats.lastCompleted = 0; stats.payloadMs = 0; stats.createMs = 0; stats.appendMs = 0; stats.completeMs = 0;
  for (const node of dirty) {
    const own = stateOf(node);
    if (own && node.kind === "text") own.propsDirty = true;
    for (let parent = node.parent; parent; parent = parent.parent) {
      const ancestor = stateOf(parent);
      if (ancestor) ancestor.childrenDirty = true;
    }
  }
  dirty.clear();
  for (const root of roots.values()) {
    const set = binding.createChildSet(root.rootTag);
    for (let child = root.node.firstChild; child; child = child.nextSibling) {
      const handle = build(child, root.rootTag, false);
      if (handle) binding.appendChildToSet(set, handle);
    }
    const t0 = profile ? now() : 0;
    binding.completeRoot(root.rootTag, set);
    if (profile) stats.completeMs += now() - t0;
    stats.lastCompleted++;
  }
  animation?.commitAnimations();
  gestures?.commitGestures(isLive);
  if (childrenInvalidated) { childrenInvalidated = false; detachRemovedAnimations(); }
  sweepRefs();
  stats.flushes++;
  stats.lastFlushMs = performance.now() - started;
  if (profile) {
    const scope = globalThis as { __svelteFlushLog?: unknown[] };
    scope.__svelteFlushLog ??= [];
    scope.__svelteFlushLog.push({ at: started, ms: stats.lastFlushMs, created: stats.lastCreated, cloned: stats.lastCloned, payloadMs: stats.payloadMs, createMs: stats.createMs, appendMs: stats.appendMs, completeMs: stats.completeMs });
  }
}

const noEvents: ReadonlyMap<string, string> = new Map();
/** Registration names (`topChange` to `onChange`) of the events a view emits; a raw text node has no view config. */
function eventNamesOf(viewName: string): ReadonlyMap<string, string> {
  return viewName === "RCTRawText" ? noEvents : viewConfig(viewName).events;
}

const pressHandlerNames = ["onPress", "onPressIn", "onPressOut", "onLongPress", "onPressChange"];
const pressabilities = new WeakMap<NativeNode, Pressability>();
/** Pressability's responder handlers for a node that carries press handlers; created on first use and disposed when the handlers go away. */
function pressabilityFor(node: NativeNode): ResponderHandlers | undefined {
  const own = stateOf(node);
  let press = pressabilities.get(node);
  if (!own || navigationTags.has(node.name) || !pressHandlerNames.some((name) => own.handlers[name])) {
    if (press) { press.reset(); pressabilities.delete(node); }
    return undefined;
  }
  if (!press) { press = new Pressability({}, (callback) => handleFor(own, node).measure(callback)); pressabilities.set(node, press); }
  const { handlers, props } = own;
  press.configure({
    ...(props as PressabilityConfig),
    onPress: handlers.onPress, onPressIn: handlers.onPressIn, onPressOut: handlers.onPressOut, onLongPress: handlers.onLongPress,
    onPressChange: handlers.onPressChange as unknown as PressabilityConfig["onPressChange"],
  });
  return press.getEventHandlers();
}
/** A user's responder handler. Listener attributes go through `NativeNode.dispatcher`, which drops return values, so the raw function is read from the node. */
function userHandler(node: NativeNode, name: string): ((...args: unknown[]) => unknown) | undefined {
  const raw = node.listeners.get(name.slice(2)) ?? node.listeners.get(`${name[2]?.toLowerCase()}${name.slice(3)}`);
  if (raw) for (const listener of raw) return listener;
  return stateOf(node)?.handlers[name] as never;
}
/** RNGH's TurboModule, for the responder hooks below (the gesture host is loaded when they call it). */
function nativeGestureModule() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return (require("../gestures/native.ts") as typeof import("../gestures/native.ts")).nativeModule();
}
const responder = createResponder<NativeNode>({
  parent: (node) => node.parent,
  handler: userHandler,
  pressability: pressabilityFor,
  // A responder that blocks the native ones (its `onResponderGrant` answered true): react-native-gesture-handler hears of it through React
  // Native's `UIManager.setJSResponder`, which it patches and this host does not have, so the host tells its module. Only once the gesture host
  // is loaded: an app with no gesture never touches the module.
  blockNativeResponder: (node) => {
    const own = stateOf(node);
    if (gestures && own) nativeGestureModule().handleSetJSResponder(own.tag, true);
  },
  releaseNativeResponder: () => {
    if (gestures) nativeGestureModule().handleClearJSResponder();
  },
});

function dispatchEvent(target: unknown, topLevelType: string, nativeEvent: object): void {
  if (target) {
    if (topLevelType.startsWith("topTouch")) responder.touch(target as NativeNode, topLevelType, nativeEvent);
    else if (topLevelType === "topClick" && responder.click(target as NativeNode, nativeEvent)) return;
  }
  for (let node = target as NativeNode | null; node; node = node.parent) {
    const own = stateOf(node);
    const name = (own && eventNamesOf(own.viewName).get(topLevelType)) ?? `on${topLevelType.replace(/^top/, "")}`;
    const handler = own?.handlers[name];
    if (handler) { handler({ nativeEvent }); return; }
    if (own && name === "onChange") {
      // Component-level conveniences React Native's TextInput and Switch provide on top of the native `onChange`.
      const event = nativeEvent as { text?: string; eventCount?: number; value?: boolean };
      if (typeof event.eventCount === "number") own.eventCount = event.eventCount;
      const changeText = own.handlers.onChangeText as unknown as ((text: string) => void) | undefined;
      if (changeText && typeof event.text === "string") { changeText(event.text); return; }
      const valueChange = own.handlers.onValueChange as unknown as ((value: boolean) => void) | undefined;
      if (valueChange && typeof event.value === "boolean") { valueChange(event.value); return; }
    }
    if (!topLevelType.startsWith("topTouch")) return; // only touch events bubble
  }
}

let handlerRegistered = false;
let bootLogged = false;

/** Mounts a Svelte component as the content of a Fabric surface and returns the component's exports. */
export function startSurface<Props extends Record<string, unknown>>(rootTag: number, App: Component<Props>, props: Props): Record<string, unknown> {
  if (!binding) throw new Error("nativeFabricUIManager is not installed; the Fabric host needs the new architecture");
  if (!handlerRegistered) { binding.registerEventHandler(dispatchEvent); handlerRegistered = true; }
  setInvalidationSink(onInvalidate);
  setUnlinkSink(onUnlink);
  if (!engineTried) {
    engineTried = true;
    const engine = requireOptionalNativeModule<{ install: (reanimatedReady: boolean) => boolean; dispatchCommand?: (tag: number, name: string, args: unknown[]) => void }>("SvelteEngine");
    reanimatedAtInstall = typeof (globalThis as { __reanimatedModuleProxy?: unknown }).__reanimatedModuleProxy !== "undefined";
    engineInstalled = engine ? engine.install(reanimatedAtInstall) : false;
    engineModule = engine as typeof engineModule;
    const published = (globalThis as { __svelteFabric?: { engine: boolean } }).__svelteFabric;
    if (published) published.engine = engineInstalled;
  }
  const node = new NativeNode("fragment");
  const instance = mount(App, { target: node, renderer, props }) as Record<string, unknown>;
  roots.set(rootTag, { rootTag, node, instance });
  dirty.add(node);
  flush();
  if (!bootLogged) {
    bootLogged = true;
    mark("first commit");
    console.log(`[Svelte boot] ${bootSummary()}`);
    onFirstCommit(); // the updates store records a successful launch and starts the background check the build asked for
    setTimeout(runBootTasks, 0); // what waits for the first commit (React Native's Keyboard), after what the first screen started
  }
  // React Native's Java mounting never reports content for engine surfaces, so Expo's splash screen would wait forever.
  if (engineInstalled) requireOptionalNativeModule<{ hide: () => void }>("ExpoSplashScreen")?.hide();
  return instance;
}

export function stopSurface(rootTag: number): void {
  const root = roots.get(rootTag);
  if (!root || !binding) return;
  void unmount(root.instance);
  roots.delete(rootTag);
  detachRemovedAnimations();
  sweepRefs();
  releaseRefs(root.node);
  binding.completeRoot(rootTag, binding.createChildSet(rootTag));
}
mark("host");
