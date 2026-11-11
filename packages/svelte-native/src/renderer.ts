import { createRenderer } from "svelte/renderer";
import { classStyle } from "./classes.ts";
import { inputTypeProps } from "./html-input.ts";

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
 * `onPress`), so `<button {...rest}>` presses when its parent gave `rest` an `onclick`, as a browser's does. The style of a `class` in it keeps its font-relative values
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

/** `hostClass` for a lowered HTML element: the font-relative values of the class (a `leading-6`'s line height) stay in the style for the host, which knows the font size the element inherits (`fabric/text-inherit.ts`). */
export function hostHtmlClass(value: unknown, style?: unknown): unknown {
  return classStyle(value, style, true);
}

/** The `src` of an HTML `<img>` as the `source` of a native image: a string is its `uri`; a source object and an asset module (what Metro makes of an `import`) already are one. */
export function hostSource(value: unknown): unknown {
  return typeof value === "string" ? { uri: value } : value;
}

/** The props the `type` of an HTML `<input>` implies for a `TextInput` (`html-input.ts`), for a `type={expression}` the lowering cannot read. */
export function hostInputType(type: unknown): Record<string, string | boolean> {
  return { ...inputTypeProps(type) };
}

/**
 * What `oninput` and `onchange` of a lowered `<input>` get, in the shape a browser's event has for the fields web code reads: `currentTarget.value` (`.checked` for a checkbox) and
 * `target`. The text, or the state of the switch, is what the native control reported.
 */
export function hostInputEvent(type: "input" | "change", value: unknown) {
  const target = typeof value === "boolean" ? { checked: value } : { value };
  return { type, target, currentTarget: target, preventDefault() {}, stopPropagation() {} };
}

const LENGTH = /^(-?(?:\d+\.?\d*|\.\d+))(px)?$/;
const EM = /^(-?(?:\d+\.?\d*|\.\d+))em$/;
const PLAIN = /^(?:-?(?:\d+\.?\d*|\.\d+)%|#[0-9a-f]{3,8}|(?:rgb|hsl)a?\([^)]*\)|[a-z][a-z-]*)$/i;
const dev = () => typeof __DEV__ !== "undefined" && __DEV__;

type StyleValue = { value: unknown } | { relative: number };
function styleValue(key: string, value: unknown): StyleValue | undefined {
  if (typeof value === "number") return key === "lineHeight" ? { relative: value } : { value };
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  const length = LENGTH.exec(text);
  if (length) return length[2] === undefined && key === "lineHeight" ? { relative: Number(length[1]) } : { value: Number(length[1]) };
  const em = EM.exec(text);
  if (em) return key === "lineHeight" || key === "letterSpacing" ? { relative: Number(em[1]) } : undefined;
  return PLAIN.test(text) ? { value: text } : undefined;
}

/**
 * The style of the `style:property={value}` directives of an HTML element (`lower-html.ts`), as a React Native style object: the name is camel-cased, `px` and a plain number are
 * dp, and a percentage, a color or a keyword passes as it is. A unitless `line-height` and an `em` `line-height` or `letter-spacing` are relative to the font size
 * (`fontRelative`, `fabric/text-inherit.ts`). A value that is none of these (`rem`, `calc()`, `var()`) is left out, with a warning in development; so is `null`, `undefined` and `false`,
 * which take the property away, as they do on the web.
 */
export function hostStyleProps(props: Record<string, unknown>): Record<string, unknown> {
  const style: Record<string, unknown> = {};
  for (const name in props) {
    const value = props[name];
    if (value === undefined || value === null || value === false || value === "") continue;
    const key = name.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
    const parsed = styleValue(key, value);
    if (parsed === undefined) {
      if (dev()) console.warn(`svelte-native: style:${name}={${JSON.stringify(value)}} is not a value a native style takes (px, a number, a percentage, a color or a keyword), so it is left out`);
    } else if ("relative" in parsed) style.fontRelative = { ...(style.fontRelative as object), [key]: parsed.relative };
    else style[key] = key === "fontWeight" ? String(parsed.value) : parsed.value;
  }
  return style;
}

/**
 * A press, as a click: the handler gets the event with a `preventDefault` that works, and what the press does by itself (a link's navigation, a button's form submission) happens after
 * it unless the handler called it. The event is the press event itself otherwise (`currentTarget` is the element).
 */
export function hostClick(event: unknown, handler: ((event: unknown) => void) | undefined | null, after?: (event: unknown) => void): void {
  const press = Object.create((event ?? null) as object | null) as { defaultPrevented: boolean; preventDefault(): void };
  press.defaultPrevented = false;
  press.preventDefault = () => { press.defaultPrevented = true; };
  handler?.(press);
  if (!press.defaultPrevented) after?.(press);
}

/**
 * What a `<button>` does after its press when it is a submit button (no `type`, or `type="submit"`, which `type` is the argument for), or what Enter in a single-line input does: the
 * nearest `<form>` above the element that gave the event (a lowered `<form>` has `nativeForm`, which the element tree knows however the components are put together) hears `submit`,
 * with `target` and `currentTarget` the form and `submitter` the element. With no form above, nothing happens.
 */
export function hostSubmit(event: unknown, type?: unknown): void {
  if (type !== undefined && type !== "submit") return;
  const origin = (event as { currentTarget?: unknown } | null | undefined)?.currentTarget;
  if (!(origin instanceof NativeNode)) return;
  for (let node: NativeNode | null = origin; node; node = node.parent) {
    if (node.getProp("nativeForm") !== true) continue;
    const submit = { type: "submit", target: node, currentTarget: node, submitter: origin, defaultPrevented: false, preventDefault() { submit.defaultPrevented = true; }, stopPropagation() {} };
    node.dispatcher("submit")(submit);
    return;
  }
}

/** What `onkeydown` and `onkeyup` of a lowered `<input>` get: the key (`"Enter"`, `"a"`, `"Backspace"`) of the native key press, in the shape of a browser's event. */
export function hostKeyEvent(type: "keydown" | "keyup", event: unknown) {
  const native = (event as { nativeEvent?: { key?: string }; currentTarget?: unknown } | null | undefined) ?? {};
  return { type, key: native.nativeEvent?.key, nativeEvent: native.nativeEvent, target: native.currentTarget, currentTarget: native.currentTarget, preventDefault() {}, stopPropagation() {} };
}

export type Invalidation = "props" | "children" | "text";
let invalidationSink: ((node: NativeNode, reason: Invalidation) => void) | null = null;
/** The host (see `fabric/`) hears every change through this sink. */
export function setInvalidationSink(sink: ((node: NativeNode, reason: Invalidation) => void) | null): void { invalidationSink = sink; }

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

export default renderer;
