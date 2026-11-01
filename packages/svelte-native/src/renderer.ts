import { createRenderer } from "svelte/renderer";

type Listener = (...args: unknown[]) => void;
export type Snapshot = {
  props: Readonly<Record<string, unknown>>;
  children: readonly NativeNode[];
  text: string;
};

let nextId = 0;

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
  readonly listeners = new Map<string, Set<Listener>>();
  private readonly dispatchers = new Map<string, Listener>();
  private props: Record<string, unknown> = {};
  /** The current `props` object went out in a snapshot or was handed in whole: the next change copies it first. */
  private propsShared = false;
  private text: string;
  /** What the host keeps for this node (`fabric/host.ts`): a field, not a WeakMap lookup on every flush. */
  hostState: unknown = null;
  private children: readonly NativeNode[] = [];
  private childrenStale = false;
  private snapshot: Snapshot | null = null;

  constructor(readonly kind: "element" | "fragment" | "text" | "comment", readonly name = "", text = "") {
    this.text = text;
  }

  /** The current state as one object; a new object appears only after a change. */
  getSnapshot = (): Snapshot => {
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
  };

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
    let dispatcher = this.dispatchers.get(type);
    if (!dispatcher) {
      dispatcher = (...args) => {
        const handlers = this.listeners.get(type);
        if (handlers) for (const handler of [...handlers]) handler(...args);
      };
      this.dispatchers.set(type, dispatcher);
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
  setAttribute: (node, key, value: unknown) => node.setProp(key, value),
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
