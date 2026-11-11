import { createRenderer } from "svelte/renderer";
import { classStyle } from "./classes.ts";
import { INLINE, hostTagOf } from "./html-tags.ts";

/**
 * The React Native props the host builds from a host node's attributes (`peekProps()`): the host calls this itself, so what it returns is what a node sends to the native view (its `style` is the
 * style of its `class` under its own). For tests and the QA lab, which read a mounted node's resolved props.
 */
export { mergeHostProps } from "./native-props.ts";

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
  return spread(props, toggles, false);
}

function spread<T extends object>(props: T, toggles: Record<string, unknown> | undefined, defer: boolean): T {
  const copy = { ...props } as Record<string, unknown>;
  if ("class" in copy) {
    const fromClass = classStyle(toggles === undefined ? copy.class : [copy.class, toggles], copy.style, defer);
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
 * The spread of an HTML element the lowering turned into a host tag (`lower-html.ts`): `hostSpread`, and a web handler name in the props is the native one (`onclick` is
 * `onPress`), so `<div {...rest}>` presses when its parent gave `rest` an `onclick`, as a browser's does. The style of a `class` in it keeps its font-relative values
 * for the host, as `hostHtmlClass` does.
 */
export function hostWebSpread<T extends object>(props: T, toggles?: Record<string, unknown>): T {
  const copy = spread(props, toggles, true) as Record<string, unknown>;
  if ("onclick" in copy) {
    copy.onPress ??= copy.onclick;
    delete copy.onclick;
  }
  return copy as T;
}

/**
 * The same for an element whose press does something by itself (a `<button>` submits its form, an `<a>` follows its `href`): that is `onPress`, and the spread's `onclick` must not replace
 * it, so it is `onHtmlClick`, which `hostClick` runs (before what the press does, as a browser runs a handler before the default action).
 */
export function hostWebClickSpread<T extends object>(props: T, toggles?: Record<string, unknown>): T {
  const copy = spread(props, toggles, true) as Record<string, unknown>;
  if ("onclick" in copy) {
    copy.onHtmlClick ??= copy.onclick;
    delete copy.onclick;
  }
  return copy as T;
}

/** `hostClass` for a lowered HTML element: the font-relative values of the class (a `leading-6`'s line height) stay in the style for the host, which knows the font size the element inherits (`fabric/text-inherit.ts`). */
export function hostHtmlClass(value: unknown, style?: unknown): unknown {
  return classStyle(value, style, true);
}

/** The `src` of an HTML `<img>` as the `source` of a native image: a string is its `uri`; a source object and an asset module (what Metro makes of an `import`) already are one. */
export function hostSource(value: unknown): unknown {
  return typeof value === "string" ? { uri: value } : value;
}

/**
 * The host tag of the tag a `<svelte:element this={tag}>` is given when the app runs, by the table the lowering reads (`html-tags.ts`): `h2` is a text, `div` a view. A host tag
 * (`native-view`) is as it is; no tag (`undefined`, `false`) is no element; a tag that has no host tag (an `input` is a component, a `table` has no equivalent) is an error that names it.
 */
export function hostTag(tag: unknown): unknown {
  if (typeof tag !== "string" || tag === "") return tag;
  if (tag.startsWith("native-")) return tag;
  const host = hostTagOf(tag);
  if (host === undefined) throw new Error(`<svelte:element this="${tag}"> has no native equivalent: only the elements that are a host tag here (div, p, span, h1, button, a, img, ...) can be chosen when the app runs; write ${tag} as an element of its own`);
  return host;
}

/** What `nativeHtml` is for the tag of a `<svelte:element>` that is worked out when the app runs: `"inline"` for a text element that flows in a line (`span`, `b`, ...), as the lowering marks the ones it reads. */
export function hostInline(tag: unknown): true | "inline" {
  return typeof tag === "string" && INLINE.has(tag) && hostTagOf(tag) === "native-text" ? "inline" : true;
}

/**
 * What `oninput` and `onchange` of an `<input>` get, in the shape a browser's event has for the fields web code reads: `currentTarget.value` (`.checked` for a checkbox) and
 * `target`, with the `name`, `id` and `type` the element has. The text, or the state of the switch, is what the native control reported.
 */
export function hostInputEvent(type: "input" | "change", value: unknown, element: { name?: string; id?: string; type?: string } = {}) {
  const target = { ...element, ...(typeof value === "boolean" ? { checked: value } : { value }) };
  return { type, target, currentTarget: target, preventDefault() {}, stopPropagation() {} };
}

/**
 * A press, as a click: the handler gets the event with a `preventDefault` that works, then the handlers a spread's `onclick` gave (`hostWebClickSpread`), and what the press does by itself (a
 * link's navigation, a button's form submission) happens after them unless one called `preventDefault`. The event is the press event itself otherwise (`currentTarget` is the element).
 */
export function hostClick(event: unknown, handler: ((event: unknown) => void) | undefined | null, after?: (event: unknown) => void): void {
  const press = Object.create((event ?? null) as object | null) as { defaultPrevented: boolean; preventDefault(): void };
  press.defaultPrevented = false;
  press.preventDefault = () => { press.defaultPrevented = true; };
  handler?.(press);
  const origin = (event as { currentTarget?: unknown } | null | undefined)?.currentTarget;
  const spread = origin instanceof NativeNode ? origin.listeners.get("HtmlClick") : undefined;
  if (spread) for (const listener of [...spread]) listener(press);
  if (!press.defaultPrevented) after?.(press);
}

/** The `href` of the element a press came from (an `<a>`'s, which stays an attribute of it, so one from a spread is there too): a string, or nothing. */
export function hostHref(event: unknown): string | undefined {
  const origin = (event as { currentTarget?: unknown } | null | undefined)?.currentTarget;
  const href = origin instanceof NativeNode ? origin.getProp("href") : undefined;
  return typeof href === "string" && href !== "" ? href : undefined;
}

/** The inputs whose last key press was prevented: Enter in them is not a submission. */
const keyPrevented = new WeakSet<object>();

/**
 * What a `<button>` does after its press when it is a submit button (no `type`, or `type="submit"`: the element's own `type`, so one from a spread counts), or what Enter in a
 * single-line input does (`force`, unless its key press was prevented): the nearest `<form>` above the element that gave the event (a lowered `<form>` has `nativeForm`, which the
 * element tree knows however the components are put together) hears `submit`, with `target` and `currentTarget` the form and `submitter` the element. With no form above, nothing happens.
 */
export function hostSubmit(event: unknown, force = false): void {
  const origin = (event as { currentTarget?: unknown } | null | undefined)?.currentTarget;
  if (!(origin instanceof NativeNode)) return;
  if (force) {
    if (keyPrevented.delete(origin)) return;
  } else {
    const type = origin.getProp("type");
    if (typeof type === "string" && type !== "" && type.toLowerCase() !== "submit") return;
  }
  for (let node: NativeNode | null = origin; node; node = node.parent) {
    if (node.getProp("nativeForm") !== true) continue;
    const submit = { type: "submit", target: node, currentTarget: node, submitter: origin, defaultPrevented: false, preventDefault() { submit.defaultPrevented = true; }, stopPropagation() {} };
    node.dispatcher("submit")(submit);
    return;
  }
}

/**
 * What `onkeydown` and `onkeyup` of an `<input>` get: the key (`"Enter"`, `"a"`, `"Backspace"`) of the native key press, in the shape of a browser's event. `preventDefault` on the
 * key press of Enter stops the submission it would make.
 */
export function hostKeyEvent(type: "keydown" | "keyup", event: unknown) {
  const native = (event as { nativeEvent?: { key?: string }; currentTarget?: unknown } | null | undefined) ?? {};
  const origin = native.currentTarget;
  if (type === "keydown" && origin !== null && typeof origin === "object") keyPrevented.delete(origin);
  return {
    type, key: native.nativeEvent?.key, nativeEvent: native.nativeEvent, target: origin, currentTarget: origin,
    preventDefault() { if (origin !== null && typeof origin === "object") keyPrevented.add(origin); },
    stopPropagation() {},
  };
}

/**
 * The `ref` of a `bind:this={target}` of the lowering: the variable gets the host handle, and `null` only if it still holds this one when the element goes away. `keys` are the computed
 * keys of the target (`els[i]` has `[i]`), read where the attribute is, so the `ref` is made again when one changes (the host then gives the old one `null` and the new one the
 * handle, as Svelte's own `bind:this` follows its target) and `set` and `get` act on the target the keys named when it was made, not on the one they name now.
 */
export function hostBind(set: (keys: unknown[], value: unknown) => void, get: (keys: unknown[]) => unknown, keys: unknown[] = []): (handle: unknown) => void {
  let mine: unknown;
  return (handle) => {
    if (handle === null || handle === undefined) {
      if (mine !== undefined && get(keys) === mine) set(keys, null);
      mine = undefined;
      return;
    }
    mine = handle;
    set(keys, handle);
  };
}

export { hostStyleProps } from "./html-style.ts";

export type Invalidation = "props" | "children" | "text";
let invalidationSink: ((node: NativeNode, reason: Invalidation) => void) | null = null;
/** The host (see `fabric/`) hears every change through this sink. */
export function setInvalidationSink(sink: ((node: NativeNode, reason: Invalidation) => void) | null): void { invalidationSink = sink; }

let refSink: ((node: NativeNode) => void) | null = null;
/**
 * The host hears of a `ref` (the attribute, or the one in `nativeProps` a component hands its view) when the element is in a tree that is on a surface: the moment it is set if it is, and
 * the moment it gets there if not (Svelte sets the attributes of an element while it builds the subtree it is in, and links the subtree into the screen after). The handle is given then, so
 * `onMount` and effects find it, and not a microtask later, when the host builds the view (`fabric/host.ts`, `earlyRef`). An element that is in no screen yet (what a `fork()` builds
 * off screen, `router.prepare`) hears nothing until it is: a screen that is dropped never calls its refs.
 */
export function setRefSink(sink: ((node: NativeNode) => void) | null): void { refSink = sink; }

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
  /** How many nodes of this subtree (this one too) have a `ref` that the host has not heard of, because the subtree is in no screen yet (`giveRefs`). */
  waiting = 0;
  /** This node's `ref` is one of those. */
  refWaits = false;
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
    if ((key === "ref" || key === "nativeProps") && refSink !== null) {
      if (onScreen(this)) refSink(this);
      else if (!this.refWaits) {
        // Counted in the subtrees above it, which a link and an unlink carry on (`link`, `unlink`).
        this.refWaits = true;
        carryWaiting(this, 1);
      }
    }
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

  /** Drops the cached snapshot and reports the change to the host. */
  invalidate(reason: Invalidation = "props"): void {
    this.snapshot = null;
    invalidationSink?.(this, reason);
  }
}

/** What waits for a screen in a subtree is counted in the node and in every node above it. */
function carryWaiting(from: NativeNode | null, by: number): void {
  for (let at = from; at; at = at.parent) at.waiting += by;
}

/** Whether the node is in a tree that hangs from the root of a surface. */
function onScreen(node: NativeNode): boolean {
  let top = node;
  while (top.parent) top = top.parent;
  return top.surfaceRoot;
}

/** The refs of a subtree that has just reached a screen are given to the host, parents first. */
function giveRefs(node: NativeNode): void {
  if (node.waiting === 0) return;
  node.waiting = 0;
  if (node.refWaits) {
    node.refWaits = false;
    refSink?.(node);
  }
  for (let child = node.firstChild; child; child = child.nextSibling) giveRefs(child);
}

function unlink(node: NativeNode): void {
  const parent = node.parent;
  if (!parent) return;
  // What waits in the subtree is no longer waited for above it.
  if (node.waiting > 0) carryWaiting(parent, -node.waiting);
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
  if (node.waiting > 0) {
    // A subtree with refs that reach a screen gives them to the host; one that does not carries the count to the subtrees above.
    if (onScreen(parent)) giveRefs(node);
    else carryWaiting(parent, node.waiting);
  }
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

export default renderer;
