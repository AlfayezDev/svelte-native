/**
 * Expo Svelte host for React Native's Fabric renderer, without React.
 *
 * The Svelte custom renderer keeps a mutable node tree; this module mirrors it into Fabric's
 * persistent shadow tree through the `nativeFabricUIManager` JSI binding, the same contract the
 * React reconciler uses: `createNode` for new nodes, `cloneNodeWithNew…` for changed ones,
 * `appendChild` to rebuild a changed node's child list, and one `completeRoot` per flush.
 * Props go through the host's own payload builder and static view configs (`view-configs.ts`: style
 * flattening, colours, transforms), and events arrive through `registerEventHandler` with the Svelte node as target.
 */
import { bootSummary, mark, runBootTasks } from "../boot-marks.ts";
import { loadReanimated, onReanimatedLoaded } from "./reanimated-load.ts";
import { onFirstCommit } from "../updates/launch.ts";
import { resolveAssetSource, Platform, pixelRatio, appearance } from "./deps-rn.ts";
import { styleValue, textColor, type Scheme } from "../system-colors.ts";
import { createPayload, diffPayload, viewConfigFor } from "./view-configs.ts";
import { requireOptionalNativeModule } from "./deps-expo.ts";
import { droppedReasons, freshNavigation } from "../navigation-restore.ts";
import type { Adoption } from "../hmr-state.ts";
import { mount, unmount, untrack, type Component } from "./deps-svelte.ts";
import { inheritedStyle, textStyleOf, type TextStyle } from "./text-inherit.ts";
import { flexKeysOf, isFlexContainer, isHidden, isInlineLevel } from "./html-flow.ts";
// The animation layer (Reanimated + worklets, ≈ 90 ms of bundle evaluation and a second Hermes runtime on a mid-range
// phone) loads on the first node that needs it; a plain first screen boots without it.
type AnimationModule = typeof import("./animation.ts");
let animation: AnimationModule | null = null;
const ANIMATION_ATTRIBUTES = new Set(["animatedStyle", "animatedProps", "entering", "exiting", "layout"]);
// Reanimated's CSS keys: `animationName`, `animationDuration`, ... and `transitionProperty`, ... and the `transition` shorthand (it has no `animation` shorthand yet).
const CSS_ANIMATION_KEY = /^(?:animation[A-Z]|transition(?:[A-Z]|$))/;
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
/** A style whose values are all numbers, strings and booleans: none can be a shared value, and no key is an animation or transition. */
export function plainStyle(style: unknown): boolean {
  if (Array.isArray(style)) { for (let index = 0; index < style.length; index++) if (!plainStyle(style[index])) return false; return true; }
  if (!style || typeof style !== "object") return true;
  for (const key in style as Record<string, unknown>) {
    const value = (style as Record<string, unknown>)[key];
    if (value !== null && (typeof value === "object" || typeof value === "function")) return false;
    const first = key.charCodeAt(0);
    if ((first === 97 || first === 116) && CSS_ANIMATION_KEY.test(key)) return false;
  }
  return true;
}
/**
 * Once the animation layer is loaded: whether a node that has never been through it can need it (`animationProps` returns the attributes
 * as they are for any other node, and building one costs a pass over them): the attributes it reads, a CSS key beside the style or in it,
 * or a style value that could be a shared value.
 */
export function mayAnimate(attributes: Record<string, unknown>): boolean {
  for (const key in attributes) {
    if (ANIMATION_ATTRIBUTES.has(key)) return true;
    const first = key.charCodeAt(0);
    if ((first === 97 || first === 116) && CSS_ANIMATION_KEY.test(key)) return true;
  }
  return !plainStyle(attributes.style);
}
/**
 * How many nodes a commit has to attach to the animation layer for the first time for the engine to be told (`animatedBatch`). Registering a node costs
 * the UI runtime about 0.8 ms on the A16's coldest core (0.6 for the animation the app starts on its shared value, 0.17 for the descriptor and the mapper),
 * the whole commit is one UI-thread message, and a message over about half a frame period (6 ms at 90 Hz) delays the frame behind it: eight nodes is the
 * first commit that can. One animated button, a row's icon or a handful of badges stay below it.
 */
export const BULK_ANIMATED_NODES = 8;
/**
 * Tells the engine, once, that Reanimated is loaded after it: its mounting delegate must sit behind Reanimated's layout-animation proxy, and the engine re-orders itself. Whoever loads Reanimated
 * first causes this (`onReanimatedLoaded`, at install): the host on its first animated node, but also the public `animation` module and the gesture builders, which can come long before it.
 * The proxy attaches to a surface while Reanimated loads and sees nothing of the engine's mutations until the delegate is behind it: a node created in between is not in the proxy's tree, and
 * its next update crashes `mqt_v_js` with a null dereference in `LayoutAnimationsProxy::updateLightNodeProps`. The word has to follow the load within the same turn of JavaScript.
 */
function announceReanimated(): void {
  if (reanimatedAnnounced) return;
  reanimatedAnnounced = true;
  if (!engineInstalled || reanimatedAtInstall) return;
  // Called from the load's own listeners: a throw of the engine's must not fail the `require` that came first (the animation that asked for Reanimated gets it either way).
  try {
    engineModule?.reanimatedLoaded?.();
  } catch (error) {
    console.warn("expo-svelte: the engine could not be told that Reanimated is loaded", error);
  }
}
/** Loads Reanimated (also upgrading the public `animation` module's exports to its own functions) and tells the engine once. */
function ensureReanimated(): void {
  loadReanimated();
  announceReanimated();
}
function loadAnimation(): AnimationModule {
  if (animation) return animation;
  ensureReanimated();
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  animation = require("./animation.ts") as AnimationModule;
  return animation;
}
// Svelte's transitions and `animate:` (`transitions.ts`) are played by the animation layer, and load with it on the first `element.animate`.
type TransitionsModule = typeof import("./transitions.ts");
let transitions: TransitionsModule | null = null;
function loadTransitions(): TransitionsModule {
  if (transitions) return transitions;
  loadAnimation();
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  transitions = require("./transitions.ts") as TransitionsModule;
  return transitions;
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
import { applyAriaProps, isAriaKey } from "./accessibility.ts";
import { foreignText, type ForeignText } from "./foreign-text.ts";
import { assertComponent } from "./foreign-libraries.ts";
import renderer, { InstantAnimation, NativeNode, setAnimationDriver, setInvalidationSink, setRefSink, setTransitionSink, setUnlinkSink, type AnimationDriver, type Invalidation } from "../renderer.ts";
import { applyInlineStyle, effectiveStyle, parseOrigin, transformOps, transformRect, type Rect } from "./dom-style.ts";
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
  /** React Native's synchronous layout read of the committed tree: `[x, y, width, height]` in the window, `undefined` when the surface has no revision. */
  getBoundingClientRect?(node: FabricNode, includeTransform: boolean): readonly number[] | undefined;
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
type Handler = (event: { nativeEvent: object; currentTarget?: unknown; target?: unknown }) => void;
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
  /** The view config `declares` was made for: it is made again only when that changes (a kind defined anew gives a new config), not on every build of the node. */
  declaredFor?: object;
  /** The last build gave the node a lone string as its `content` (`loneText`): when that stops being true the prop has to go, though no attribute changed. */
  lone: boolean;
  /** The node has been through the animation layer, which keeps a record of it: every later build goes through it too, so that it can detach. */
  animated: boolean;
  /** The node is an element the lowering made from HTML (`nativeHtml`): text style inherits through it (`text-inherit.ts`). */
  html?: boolean;
  /** The text style of the node and the marked elements above it, which a marked text or input below takes. */
  textStyle?: TextStyle;
  /** The element was destroyed (`releaseRefs`): what a handle of it is asked after that is not kept for a view that will not come (`handleFor`). */
  dead?: boolean;
  /** A text or input drawn in the default colour (`withInk`): the mode it was drawn in. */
  ink?: Scheme;
  /** A run of the element's text was drawn in the default colour: its children are built again when the mode changes. */
  inkRuns?: boolean;
  /** A marked view: whether its style made it a flex container when its children were last put together (`isFlexContainer`): they are split into items one way or the other, so it changing is a rebuild of them. */
  flex?: boolean;
  /** The text of an implicit run: what it was built from (`buildRun`), so it is built again only when that changes. */
  run?: { items: NativeNode[]; handles: unknown[] };
  /** Its node was made in this flush and is not committed until the flush ends (`completeRoot`): a view that is not on the screen yet, so what a handle is asked until then waits, as for a new element. */
  uncommitted?: boolean;
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
    // A component of an optional library the build does not have says how to turn it on (`libraries` of the plugin options), instead of failing in the native mounting.
    assertComponent(props.component);
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
let engineModule: { reanimatedLoaded?: () => void; animatedBatch?: () => void; holdMounts?: () => void; releaseMounts?: () => void; dispatchCommand?: (tag: number, name: string, args: unknown[]) => void; setNativeProps?: (tag: number, props: Record<string, unknown>) => void; registerForeign?: (name: string) => boolean; saveNavigation?: (json: string) => void; finishing?: () => boolean } | null = null;
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
/** iOS's navigation module (`native/svelte-core/ios/navigation`): keeps the router's state for the next start of the process and gives it back once. Android has the engine module's `saveNavigation` and `initialProps` instead. */
type NavigationHost = { save?: (json: string, update: string | null) => void; restore?: () => unknown; restored?: (outcome: string, reason: string) => void };
let navigationHost: NavigationHost | null | undefined;
/** `SvelteEngine` is Android's: it is looked up once, by `startSurface` and before it by `navigationModule`, which asks nobody else on a phone that has it (a lookup of a module that is not there goes through the lazy registry, on the way to the first commit). */
let engineProbe: object | null | undefined;
function probeEngine(): object | null {
  if (engineProbe === undefined) engineProbe = requireOptionalNativeModule<object>("SvelteEngine");
  return engineProbe;
}
function navigationModule(): NavigationHost | null {
  if (navigationHost === undefined) navigationHost = probeEngine() ? null : requireOptionalNativeModule<NavigationHost>("SvelteNavigation");
  return navigationHost;
}
/** Hands the root router's navigation state to the host, which keeps it for a restart of the process (Android: the Activity's saved instance state; iOS: a file it writes when the app goes to the background). Nothing happens without either module. */
export function saveNavigation(json: string): void { engineModule?.saveNavigation?.(json); navigationModule()?.save?.(json, runningUpdate()); }
/** The id of the OTA update this process runs, lowercase, as `updateId` of the updates module reads it; null for the embedded bundle and for a build without that module. Kept with every saved state: a state of another update is not restored. */
let updateIdOfProcess: string | null | undefined;
function runningUpdate(): string | null {
  if (updateIdOfProcess === undefined) {
    const id = requireOptionalNativeModule<{ updateId?: string | null }>("SvelteUpdates")?.updateId;
    updateIdOfProcess = typeof id === "string" && id !== "" ? id.toLowerCase() : null;
  }
  return updateIdOfProcess;
}
/**
 * The state the previous process left, when the host keeps it in its own way (iOS) and not in `initialProps.navigation` (Android): the JSON of a
 * record that is fresh and that the router can read (`freshNavigation`: the system's say, the build, the attempts, the age), once. A record that is not used is
 * cleared at once, the host being told why; one that is used is cleared by `navigationAdopted` when the surface has started, with what the router did with it.
 * Restoring is best effort: a host that throws leaves the app on its first screen.
 */
export function hostNavigation(): string | undefined {
  try {
    const module = navigationModule();
    if (!module?.restore) return undefined;
    const verdict = freshNavigation(module.restore(), Date.now(), undefined, runningUpdate());
    if ("json" in verdict) return verdict.json;
    if (verdict.dropped === "none") return undefined;
    console.info(`[Svelte navigation] the saved state was not restored: ${verdict.dropped}`);
    module.restored?.("dropped", droppedReasons[verdict.dropped]);
  } catch (error) {
    console.warn("[Svelte navigation] the host could not give the saved state back", error);
  }
  return undefined;
}
/**
 * The surface started with the state `hostNavigation` gave it: the host can forget it (a start that dies before this is counted, and a state that failed twice is
 * dropped) and write down what the root router made of it (`adoption`, which it left in `hmrState()`): `restored` when it took the state, `dropped` with its reason
 * when it refused it (a route that is gone) or when no router asked for it.
 */
export function navigationAdopted(adoption: Adoption | undefined): void {
  const [outcome, reason] = adoption === undefined ? ["dropped", "no router took the saved state"]
    : "restored" in adoption ? ["restored", "the router adopted the saved state"]
    : ["dropped", `the router rejected the saved state: ${adoption.rejected}`];
  if (outcome === "dropped") console.info(`[Svelte navigation] ${reason}`);
  try { navigationModule()?.restored?.(outcome, reason); } catch (error) { console.warn("[Svelte navigation] the host could not forget the saved state", error); }
}
/** Whether the host's window went away because the user left (Back, a swipe from Recents) and not because it is being recreated: Android's `Activity.isFinishing`. */
export function hostFinishing(): boolean { return engineModule?.finishing?.() === true; }
export function fabricStats() { return { ...stats, waiting: waiting.length, engineInstalled, animationLoaded: animation !== null, gesturesLoaded: gestures !== null, gestures: gestures?.stats() ?? null }; }
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
    current = { tag: allocateTag(), viewName, node: null, props: {}, handlers: {}, propsDirty: true, childrenDirty: true, content: null, ref: undefined, eventCount: 0, foreign: false, lone: false, animated: false };
    node.hostState = current;
  }
  return current;
}

const baseStyles = new Map<string, Record<string, unknown> | null>();
const monospace = () => (Platform.OS === "ios" ? "Menlo" : "monospace");
const HEADING_SCALE: Record<string, number> = { h1: 2, h2: 1.5, h3: 1.17, h4: 1, h5: 0.83, h6: 0.67 };
/**
 * What an element looks like until its class or style says otherwise (`nativeBase`, `lower-html.ts`), as a browser's own style sheet has it: an `<hr>` is a hairline across the
 * width of its parent in the grey of a separator, with a margin above and below; `b` is bold, `em` italic, `u` underlined, `code` monospace, `h1` to `h6` bold at their sizes
 * (`fontScale`: a factor of the font size the element inherits, `text-inherit.ts`) and so on. `a` has no default: its color is the app's to give.
 */
function baseStyle(token: string): Record<string, unknown> | null {
  let style = baseStyles.get(token);
  if (style !== undefined) return style;
  switch (token) {
    case "hairline": style = { height: Math.max(pixelRatio().roundToNearestPixel(0.4), 1 / pixelRatio().get()), backgroundColor: "#c7c7cc", marginVertical: 8 }; break;
    case "b": case "strong": style = { fontWeight: "700" }; break;
    case "em": case "i": case "cite": case "dfn": case "var": style = { fontStyle: "italic" }; break;
    case "u": case "ins": style = { textDecorationLine: "underline" }; break;
    case "s": case "del": style = { textDecorationLine: "line-through" }; break;
    case "code": case "kbd": case "samp": case "pre": style = { fontFamily: monospace() }; break;
    case "small": style = { fontScale: 0.8 }; break;
    case "sub": case "sup": style = { fontScale: 0.75 }; break;
    case "mark": style = { backgroundColor: "#ffff00", color: "#000000" }; break;
    default: style = Object.hasOwn(HEADING_SCALE, token) ? { fontWeight: "700", fontScale: HEADING_SCALE[token] } : null;
  }
  baseStyles.set(token, style);
  return style;
}
let spanAnimationWarned = false;
function warnSpanAnimation(): void {
  if (spanAnimationWarned || typeof __DEV__ === "undefined" || !__DEV__) return;
  spanAnimationWarned = true;
  console.warn("[Svelte transitions] a transition or animate: on text inside a text (a span, <b>, <a> in a paragraph) is not drawn: React Native draws it as part of the paragraph. It runs its length, and the node goes when its outro ends. Put it on the element that holds the paragraph.");
}
/** The element's attributes as React Native props (see `mergeHostProps`), with each listener registered on the node as its `on…` handler. */
function nativeProps(node: NativeNode, view = true): Record<string, unknown> {
  const own = node.peekProps();
  const props = mergeHostProps(typeof own.nativeBase === "string" ? { ...own, nativeBase: baseStyle(own.nativeBase) } : own);
  // What Svelte's transitions and `animate:` wrote to `node.style`, and the worklet that draws their animations (`transitions.ts`). A span of a text has no view of its own for the worklet to
  // write to (React Native draws it as part of the paragraph): its animations run their length, and nothing is drawn. When the span becomes a text of its own it gets the worklet then.
  if (node.dom !== null) {
    if (node.dom.inline !== null) applyInlineStyle(props, node.dom.inline);
    if (node.dom.animation !== null) {
      if (view) loadTransitions().injectAnimations(node, props);
      else warnSpanAnimation();
    }
  }
  if (node.listeners.size > 0) for (const type of node.listeners.keys()) props[`on${type[0]?.toUpperCase()}${type.slice(1)}`] = node.dispatcher(type);
  return props;
}

/** What was asked of a handle before its view was on the screen (`measure`, `focus`, ...), of all of them in the order it was asked: done after the flush that puts the view there (`drainQueues`). */
let waiting: { current: State; operation: () => void }[] = [];
/** The states made in the flush that is under way, and given their handle in it (`build`): the handle is asked for things in its `ref` callback, before the commit. */
const uncommitted = new Set<State>();
/** What a handle is: an object of its own kind, not a plain one, so Svelte's `$state` does not wrap it in a proxy when it is bound (`bind:this={els[i]}`): the variable holds the very handle. */
const handlePrototype = Object.create(Object.prototype) as object;

/**
 * `ref` for a Fabric element: the shadow node handle is read at call time, so it is always the latest committed clone. The handle is given when the element is made (`earlyRef`),
 * before there is a view: what is asked of it until then (`focus()` in `onMount`, a measurement) waits, in order, and is done as soon as the view is on the screen.
 */
function handleFor(current: State, node: NativeNode | null = null): HostHandle {
  const later = (operation: () => void): void => {
    if (current.node && !current.uncommitted) operation();
    // The element is gone: no view is coming for it.
    else if (!current.dead) waiting.push({ current, operation });
  };
  const handle = Object.create(handlePrototype) as HostHandle;
  // The tag is the element's now, not the one it had when the handle was made: an element that is made again (`remake`) has another, and the handle it gave out still reaches it.
  Object.defineProperty(handle, "tag", { get: () => current.tag, enumerable: true });
  return Object.assign(handle, {
    position: () => {
      const path: number[] = [];
      for (let at = node; at?.parent; at = at.parent) {
        let index = 0;
        for (let before = at.previousSibling; before; before = before.previousSibling) index++;
        path.push(index);
      }
      return path.reverse();
    },
    measure: (callback: Parameters<HostHandle["measure"]>[0]) => { later(() => { if (current.node) binding?.measure?.(current.node, callback); }); },
    measureInWindow: (callback: Parameters<HostHandle["measureInWindow"]>[0]) => { later(() => { if (current.node) binding?.measureInWindow?.(current.node, callback); }); },
    // Engine views take their commands from the engine; a foreign view's view is React Native's, so its commands go through Fabric.
    dispatchCommand: (name: string, args: unknown[] = []) => {
      later(() => {
        if (!current.foreign && engineInstalled && engineModule?.dispatchCommand) engineModule.dispatchCommand(current.tag, name, args);
        else if (current.node) binding?.dispatchCommand?.(current.node, name, args);
      });
    },
    scrollTo(options?: { x?: number; y?: number; animated?: boolean } | number, deprecatedY?: number, deprecatedAnimated?: boolean) {
      const spec = typeof options === "number" ? { x: options, y: deprecatedY, animated: deprecatedAnimated } : options ?? {};
      this.dispatchCommand("scrollTo", [spec.x ?? 0, spec.y ?? 0, spec.animated !== false]);
    },
    scrollToEnd(options?: { animated?: boolean }) { this.dispatchCommand("scrollToEnd", [options?.animated !== false]); },
    focus() { this.dispatchCommand("focus"); },
    blur() { this.dispatchCommand("blur"); },
    setNativeProps(props: Record<string, unknown>) {
      later(() => {
        if (!current.foreign && engineInstalled && engineModule?.setNativeProps) engineModule.setNativeProps(current.tag, props);
        else if (current.node) binding?.setNativeProps?.(current.node, props);
      });
    },
  });
}

/** What was asked of a handle before its view existed, now that the flush has put the views on the screen, in the order it was asked (of different handles too). What is asked of a view that is not built yet waits for a later flush. */
function drainQueues(): void {
  for (const made of uncommitted) made.uncommitted = false;
  uncommitted.clear();
  const asked = waiting;
  waiting = [];
  for (const entry of asked) {
    if (entry.current.node) entry.operation();
    else if (!entry.current.dead) waiting.push(entry);
  }
}

/**
 * The `source` array and default style React Native's Image.android.js builds for the native image, with its `width` and `height` (the size of an image with no style of its
 * own, under the style) and `alt` (its label, and it makes the image an accessibility element), which an HTML `<img>` writes.
 */
function imageProps(props: Record<string, unknown>): Record<string, unknown> {
  const { width, height, alt, ...rest } = props;
  const resolved = Array.isArray(props.source) ? props.source : [resolveAssetSource(props.source as never) ?? { uri: "" }];
  const first = (resolved[0] ?? {}) as { width?: number; height?: number };
  const next: Record<string, unknown> = { ...rest, source: resolved, style: [resolved.length === 1 && { width: first.width ?? width, height: first.height ?? height }, { overflow: "hidden" }, props.style] };
  if (alt != null) {
    next.accessibilityLabel ??= alt;
    next.accessible = true;
  }
  if (props.onLoadStart || props.onLoad || props.onLoadEnd || props.onError) next.shouldNotifyLoadEvents = true;
  return next;
}

let labelledByWarned = false;
/** The Android engine does not read `accessibilityLabelledBy` (SPEC.md, "Accessibility props": not ported), so `aria-labelledby` gives its element no label there: development says so, once. */
function warnLabelledBy(): void {
  labelledByWarned = true;
  if (typeof __DEV__ !== "undefined" && __DEV__) console.warn("[Svelte accessibility] `aria-labelledby` / `accessibilityLabelledBy` is ignored by the Android engine: the element gets no label from the nodes it names. Give it an `aria-label` (or `accessibilityLabel`).");
}

/** Splits a primitive's attributes into React Native props (functions become `true`, as React does) and event handlers. */
const scrollBaseVertical = { flexGrow: 1, flexShrink: 1, flexDirection: "column", overflow: "scroll" };
const scrollBaseHorizontal = { flexGrow: 1, flexShrink: 1, flexDirection: "row", overflow: "scroll" };

function splitProps(attributes: Record<string, unknown>, into: State, navigation = false): Record<string, unknown> {
  const props: Record<string, unknown> = {};
  const handlers: Record<string, Handler> = {};
  const textInput = isTextInputView(into.viewName);
  let aria = false;
  for (const key in attributes) {
    const value = attributes[key];
    if (key === "ref" || key === "contentContainerStyle") continue;
    if (value === undefined) continue;
    if (typeof value === "function" && key.startsWith("on")) { handlers[key] = value as Handler; props[key] = true; }
    else if (textInput && key === "value") props.text = value; // the native text input prop is `text`, as React Native's TextInput passes it
    else { props[key] = value; if (isAriaKey(key)) aria = true; }
  }
  // `aria-*` is an alias React Native resolves in `View.js`, which a Svelte host has no part of (accessibility.ts); a foreign view's props are its own.
  if (aria && !into.foreign) applyAriaProps(props);
  if (!labelledByWarned && engineInstalled && !into.foreign && props.accessibilityLabelledBy !== undefined) warnLabelledBy();
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
  // React Native's Text sends `ellipsizeMode: "tail"` when the caller gives none, and the native side depends on it: Fabric measures a paragraph with
  // the C++ default, `clip`, while Android's text view draws with its own, `END`. With `numberOfLines` and no mode, a text too long for its lines was
  // measured at its line count and drawn on more, over whatever came below it (the Web APIs screen's SHA-256 line, 14 Nov 2026).
  if (props.ellipsizeMode === undefined && into.viewName === "RCTText") props.ellipsizeMode = "tail";
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

/** The light or dark mode the default text colour follows (`withInk`): read the first time a text needs it, then kept by a listener. */
let inkScheme: Scheme | null = null;
const inkStyles = new Map<Scheme, { color: string }>();

function schemeNow(): Scheme {
  return appearance().getColorScheme() === "dark" ? "dark" : "light";
}

/**
 * The mode, listening for it the first time it is asked. When it changes, every text of every surface that has the default colour is built again: the trees are walked, so a text
 * that is gone is not held, and one parked outside the tree is built again by `build` when it comes back (`State.ink`).
 */
function currentInkScheme(): Scheme {
  if (inkScheme === null) {
    inkScheme = schemeNow();
    appearance().addChangeListener(() => {
      const next = schemeNow();
      if (next === inkScheme) return;
      inkScheme = next;
      for (const root of roots.values()) invalidateInk(root.node);
    });
  }
  return inkScheme;
}

function invalidateInk(top: NativeNode): void {
  const pending = [top];
  for (let node = pending.pop(); node; node = pending.pop()) {
    const own = stateOf(node);
    if (own?.ink !== undefined) onInvalidate(node, "props");
    // The text of a run (`buildRun`) is no child of the element: its children are built again, and the run with them.
    if (own?.inkRuns) onInvalidate(node, "children");
    for (let child = node.firstChild; child; child = child.nextSibling) pending.push(child);
  }
}

/**
 * A text (the paragraph: a span takes its colour from it) or a text input left with no colour by its style, its class and the HTML elements above it is drawn in the system's text
 * colour of the app's light or dark mode (`system-colors.ts`). React Native draws it black in both modes, so it vanished on a dark screen. The colour goes after the text's own style,
 * since it is added only when that style leaves none: `{ color: undefined }` after a colour leaves none too, as React Native flattens a style.
 */
function withInk(node: NativeNode, current: State, props: Record<string, unknown>): void {
  if (styleValue(props.style, "color") != null) {
    current.ink = undefined;
    return;
  }
  const scheme = currentInkScheme();
  let ink = inkStyles.get(scheme);
  if (!ink) {
    ink = { color: textColor(scheme, Platform.OS) };
    inkStyles.set(scheme, ink);
  }
  props.style = props.style === undefined || props.style === null ? ink : [props.style, ink];
  current.ink = scheme;
  if (runTexts.has(node) && node.parent) {
    const owner = stateOf(node.parent);
    if (owner) owner.inkRuns = true;
  }
}

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

/** One `declares` per view config, not one closure per node: the config it answers for is the same for all of them. A kind defined anew (`defineViewKind`) gives its name a new config, and the entry is made again. */
const declaresByView = new Map<string, { config: object; declares: (key: string) => boolean }>();
function declaresOf(viewName: string, config: ReturnType<typeof viewConfig>): (key: string) => boolean {
  let entry = declaresByView.get(viewName);
  if (entry?.config !== config) {
    entry = { config, declares: (key) => Object.hasOwn(config.attributes, key) };
    declaresByView.set(viewName, entry);
  }
  return entry.declares;
}

/** The text style of the nearest marked element above `node` (the ones between it and the node are not marked: React Native's own views let it through). */
function textStyleAbove(node: NativeNode): TextStyle | undefined {
  for (let parent = node.parent; parent; parent = parent.parent) {
    const above = stateOf(parent);
    if (above?.html) return above.textStyle;
  }
  return undefined;
}

/**
 * The marked elements below `node` (an element the lowering made from HTML) rebuild: the text style they inherit changed. Between them and `node` the nodes that were built are
 * rebuilt too, to reach them; a marked element that is rebuilt hands the change on to the ones below it when its own text style changes (`inheritTextStyle`).
 */
function markInheritors(node: NativeNode): boolean {
  let found = false;
  const view = isHtmlView(node);
  for (let child = node.firstChild; child; child = child.nextSibling) {
    // The text of a marked view is drawn in a text of its own (`buildRun`), which takes the text style the view has.
    if (child.kind === "text") {
      if (view && !isBlankText(child)) found = true;
      continue;
    }
    if (child.kind !== "element") continue;
    const own = stateOf(child);
    if (!own) continue;
    if (own.html) {
      own.propsDirty = true;
      found = true;
    } else if (markInheritors(child)) {
      own.childrenDirty = true;
      found = true;
    }
  }
  return found;
}

/** An element the lowering made from HTML: a `nativeHtml` of `true`, or `"inline"` for the text elements that flow in a line (`span`, `b`, an `<a>` among text, ...). */
const isHtml = (node: NativeNode): boolean => {
  const html = node.getProp("nativeHtml");
  return html !== undefined && html !== false;
};
/** A marked element that draws views and, now, the text that is bare in it: it is drawn in a text of its own (`buildRun`). */
const isViewTag = (node: NativeNode): boolean => node.name === "native-view" || node.name === "native-pressable" || node.name === "native-modal";
const isHtmlView = (node: NativeNode): boolean => isViewTag(node) && isHtml(node);
const isBlankText = (node: NativeNode): boolean => /^[ \t\n\r\f]*$/.test(node.textValue);
/** Bare text, or a text element that flows in a line: what a marked view draws in a text of its own. */
const flowsInLine = (node: NativeNode): boolean => node.kind === "text" || (node.kind === "element" && node.getProp("nativeHtml") === "inline");
/** The style an element has from its class, its own style and its default, which is what its `display` is read from: undefined when it has none, which is most of them. */
function ownStyle(node: NativeNode): unknown {
  const own = node.peekProps();
  if (own.style === undefined && own.nativeStyle === undefined && own.nativeClass === undefined) return undefined;
  return mergeHostProps(own).style;
}

let droppedText = false;
/** Development says once that text outside a `Text` is not drawn: the one thing React Native does not tell you, and the one a missing wrapper looks like. */
function warnDropped(text: string): void {
  if (droppedText || !(typeof __DEV__ !== "undefined" && __DEV__) || isBlankText({ textValue: text } as NativeNode)) return;
  droppedText = true;
  console.warn(`[Expo Svelte] text that is not inside a Text is not drawn: ${JSON.stringify(text.length > 40 ? `${text.slice(0, 40)}...` : text)}. Put it in a Text (an HTML element does it for you: a div, a p, a button).`);
}

const layoutWarned = new WeakSet<NativeNode>();
/** Development says once for a text element that the keys of a flex container do nothing on it: a text draws its own text, and its children are not laid out as items (a `div` is the element for that). */
function warnTextLayout(node: NativeNode, style: unknown): void {
  if (layoutWarned.has(node)) return;
  const keys = flexKeysOf(style);
  if (keys.length === 0) return;
  layoutWarned.add(node);
  console.warn(`[Expo Svelte] ${keys.join(", ")} on a text (a p, h1 to h6, span, or a link among text) does nothing: a text does not lay its children out as flex items. Use a div for flex layout.`);
}

/** The text a run of text and inline elements is drawn in, for each run: one node, kept for as long as the run starts with the same node. It has no place in the tree, but its parent is the marked view, which is where it takes its text style from. */
const implicitTexts = new WeakMap<NativeNode, NativeNode>();
/** The stand-ins `implicitText` made: a run's text, which is no child of the element that holds it. */
const runTexts = new WeakSet<NativeNode>();
function implicitText(first: NativeNode, parent: NativeNode): NativeNode {
  let standIn = implicitTexts.get(first);
  if (!standIn) {
    standIn = new NativeNode("element", "native-text");
    standIn.setProp("nativeHtml", true);
    implicitTexts.set(first, standIn);
    runTexts.add(standIn);
  }
  standIn.parent = parent;
  return standIn;
}

/**
 * The text that is bare in a marked view, and the text elements that flow with it, are one line, as in a browser: a native text of their own holds them (the inline elements are its
 * spans), and its first and last strings lose the whitespace at the edge of the line. A run of nothing but blanks is nothing; a run of one element is that element. This is what draws
 * `<button>{@render children()}</button>` with a string in `children`, which the build cannot see.
 */
function buildRun(parent: NativeNode, members: NativeNode[], rootTag: number, foreign: boolean): FabricNode | null {
  let from = 0;
  let to = members.length;
  while (from < to && (members[from] as NativeNode).kind === "text" && isBlankText(members[from] as NativeNode)) from++;
  while (to > from && (members[to - 1] as NativeNode).kind === "text" && isBlankText(members[to - 1] as NativeNode)) to--;
  if (from === to) return null;
  const items = members.slice(from, to);
  const only = items[0] as NativeNode;
  if (items.length === 1 && only.kind === "element") return build(only, rootTag, false, foreign);
  const standIn = implicitText(only, parent);
  const own = state(standIn, "RCTText");
  // Its own props are worked out each time (the text style it inherits may have changed: a few comparisons, and a clone only if something did). Its children are built again only when the run
  // is not what they were made from: other members, or a member that is not the node it was (an element that was made again) or has something to say.
  own.propsDirty = true;
  if (!own.node || own.run === undefined || own.run.items.length !== items.length || items.some((member, index) => member !== own.run?.items[index] || changedSince(member, own.run.handles[index]))) own.childrenDirty = true;
  const handle = build(standIn, rootTag, false, foreign, items, { first: only, last: items[items.length - 1] as NativeNode });
  own.run = { items, handles: items.map((member) => stateOf(member)?.node) };
  return handle;
}

/** Whether a member of a run is not the Fabric node the run's text was built with, or has a change to be built. */
function changedSince(member: NativeNode, handle: unknown): boolean {
  const own = stateOf(member);
  return own === null || own.propsDirty || own.childrenDirty || own.node !== handle;
}

/**
 * An element the lowering made from HTML: its text style (`text-inherit.ts`) is the one of the marked elements above it with its own style over it, a text that is not inside
 * another and an input are drawn with the text style they inherit under their own, and the font-relative values (a unitless `line-height`) are made into dp for the font size
 * the element ends up with. When the text style of the element changes, the marked elements below it are built again.
 */
function inheritTextStyle(node: NativeNode, current: State, attributes: Record<string, unknown>, insideText: boolean): Record<string, unknown> {
  current.html = true;
  // A marked button is disabled for the screen reader too, as React Native's Pressable makes it (the lowering keeps `disabled` as it was written, and so does a spread's).
  if (node.name === "native-pressable" && attributes.disabled !== undefined && attributes["aria-disabled"] === undefined && attributes.accessibilityState === undefined) attributes["aria-disabled"] = Boolean(attributes.disabled);
  const above = textStyleAbove(node);
  const next = textStyleOf(above, attributes.style, current.textStyle);
  const changed = next !== current.textStyle;
  current.textStyle = next;
  if (changed && markInheritors(node)) current.childrenDirty = true;
  attributes.style = inheritedStyle(above, attributes.style, !insideText && (isText(node) || node.name === "native-input"));
  // A single-line input draws its text centred in the field whatever the line height, as on the web. React Native's iOS input lays a line height out above the
  // text instead (a `text-base` input, line-height 24 at 16 px, drew its text 2 pt low), and a field view reused for another input kept it (12 Nov: every
  // sheet input of the QA app after the HTML screen moved down 2 pt). So an HTML input that is not multiline sends no line height, inherited or its own.
  if (node.name === "native-input" && attributes.multiline !== true) attributes.style = withoutLineHeight(attributes.style);
  return attributes;
}

/** [style] (an object, or arrays of them) with no `lineHeight` anywhere: the same value when it has none. */
function withoutLineHeight(style: unknown): unknown {
  if (Array.isArray(style)) {
    let changed = false;
    const items = style.map((item) => {
      const next = withoutLineHeight(item);
      if (next !== item) changed = true;
      return next;
    });
    return changed ? items : style;
  }
  if (style === null || typeof style !== "object" || !("lineHeight" in style)) return style;
  const rest: Record<string, unknown> = { ...(style as Record<string, unknown>) };
  delete rest.lineHeight;
  return rest;
}

/**
 * The element is to be another component than the one its Fabric node is: nothing of the node is kept, and everything it held is built into the new one. The old handle's `ref` hears
 * `null` (and the animation and gesture layers let go of the old tag, which they know the view by) before `build` gives the new one its handle.
 */
function remake(current: State, node: NativeNode): void {
  animation?.detachAnimation(node);
  gestures?.detachGesture(node);
  const previous = current.ref;
  current.ref = undefined;
  if (typeof previous === "function") {
    refCount--;
    (previous as (handle: null) => void)(null);
  }
  current.tag = allocateTag();
  current.node = null;
  current.props = {};
  current.content = null;
  current.lone = false;
  current.declaredFor = undefined;
  current.propsDirty = true;
  current.childrenDirty = true;
}

/** Builds (or rebuilds) the Fabric node for a Svelte element and returns the handle to append into its parent. */
function build(node: NativeNode, rootTag: number, insideText: boolean, insideForeign = false, only?: readonly NativeNode[], edges?: { first: NativeNode; last: NativeNode }): FabricNode | null {
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
    let text = node.textValue;
    if (!insideText) { // bare text outside a Text is not renderable, as in React Native (a marked view draws it in a text of its own: `buildRun`)
      warnDropped(text);
      return null;
    }
    // The first and last string of a line lose the whitespace at its edges.
    if (edges && node === edges.first) text = text.replace(/^[ \t\n\r\f]+/, "");
    if (edges && node === edges.last) text = text.replace(/[ \t\n\r\f]+$/, "");
    const current = state(node, "RCTRawText");
    // The props object is the payload, and it is made only when there is a node to make (a text that is built again with the same string is the same node).
    if (!current.node) {
      const props = { text };
      const t0 = profile ? now() : 0;
      current.node = binding.createNode(current.tag, "RCTRawText", rootTag, props, node);
      if (profile) stats.createMs += now() - t0;
      stats.lastCreated++;
      current.props = props;
    } else if (current.props.text !== text) {
      const props = { text };
      current.node = binding.cloneNodeWithNewProps(current.node, props);
      stats.lastCloned++;
      current.props = props;
    }
    current.propsDirty = false;
    current.childrenDirty = false;
    return current.node;
  }
  let attributes = nativeProps(node, !(insideText && isText(node)));
  const entry = viewNames[node.name];
  if (!entry) throw new Error(`Expo Svelte (Fabric) has no mapping for ${node.name}`);
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
  // A Fabric node cannot become another component: an element whose view name changed (a text that is a span of the text it is in, and a text of its own when the run that held it is gone; a
  // text input that turns multiline) is made again, as React does for a component of another type.
  if (current.node && current.viewName !== viewName) remake(current, node);
  // Its node is made in this build, and not committed until the flush ends: the `ref` it is given below may ask its handle for things, which wait for the view.
  const fresh = !current.node;
  current.viewName = viewName;
  current.foreign = foreign;
  if (current.ink !== undefined && current.ink !== inkScheme) current.propsDirty = true;
  const html = isHtml(node);
  if (html || current.html) attributes = inheritTextStyle(node, current, attributes, insideText);
  if (html && typeof __DEV__ !== "undefined" && __DEV__ && isText(node)) warnTextLayout(node, attributes.style);
  const config = viewConfig(viewName);
  if (current.declaredFor !== config) {
    current.declaredFor = config;
    current.declares = declaresOf(viewName, config);
  }
  // `animatedStyle`, `animatedProps` and the CSS keys never reach the payload. The animation layer is loaded by the first node that wants it; from then on a node
  // goes through it when it can need it (`mayAnimate`) or has been through it before (`current.animated`: the layer keeps a record of the node, and detaches it only here).
  let animated = attributes;
  if (animation ? current.animated || mayAnimate(attributes) : wantsAnimation(attributes)) {
    current.animated = true;
    animated = loadAnimation().animationProps(node, current, attributes);
  }
  // `gesture` never reaches the payload either; the gesture host forces `collapsable: false` so the view keeps its tag.
  const gestured = gestures || attributes.gesture !== undefined ? loadGestures().gestureProps(node, current, animated) : animated;
  const rnProps = splitProps(node.name === "native-image" ? imageProps(gestured) : navigationTags.has(node.name) ? navigationProps(node.name, gestured) : gestured, current, navigationTags.has(node.name));
  if (viewName === "RCTText" || isTextInputView(viewName)) withInk(node, current, rnProps);
  const scroll = viewName === "RCTScrollView";
  const view = only === undefined && html && isViewTag(node);
  // A flex container's children are items: each element is one, and each run of text is an anonymous one. Which it is, is read from the style (`html-flow.ts`), and a change of it is a change of the children.
  const flex = view && isFlexContainer(attributes.style);
  if (view) {
    if (current.node && current.flex !== flex) current.childrenDirty = true;
    current.flex = flex;
  }
  const childrenHost = (parent: FabricNode) => {
    // Not a marked view and not a run: each child is built in place, with no line to gather (a list of 300 rows of host tags pays nothing for HTML elements).
    if (!view && only === undefined) {
      for (let child = node.firstChild; child; child = child.nextSibling) {
        if (textMode && child.kind === "text" && text) {
          if (child === lone || child.textValue === "") continue; // the text of `lone` is the `content` above
          binding.appendChild(parent, buildSpan(child, rootTag, text));
          continue;
        }
        const handle = build(child, rootTag, isText(node), foreign, undefined, edges);
        if (!handle) continue;
        const t0 = profile ? now() : 0;
        binding.appendChild(parent, handle);
        if (profile) stats.appendMs += now() - t0;
      }
      return;
    }
    // The children are the nodes of a run, for the text built for one, and otherwise what is linked in the node.
    let run: NativeNode[] = [];
    const append = (handle: FabricNode | null) => {
      if (!handle) return;
      const t0 = profile ? now() : 0;
      binding.appendChild(parent, handle);
      if (profile) stats.appendMs += now() - t0;
    };
    const endRun = () => {
      if (run.length === 0) return;
      const members = run;
      run = [];
      append(buildRun(node, members, rootTag, foreign));
    };
    const visit = (child: NativeNode) => {
      if (textMode && child.kind === "text" && text) {
        if (child === lone || child.textValue === "") return; // the text of `lone` is the `content` above
        binding.appendChild(parent, buildSpan(child, rootTag, text));
        return;
      }
      if (view) {
        if (child.kind === "comment" || child.kind === "fragment") return;
        // Text is a line with the inline elements, which only a block container makes of them: a flex container's items are its elements, and what is between them is an item of its own. An
        // element that sets its own `display` (`class="block"`) is not in a line either.
        const inLine = !flex && child.kind === "element" && flowsInLine(child);
        const style = inLine ? ownStyle(child) : undefined;
        if (child.kind === "text" || (inLine && isInlineLevel(style))) {
          run.push(child);
          return;
        }
        // An element with `display: none` has no box: it is built as an item of its own (a hidden text cannot be a span: a span takes no `display`), and the line goes on around it.
        if (inLine && isHidden(style)) {
          append(build(child, rootTag, false, foreign, undefined, edges));
          return;
        }
        endRun();
      }
      // A view in a text is not inside it, as in React Native: what it holds is built as a text of its own.
      append(build(child, rootTag, isText(node), foreign, undefined, edges));
    };
    if (only) for (const child of only) visit(child);
    else for (let child = node.firstChild; child; child = child.nextSibling) visit(child);
    endRun();
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
  if (fresh && typeof attributes.ref === "function" && attributes.ref !== current.ref) {
    current.uncommitted = true;
    uncommitted.add(current);
  }
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

/**
 * The `ref` of an element is called when the renderer sets it, while Svelte is building the element, and not when the host builds the view a microtask later: `onMount` and the
 * effects of the same flush find the handle (`el.focus()` in an `{#if}`). What is asked of the handle before the view exists waits for it (`handleFor`). The callback runs untracked:
 * it writes state (`bind:this`), which Svelte forbids from a block's own effect and allows from an untracked call.
 */
function earlyRef(node: NativeNode): void {
  const own = node.peekProps();
  let ref = own.ref;
  if (typeof ref !== "function") {
    const legacy = own.nativeProps;
    ref = legacy !== null && typeof legacy === "object" ? (legacy as { ref?: unknown }).ref : undefined;
  }
  if (typeof ref !== "function") return;
  const entry = viewNames[node.name];
  let viewName: string;
  try {
    viewName = typeof entry === "function" ? entry({}) : entry ?? node.name;
  } catch {
    return; // a node whose view cannot be told yet (`native-foreign` needs its component): it is built, and its ref called, with the rest
  }
  const current = state(node, viewName);
  untrack(() => callRef(current, node, ref));
}

/** Nodes with a function `ref` that are alive: while there are none, a removal costs the host nothing. */
let refCount = 0;
/** Nodes taken out of their parent since the last flush ended (`setUnlinkSink`): destroyed unless they were moved. */
const unlinked = new Set<NativeNode>();
function onUnlink(node: NativeNode): void { if (refCount > 0) unlinked.add(node); }

/** `ref(null)` for the node and everything below it, parents first (as React detaches): the subtree is gone. */
function releaseRefs(node: NativeNode): void {
  const own = stateOf(node);
  if (own) {
    // What a handle was asked before its view was built is not done for a view that will never be: it would wait for good, once for each element that came and went in one flush.
    own.dead = true;
    if (waiting.length > 0) waiting = waiting.filter((entry) => entry.current !== own);
    if (typeof own.ref === "function") {
      const ref = own.ref as (handle: null) => void;
      own.ref = undefined;
      refCount--;
      ref(null);
    }
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
  } else if (!node.surfaceRoot) {
    // Not built yet. Under a parent that is not built either (a subtree Svelte is still putting together) there is nothing to mark: the
    // change that attaches the subtree is reported on the parent it is attached to. Under a built parent it may matter (the lone string
    // of a span is read by its parent without being a node of its own), and a surface's root has no state of its own and must be heard.
    const parent = node.parent;
    if (parent === null || stateOf(parent) === null) return;
  }
  if (reason === "children") childrenInvalidated = true;
  if (reason !== "animation") layoutPending = true;
  dirty.add(node);
  if (reason === "animation") {
    // An animation starts the next one in a microtask of its own (Svelte's `animate:` plays a hold of no length, and its `onfinish` starts the move), and each item of a list does it in
    // its turn. A commit that came after the first of them would carry the first item's first frame and leave the others, in their new places and untransformed, to the next commit,
    // and a frame between the two shows it. So the commit waits until a few microtasks pass with no animation started.
    animationHops = ANIMATION_HOPS;
    if (!animationWaiting) { animationWaiting = true; flushScheduled = true; queueMicrotask(waitForAnimations); }
    return;
  }
  if (!flushScheduled) { flushScheduled = true; queueMicrotask(flushAfterSvelte); }
}
/**
 * Whether a node has been given a transition since the last commit (the renderer says so, `setTransitionSink`). Svelte 5.59 starts a transition in a microtask of its own (`element.animate` is no longer
 * called while the element's effect runs), queued after the first change of the element it is on, so a commit made by the first microtask would carry the element without the first frame of its
 * transition, and a frame drawn between that commit and the next one shows the element whole. A commit that has such a node takes one more hop, which lets Svelte's microtask run first (the animation it
 * starts holds the commit for its own hops: `waitForAnimations`).
 */
let transitionBound = false;
const onTransition = (): void => { transitionBound = true; };
function flushAfterSvelte(): void {
  if (transitionBound) {
    transitionBound = false;
    queueMicrotask(flush);
  } else flush();
}
const ANIMATION_HOPS = 3;
let animationHops = 0;
let animationWaiting = false;
function waitForAnimations(): void {
  if (--animationHops > 0) { queueMicrotask(waitForAnimations); return; }
  animationWaiting = false;
  flush();
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

/** A commit is being built: a layout read (`layoutOf`) made from inside it (a `ref` callback) reads the tree as it was, and does not start another. */
let flushing = false;
/** Whether a pending change can move layout: anything but an `animation` invalidation. A layout read commits first only then. */
let layoutPending = false;
/** Commits every pending change in one Fabric transaction per root. */
export function flush(): void {
  if (flushing) return;
  flushScheduled = false;
  if (!binding || dirty.size === 0) return;
  layoutPending = false;
  flushing = true;
  try {
    commit();
  } finally {
    flushing = false;
    affines = null;
  }
  if (mountsHeld && ++heldCommits >= 2) releaseMounts();
}

function commit(): void {
  if (!binding) return;
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
  if (waiting.length > 0 || uncommitted.size > 0) drainQueues();
  // Tens of animated nodes attached at once are one long message on the UI thread and a cold RenderThread: the engine puts both on the big cores.
  if ((animation?.commitAnimations() ?? 0) >= BULK_ANIMATED_NODES && engineInstalled) engineModule?.animatedBatch?.();
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
/**
 * The press region of a node. A Text nested in a Text has no frame of its own: Fabric answers `measure` for it with no numbers (its words are laid out in the
 * paragraph, and the Android engine draws them there), which Pressability reads as "no region" and so never sees the finger leave. Its region is the paragraph's
 * (the nearest Text that is not nested), widened by the retention offset as any other: a press that starts on a span is cancelled when the finger goes that far
 * from the paragraph.
 */
function measurePressRegion(own: State, node: NativeNode, callback: Parameters<HostHandle["measure"]>[0]): void {
  let host = node;
  let hosted = own;
  while (hosted.viewName === "RCTVirtualText" && host.parent) {
    const next = stateOf(host.parent);
    if (!next) break;
    host = host.parent;
    hosted = next;
  }
  handleFor(hosted, host).measure(callback);
}
const pressabilities = new WeakMap<NativeNode, Pressability>();
/** Pressability's responder handlers for a node that carries press handlers; created on first use and disposed when the handlers go away. */
function pressabilityFor(node: NativeNode): ResponderHandlers | undefined {
  const own = stateOf(node);
  let press = pressabilities.get(node);
  if (!own || navigationTags.has(node.name) || !pressHandlerNames.some((name) => own.handlers[name])) {
    if (press) { press.reset(); pressabilities.delete(node); }
    return undefined;
  }
  if (!press) { press = new Pressability({}, (callback) => measurePressRegion(own, node, callback)); pressabilities.set(node, press); }
  const { handlers, props } = own;
  // React Native's `Pressable` takes `pressRetentionOffset` and hands Pressability `pressRectOffset`; the host reads the props itself, so it maps the name.
  const { pressRectOffset, pressRetentionOffset } = props as PressabilityConfig & { pressRetentionOffset?: PressabilityConfig["pressRectOffset"] };
  press.configure({
    ...(props as PressabilityConfig),
    pressRectOffset: pressRectOffset ?? pressRetentionOffset,
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
const responder = createResponder<NativeNode>({
  parent: (node) => node.parent,
  handler: userHandler,
  pressability: pressabilityFor,
  // `blockNativeResponder` and `releaseNativeResponder` are not wired: RNGH 2 heard of a responder that blocks the native ones (its `onResponderGrant`
  // answered true) through React Native's `UIManager.setJSResponder`, which it patched into `handleSetJSResponder` of its module. RNGH 3 has no such
  // call (its module lost both, and its recognisers are cancelled by a handler's `cancelsJSResponder`, which the other direction needs no call for), so
  // a responder that answers true no longer holds RNGH's handlers back.
  // A node that was removed from the tree while it held the gesture (a link whose paragraph re-rendered without it, a screen that was popped) is no responder any more.
  mounted: isLive,
  abandon: (node) => {
    const press = pressabilities.get(node);
    if (press) { press.reset(); pressabilities.delete(node); }
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
    // An element lowered from HTML gets the element the handler is on and the one the event came from, as a web event has (a lowered `<form>` finds the input an Enter came from by them: `hostSubmit`).
    if (handler) handler(own?.html ? { nativeEvent, currentTarget: node, target } : { nativeEvent });
    if (own && name === "onChange") {
      // Component-level conveniences React Native's TextInput and Switch provide on top of the native `onChange`, after it, as there: a raw
      // `onChange` does not take them away (the bound value, `onChangeText`, `onValueChange`), and the edit's count is the one the next text is sent with.
      const event = nativeEvent as { text?: string; eventCount?: number; value?: boolean };
      if (typeof event.eventCount === "number") own.eventCount = event.eventCount;
      const changeText = own.handlers.onChangeText as unknown as ((text: string) => void) | undefined;
      if (changeText && typeof event.text === "string") { changeText(event.text); return; }
      const valueChange = own.handlers.onValueChange as unknown as ((value: boolean) => void) | undefined;
      if (valueChange && typeof event.value === "boolean") { valueChange(event.value); return; }
    }
    if (handler) return;
    if (!topLevelType.startsWith("topTouch")) return; // only touch events bubble
  }
}

/**
 * `loadTransitions`, or null when Reanimated (or the animation layer) does not load: an app without it still ends its transitions, at once. The layer is also tried at the first layout read
 * (`layoutOf`), which cannot tell Svelte's measure for an `animate:` from a caller's own: that one fails silently, and the warning (once) is for the first animation that cannot be played.
 */
let transitionsFailure: unknown;
let transitionsFailed = false;
let transitionsWarned = false;
function ensureTransitions(announce: boolean): TransitionsModule | null {
  if (transitions) return transitions;
  if (!transitionsFailed) {
    try {
      const module = loadTransitions();
      module.warmUp();
      return module;
    } catch (error) {
      transitionsFailed = true;
      transitionsFailure = error;
    }
  }
  if (announce && !transitionsWarned) {
    transitionsWarned = true;
    console.warn("[Svelte transitions] react-native-reanimated did not load, so transitions and animate: end at once instead of playing", transitionsFailure);
  }
  return null;
}

/** One read of React Native's layout of the committed tree for a node's shadow node: `[x, y, width, height]` in the window. */
function readBox(current: State, includeTransform: boolean): Rect | null {
  const box = current.node ? binding?.getBoundingClientRect?.(current.node, includeTransform) : undefined;
  return box ? { x: box[0] as number, y: box[1] as number, width: box[2] as number, height: box[3] as number } : null;
}

/** What is pending is committed before a layout is read (Svelte reads one right after it changed the tree), unless it only paints: `animate:` reads every item's box after it started the items before it, and committing each would mount the list a few items at a time. */
function commitBeforeRead(): void {
  if (layoutPending) flush();
}

/**
 * A layout read is the first sign of an `animate:` or a transition that measures: Svelte reads where the items are before it changes the tree and where they are after, and then
 * starts the animations that draw the move. That is two commits, the new tree (which the host commits in the microtask after the change, or before the read that needs it) and the
 * animations' first frames. The Android engine applies each commit in a message of its own, and a frame drawn between the two shows the new tree untransformed (a flip's items in their
 * new places, a slide's element whole), so the engine is asked, at the first read, to hold what is committed and to apply it together (`holdMounts`; the engine's SPEC.md, "Transaction
 * order"). The hold ends with the second commit, or after a few dozen microtasks when no second commit comes (a read that no animation follows), or by itself after 100 ms. (Not
 * `setImmediate`: here it runs before the microtasks that follow the read, and would end the hold before the first commit.)
 */
let mountsHeld = false;
let heldCommits = 0;
let heldHops = 0;
/** Microtask hops a hold waits for the second commit: all of Svelte's work after a read (the commit of the change, the animations that start one another, the wait for them) is well inside. */
const HOLD_HOPS = 24;
function holdMounts(): void {
  if (mountsHeld || !engineInstalled || !engineModule?.holdMounts) return;
  mountsHeld = true;
  heldCommits = 0;
  heldHops = HOLD_HOPS;
  engineModule.holdMounts();
  queueMicrotask(heldHop);
}
function heldHop(): void {
  if (!mountsHeld) return;
  if (--heldHops > 0) queueMicrotask(heldHop);
  else releaseMounts();
}
function releaseMounts(): void {
  if (!mountsHeld) return;
  mountsHeld = false;
  engineModule?.releaseMounts?.();
}

/**
 * A node's own size, before any transform (`clientWidth`, `clientHeight`, the `width` a transition reads), from the committed tree. Null for a node that has no view yet.
 */
function sizeOf(node: NativeNode): { width: number; height: number } | null {
  if (!binding?.getBoundingClientRect) return null;
  holdMounts();
  commitBeforeRead();
  const current = stateOf(node);
  const box = current ? readBox(current, false) : null;
  return box ? { width: box.width, height: box.height } : null;
}

/** What the transforms of an ancestor (and of everything above it, and a scroll offset) do to a point inside it: `x' = sx * x + tx`, `y' = sy * y + ty`; exact for translations and scales. */
type Affine = { sx: number; sy: number; tx: number; ty: number };
const IDENTITY: Affine = { sx: 1, sy: 1, tx: 0, ty: 0 };
/** The ancestors read in this JS task, by the host state they were read for: a list of items under one parent asks the same two questions of it once each, not once per item. A commit empties it. */
let affines: Map<State, Affine> | null = null;

/**
 * What the transforms of the node's ancestors do to what is inside them: the nearest ancestor that has a view is read with and without its transforms, and React Native applies the flag to
 * the whole chain up to the root (scroll offsets are among them), so the two boxes give the map that takes the layout box of a child to where it is drawn. A translation and a scale are exact;
 * a rotation is not (the map is read off an axis-aligned box). A scroll view's own box is not moved by its scroll offset, only what is inside it, so for a direct child of one the read is made through
 * its content container.
 */
function ancestorMap(node: NativeNode): Affine {
  for (let up = node.parent; up; up = up.parent) {
    let view = stateOf(up);
    if (!view?.node) continue;
    if (view.viewName === "RCTScrollView") {
      const content = stateOf(contentNode(up));
      if (content?.node) view = content;
    }
    if (affines === null) {
      affines = new Map();
      queueMicrotask(() => { affines = null; });
    }
    let map = affines.get(view);
    if (map === undefined) {
      const moved = readBox(view, true);
      const laid = readBox(view, false);
      const sx = moved && laid && laid.width > 0 ? moved.width / laid.width : 1;
      const sy = moved && laid && laid.height > 0 ? moved.height / laid.height : 1;
      map = moved && laid ? { sx, sy, tx: moved.x - sx * laid.x, ty: moved.y - sy * laid.y } : IDENTITY;
      affines.set(view, map);
    }
    return map;
  }
  return IDENTITY;
}

/**
 * A node's box as `getBoundingClientRect` reports it, from React Native's synchronous layout read of the committed tree: its layout box moved by what its ancestors' transforms do
 * (`ancestorMap`), then by its own transform about its origin. The own transform is the one an animation of the node draws now when one does (the UI thread draws it, the committed
 * tree does not have it), and the one its style gives it otherwise. A rotation is not applied. Null for a node that has no view yet.
 */
function layoutOf(node: NativeNode): Rect | null {
  if (!binding?.getBoundingClientRect) return null;
  // The first `animate:` of an app loads Reanimated here, before the tree changes, and not when the first animation starts: that would show the changed tree, untransformed, while it loads.
  const module = ensureTransitions(false);
  holdMounts(); // after the load, which takes longer than the engine waits for a hold to end
  commitBeforeRead();
  const current = stateOf(node);
  const laid = current ? readBox(current, false) : null;
  if (!laid) return null;
  const map = ancestorMap(node);
  const base = { x: map.sx * laid.x + map.tx, y: map.sy * laid.y + map.ty, width: map.sx * laid.width, height: map.sy * laid.height };
  const drawn = node.dom?.animation ? module?.drawnTransform(node) ?? null : null;
  const style = effectiveStyle(node.peekProps(), node.dom?.inline ?? null);
  const ops = drawn?.ops ?? transformOps(style.transform);
  return ops.length === 0 ? base : transformRect(base, ops, parseOrigin(drawn?.origin ?? style.transformOrigin, base));
}

/**
 * The shadow node of a node's view, made again under the same tag and attached to no tree: what Reanimated needs to forget the tag (`forgetAnimatedValues`). Its props must stay `{}`: a prop
 * that makes it a node of its own kind (a form control's, `FormsView`) makes React Native delete the live view of that tag when the ghost is collected (`FabricMountingManager`).
 * A node that has animated values of its own is left alone: forgetting the tag takes those away too (`ownsAnimatedValues`).
 */
function forgetAnimated(node: NativeNode): void {
  const current = stateOf(node);
  if (!binding || !current?.node || current.foreign || !animation || current.viewName === "RCTVirtualText") return; // a span of a text has no view, and no registry entry
  if (animation.ownsAnimatedValues(node, mergeHostProps(node.peekProps()))) return;
  let top = node;
  while (top.parent) top = top.parent;
  for (const root of roots.values()) {
    if (root.node !== top) continue;
    animation.forgetAnimatedValues(binding.createNode(current.tag, "RCTView", root.rootTag, {}, node));
    return;
  }
}

const animationDriver: AnimationDriver = {
  animate: (node, keyframes, options) => ensureTransitions(true)?.animate(node, keyframes, options) ?? new InstantAnimation(),
  getAnimations: (node) => transitions?.getAnimations(node) ?? [],
  layout: layoutOf,
  size: sizeOf,
  forget: forgetAnimated,
};

let handlerRegistered = false;
let bootLogged = false;

/** Mounts a Svelte component as the content of a Fabric surface and returns the component's exports. */
export function startSurface<Props extends Record<string, unknown>>(rootTag: number, App: Component<Props>, props: Props): Record<string, unknown> {
  if (!binding) throw new Error("nativeFabricUIManager is not installed; the Fabric host needs the new architecture");
  if (!handlerRegistered) { binding.registerEventHandler(dispatchEvent); handlerRegistered = true; }
  setInvalidationSink(onInvalidate);
  setTransitionSink(onTransition);
  setUnlinkSink(onUnlink);
  setAnimationDriver(animationDriver);
  setRefSink(earlyRef);
  if (!engineTried) {
    engineTried = true;
    const engine = probeEngine() as { install: (reanimatedReady: boolean) => boolean; dispatchCommand?: (tag: number, name: string, args: unknown[]) => void } | null;
    reanimatedAtInstall = typeof (globalThis as { __reanimatedModuleProxy?: unknown }).__reanimatedModuleProxy !== "undefined";
    engineInstalled = engine ? engine.install(reanimatedAtInstall) : false;
    engineModule = engine as typeof engineModule;
    // Now, when Reanimated is already loaded (a load that came before the engine did); at the load otherwise, whoever makes it.
    onReanimatedLoaded(announceReanimated);
    const published = (globalThis as { __svelteFabric?: { engine: boolean } }).__svelteFabric;
    if (published) published.engine = engineInstalled;
  }
  const node = new NativeNode("fragment");
  node.surfaceRoot = true;
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
