import { createRenderer } from "svelte/renderer";
import { classStyle } from "./classes.ts";
import { computedStyleOf, domRect, inlineProperties, type ComputedStyle, type Rect, type Size } from "./fabric/dom-style.ts";
import type { AnimationOptions, Keyframe } from "./fabric/keyframes.ts";

export type { AnimationOptions, Keyframe } from "./fabric/keyframes.ts";

type Listener = (...args: unknown[]) => void;
export type Snapshot = {
  props: Readonly<Record<string, unknown>>;
  children: readonly NativeNode[];
  text: string;
};

let nextId = 0;
const noListeners = new Map<string, Set<Listener>>();
/** What a node has until its first attribute or child: shared, read-only (the first write copies, see `propsShared`), so a text, a comment or a bare fragment allocates neither. */
const noProps: Readonly<Record<string, unknown>> = Object.freeze({});
const noChildren: readonly NativeNode[] = Object.freeze([]);

/**
 * A function that has to cross Svelte's attribute spread. `set_attributes` (an element with `{...spread}` sends every one of its
 * attributes through it) skips a function value unless the key starts with `on`, so a spread's `ref`, and any other function the host
 * reads as a plain attribute, never reached `setAttribute`. The lowering (`lower.ts`) wraps the spreads, and the attributes next to
 * them, in `hostSpread` and `hostValue`, which hand Svelte this object instead; `setAttribute` unwraps it.
 */
class FunctionBox {
  constructor(readonly fn: (...args: never[]) => unknown) {}
}
const boxes = new WeakMap<object, FunctionBox>();
function boxOf(fn: (...args: never[]) => unknown): FunctionBox {
  let box = boxes.get(fn);
  if (!box) {
    box = new FunctionBox(fn);
    boxes.set(fn, box);
  }
  return box;
}
/** Keys Svelte handles itself: any `on...` key is an event listener, `$$...` are internals, `children` is a snippet the host never reads as an attribute. */
const handledBySvelte = (key: string): boolean => key.startsWith("on") || key.startsWith("$$") || key === "children";

/** An attribute value on an element that also has a spread: a function is boxed, anything else passes. The same function always gives the same box, so an unchanged ref is not set again. */
export function hostValue<T>(value: T): T {
  return (typeof value === "function" ? boxOf(value as never) : value) as T;
}

/**
 * `class` on a lowered tag: `lower.ts` writes `nativeClass={hostClass(...)}` for `class` and `class:name` on `<View>`, `<Text>`, ..., because
 * Svelte would join a `class` attribute into a string the host drops. The style is worked out here, in the element's template effect, so
 * what the class resolver reads (the color scheme, the window) is tracked there, as for a component (`createNativeProps`); the host puts it under
 * the element's own style (`mergeHostProps`). `style` is that style, which `lower.ts` passes when the tag has one: the font size it sets is what a font-relative
 * line height is made from.
 */
export function hostClass(value: unknown, style?: unknown): unknown {
  return classStyle(value, style);
}

/**
 * What `{...props}` sends to Svelte: a copy in which every function Svelte would drop is boxed, and a `class` is its style (`hostClass`),
 * with the toggles of the element's `class:name` directives (`lower.ts`).
 */
export function hostSpread<T extends object>(props: T, toggles?: Record<string, unknown>): T {
  const copy = { ...props } as Record<string, unknown>;
  if ("class" in copy) {
    const fromClass = classStyle(toggles === undefined ? copy.class : [copy.class, toggles], copy.style);
    delete copy.class;
    if (fromClass !== undefined) copy.nativeClass = fromClass;
  }
  for (const key in copy) {
    const value = copy[key];
    if (typeof value === "function" && !handledBySvelte(key)) copy[key] = boxOf(value as never);
  }
  return copy as T;
}

/**
 * Why a node must be committed again. `animation`: what the node's transitions draw changed (`fabric/transitions.ts`), and only in paint (opacity, transforms,
 * colours), so the layout of the committed tree is still right: a layout read (`getBoundingClientRect`) does not commit it first.
 */
export type Invalidation = "props" | "children" | "text" | "animation";
let invalidationSink: ((node: NativeNode, reason: Invalidation) => void) | null = null;
/** The host (see `fabric/`) hears every change through this sink. */
export function setInvalidationSink(sink: ((node: NativeNode, reason: Invalidation) => void) | null): void { invalidationSink = sink; }

/**
 * The members of a Web Animations `Animation` that Svelte's transitions and `animate:` use: they set `onfinish` and `effect`, read `playState` and `currentTime`, and call `cancel()`.
 * What plays one is the host (`fabric/transitions.ts`).
 */
export interface NativeAnimation {
  /** Called once, on the JS thread, when the animation has run its length. Never after `cancel()`. */
  onfinish: ((event?: unknown) => void) | null;
  /** Svelte sets it to null after `cancel()` (to let Chromium free the effect); nothing reads it. */
  effect: unknown;
  readonly playState: "idle" | "running" | "finished";
  /** Milliseconds since the animation started, including its delay; the length once it has finished; null once cancelled. */
  readonly currentTime: number | null;
  /** Stops it, takes its effect off the node (the node goes back to its own style) and never calls `onfinish`. */
  cancel(): void;
}

/** What the host plays a node's animations with, and measures a node by. Installed by `startSurface`. */
export interface AnimationDriver {
  animate(node: NativeNode, keyframes: readonly Keyframe[], options: AnimationOptions): NativeAnimation;
  getAnimations(node: NativeNode): NativeAnimation[];
  /** The node's box in the window as `getBoundingClientRect` reports it: from the tree the host has committed (what is pending is committed first), with the node's own transform, which an animation may be drawing. Null when the node has no view yet. */
  layout(node: NativeNode): Rect | null;
  /** The node's own size, before any transform (`clientWidth`, `clientHeight`, a computed `width`). Null when the node has no view yet. */
  size(node: NativeNode): Size | null;
  /** A node's animations are over and its own values are back: the host lets go of what Reanimated remembers of the node's last animated values (`fabric/animation.ts`, `forgetAnimatedValues`). */
  forget(node: NativeNode): void;
}
let animationDriver: AnimationDriver | null = null;
export function setAnimationDriver(driver: AnimationDriver | null): void { animationDriver = driver; }

/** What plays when there is no host (a tree built without a surface): nothing moves, and the animation finishes at once, so a transition's outro still ends and its node still goes. */
export class InstantAnimation implements NativeAnimation {
  onfinish: ((event?: unknown) => void) | null = null;
  effect: unknown = {};
  playState: "idle" | "running" | "finished" = "running";
  currentTime: number | null = 0;
  constructor() {
    queueMicrotask(() => {
      if (this.playState !== "running") return;
      this.playState = "finished";
      this.onfinish?.();
    });
  }
  cancel(): void { this.playState = "idle"; this.currentTime = null; }
}

/** What a node keeps for the DOM-like surface Svelte's transitions use. */
export type DomState = {
  /** What was written to `node.style` (`overflow`, `position`, `width`, `height`, `transform`), as CSS text. */
  inline: Record<string, string> | null;
  shim: InlineStyle | null;
  /** The host's record of the animations playing on the node (`fabric/transitions.ts`). */
  animation: object | null;
};

/**
 * `node.style`, as far as Svelte writes it: `overflow` (a transition that clips), and `position`, `width`, `height`, `transform` (`animate:` takes a leaving item out of the flow and
 * keeps it where it was). A write is kept on the node and applied over its own style by the host (`applyInlineStyle`); an empty string removes it, as on the DOM.
 */
export class InlineStyle {
  declare overflow: string;
  declare position: string;
  declare width: string;
  declare height: string;
  declare transform: string;
  constructor(private readonly node: NativeNode) {}
  getPropertyValue(name: string): string { return this.node.dom?.inline?.[name] ?? ""; }
  setProperty(name: string, value: string | number | null): void { this.node.setInline(name, value === null ? "" : String(value)); }
  removeProperty(name: string): string { const old = this.getPropertyValue(name); this.node.setInline(name, ""); return old; }
}
for (const name of inlineProperties) {
  Object.defineProperty(InlineStyle.prototype, name, {
    get(this: InlineStyle) { return this.getPropertyValue(name); },
    set(this: InlineStyle, value: unknown) { this.setProperty(name, value === undefined || value === null ? "" : String(value)); },
    enumerable: true,
  });
}

let unlinkSink: ((node: NativeNode) => void) | null = null;
/**
 * The host hears every node taken out of its parent. Svelte removes the top node of a destroyed block this way and moves a node by unlinking and linking it
 * again, so a node that is unlinked is only a candidate for being gone: the host looks again when its flush has run.
 */
export function setUnlinkSink(sink: ((node: NativeNode) => void) | null): void { unlinkSink = sink; }

/**
 * One node of the Svelte host tree. Children form a doubly linked list, so the renderer's
 * sibling queries, inserts and keyed moves are O(1). The host reads an immutable snapshot
 * that is rebuilt lazily after a change.
 */
export class NativeNode {
  readonly id = ++nextId;
  parent: NativeNode | null = null;
  firstChild: NativeNode | null = null;
  lastChild: NativeNode | null = null;
  previousSibling: NativeNode | null = null;
  nextSibling: NativeNode | null = null;
  /** Created with the first listener (`addEventListener`): most nodes, every text and every static view, never get one. */
  listeners: Map<string, Set<Listener>> = noListeners;
  private dispatchers: Map<string, Listener> | null = null;
  private props: Record<string, unknown> = noProps as Record<string, unknown>;
  /** The current `props` object went out in a snapshot or was handed in whole: the next change copies it first. */
  private propsShared = true;
  private text: string;
  /** What the host keeps for this node (`fabric/host.ts`): a field, not a WeakMap lookup on every flush. */
  hostState: unknown = null;
  /** The host's own root of a surface: the one node it hears about before it has built anything under it. */
  surfaceRoot = false;
  /** Created by the first animation or write to `style`: most nodes never have one. */
  dom: DomState | null = null;
  private children: readonly NativeNode[] = noChildren;
  private childrenStale = false;
  private snapshot: Snapshot | null = null;

  constructor(readonly kind: "element" | "fragment" | "text" | "comment", readonly name = "", text = "") {
    this.text = text;
  }

  /** The current state as one object; a new object appears only after a change. */
  getSnapshot(): Snapshot {
    if (this.snapshot) return this.snapshot;
    if (this.childrenStale) {
      const children: NativeNode[] = [];
      for (let child = this.firstChild; child; child = child.nextSibling) children.push(child);
      this.children = children;
      this.childrenStale = false;
    }
    this.snapshot = { props: this.props, children: this.children, text: this.text };
    this.propsShared = true;
    return this.snapshot;
  }

  /** The attributes as they are now, for a reader that copies what it needs and keeps no reference (no snapshot is built). */
  peekProps(): Readonly<Record<string, unknown>> { return this.props; }
  get textValue(): string { return this.text; }
  hasProp(key: string): boolean { return Object.hasOwn(this.props, key); }
  getProp(key: string): unknown { return this.props[key]; }

  /** Sets one attribute. A snapshot already handed out keeps the object it saw, so a shared object is copied before the write; consecutive writes to a fresh element change one object. */
  setProp(key: string, value: unknown): void {
    if (Object.is(this.props[key], value)) return;
    if (this.propsShared) { this.props = { ...this.props }; this.propsShared = false; }
    this.props[key] = value;
    this.invalidate("props");
  }

  removeProp(key: string): void {
    if (!Object.hasOwn(this.props, key)) return;
    if (this.propsShared) { this.props = { ...this.props }; this.propsShared = false; }
    delete this.props[key];
    this.invalidate("props");
  }

  /** A stable function per event type, so host props keep their identity between flushes. */
  dispatcher(type: string): Listener {
    this.dispatchers ??= new Map<string, Listener>();
    const dispatchers = this.dispatchers;
    let dispatcher = dispatchers.get(type);
    if (!dispatcher) {
      dispatcher = (...args) => {
        const handlers = this.listeners.get(type);
        if (handlers) for (const handler of [...handlers]) handler(...args);
      };
      dispatchers.set(type, dispatcher);
    }
    return dispatcher;
  }

  setProps(props: Readonly<Record<string, unknown>>): void {
    this.props = props as Record<string, unknown>;
    this.propsShared = true;
    this.invalidate("props");
  }

  setText(text: string): void {
    this.text = text;
    this.invalidate("text");
  }

  childrenChanged(): void {
    this.childrenStale = true;
    this.invalidate("children");
  }

  // --- The DOM-like surface Svelte's `transition:`, `in:`, `out:` and `animate:` use (`svelte/internal/client/dom/elements/transitions.js`) ---

  /** The node's DOM state, made at the first use. */
  domState(): DomState {
    this.dom ??= { inline: null, shim: null, animation: null };
    return this.dom;
  }

  /** `element.style`: the inline style Svelte's transitions write (`InlineStyle`). */
  get style(): InlineStyle {
    const dom = this.domState();
    dom.shim ??= new InlineStyle(this);
    return dom.shim;
  }

  /** One inline style property; an empty value removes it. The host sees the change. */
  setInline(name: string, value: string): void {
    const dom = this.domState();
    if ((dom.inline?.[name] ?? "") === value) return;
    if (value === "") {
      if (dom.inline) { delete dom.inline[name]; if (Object.keys(dom.inline).length === 0) dom.inline = null; }
    } else {
      dom.inline ??= {};
      dom.inline[name] = value;
    }
    this.invalidate("props");
  }

  /** `element.inert`: Svelte makes an element inert for the length of its outro, so it takes no clicks while it leaves. On a native node that is `pointerEvents: "none"`, over the node's own. */
  get inert(): boolean { return this.dom?.inline?.pointerEvents === "none"; }
  set inert(value: boolean) { this.setInline("pointerEvents", value ? "none" : ""); }

  /** `element.animate(keyframes, options)`: plays on the UI thread through Reanimated (`fabric/transitions.ts`); see `NativeAnimation`. */
  animate(keyframes: readonly Keyframe[], options: AnimationOptions = {}): NativeAnimation {
    return animationDriver ? animationDriver.animate(this, keyframes, options) : new InstantAnimation();
  }

  /** `element.getAnimations()`: the animations that have not been cancelled. */
  getAnimations(): NativeAnimation[] { return animationDriver && this.dom?.animation ? animationDriver.getAnimations(this) : []; }

  /** The node's box as `getBoundingClientRect` gives it: layout from the tree the host has committed (pending changes are committed first), with what a running animation moves. Zeros for a node with no view. */
  getBoundingClientRect(): DOMRectReadOnly { return domRect(animationDriver?.layout(this) ?? { x: 0, y: 0, width: 0, height: 0 }); }
  get clientWidth(): number { return animationDriver?.size(this)?.width ?? 0; }
  get clientHeight(): number { return animationDriver?.size(this)?.height ?? 0; }
  /** The node's animations are over and its own values are back (`fabric/transitions.ts`): the host lets go of what Reanimated remembers of the node's last animated values. */
  forgetAnimated(): void { animationDriver?.forget(this); }
  /** `transition:draw` asks an SVG path for its length; a native element has none, so the transition has nothing to draw (its other properties still play). */
  getTotalLength(): number { return 0; }
  /** Svelte's `flip` asks for the zoom: a native view has none, and answering here keeps it from walking up the parents. */
  get currentCSSZoom(): number { return 1; }

  /** What `getComputedStyle(node)` returns for this node. */
  computedStyle(): ComputedStyle { return computedStyleOf(this.props, this.dom?.inline ?? null, () => animationDriver?.size(this) ?? null); }

  /** Calls the listeners of `event.type`, as `dispatchEvent` does (`introstart`, `introend`, `outrostart`, `outroend` reach `onintrostart={...}` this way). */
  dispatchEvent(event: { type: string }): boolean {
    const handlers = this.listeners.get(event.type);
    if (handlers) for (const handler of [...handlers]) handler(event);
    return true;
  }

  /** Drops the cached snapshot and reports the change to the host. */
  invalidate(reason: Invalidation = "props"): void {
    this.snapshot = null;
    invalidationSink?.(this, reason);
  }
}

function unlink(node: NativeNode): void {
  const parent = node.parent;
  if (!parent) return;
  const { previousSibling, nextSibling } = node;
  if (previousSibling) previousSibling.nextSibling = nextSibling;
  else parent.firstChild = nextSibling;
  if (nextSibling) nextSibling.previousSibling = previousSibling;
  else parent.lastChild = previousSibling;
  node.parent = node.previousSibling = node.nextSibling = null;
  parent.childrenChanged();
  unlinkSink?.(node);
}

function link(parent: NativeNode, node: NativeNode, anchor: NativeNode | null): void {
  if (anchor && anchor.parent !== parent) throw new Error("Native insertion anchor is not a child of its parent");
  node.parent = parent;
  if (anchor) {
    const previous = anchor.previousSibling;
    node.previousSibling = previous;
    node.nextSibling = anchor;
    anchor.previousSibling = node;
    if (previous) previous.nextSibling = node;
    else parent.firstChild = node;
  } else {
    const last = parent.lastChild;
    node.previousSibling = last;
    node.nextSibling = null;
    if (last) last.nextSibling = node;
    else parent.firstChild = node;
    parent.lastChild = node;
  }
  parent.childrenChanged();
}

function insert(parent: NativeNode, node: NativeNode, anchor: NativeNode | null): void {
  if (node === anchor) return;
  if (node.kind === "fragment") {
    for (let child = node.firstChild, next: NativeNode | null; child; child = next) {
      next = child.nextSibling;
      unlink(child);
      link(parent, child, anchor);
    }
    return;
  }
  unlink(node);
  link(parent, node, anchor);
}

const renderer = createRenderer<{
  fragment: NativeNode; element: NativeNode; text: NativeNode; comment: NativeNode;
}>({
  createFragment: () => new NativeNode("fragment"),
  createElement: (name) => new NativeNode("element", name),
  createTextNode: (text) => new NativeNode("text", "", text),
  createComment: (text) => new NativeNode("comment", "", text),
  nodeType: (node) => node.kind,
  getNodeValue: (node) => node.textValue,
  getAttribute: (node, name) => {
    const value = node.getProp(name);
    return value == null ? null : String(value);
  },
  setAttribute: (node, key, value: unknown) => node.setProp(key, value instanceof FunctionBox ? value.fn : value),
  removeAttribute: (node, key) => node.removeProp(key),
  hasAttribute: (node, key) => node.hasProp(key),
  setText: (node, text) => {
    if (node.kind === "text" || node.kind === "comment") node.setText(text);
    else {
      while (node.firstChild) unlink(node.firstChild);
      if (text) link(node, new NativeNode("text", "", text), null);
    }
  },
  getFirstChild: (node) => node.firstChild,
  getLastChild: (node) => node.lastChild,
  getNextSibling: (node) => node.nextSibling,
  insert,
  remove: unlink,
  getParent: (node) => node.parent,
  addEventListener: (node, type, handler: Listener) => {
    const handlers = node.listeners.get(type);
    if (handlers) handlers.add(handler);
    else {
      if (node.listeners === noListeners) node.listeners = new Map();
      node.listeners.set(type, new Set([handler]));
      node.invalidate();
    }
  },
  removeEventListener: (node, type, handler: Listener) => {
    const handlers = node.listeners.get(type);
    if (!handlers?.delete(handler) || handlers.size) return;
    node.listeners.delete(type);
    node.invalidate();
  },
});

/**
 * Svelte's transitions and `animate:flip` ask the global `getComputedStyle` for an element's opacity, transform, size and spacing. A device has none, so this installs one that answers for
 * a node (`NativeNode.computedStyle`); where a DOM has one (a test environment) it is left alone. A value that is not a node gets the same answer a DOM would give an empty style.
 */
const scope = globalThis as { getComputedStyle?: unknown };
if (typeof scope.getComputedStyle !== "function") {
  scope.getComputedStyle = (element: { computedStyle?: () => ComputedStyle } | null) => element?.computedStyle?.() ?? computedStyleOf({}, null, () => null);
}

export default renderer;
