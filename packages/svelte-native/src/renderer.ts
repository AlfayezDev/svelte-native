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
  private props: Readonly<Record<string, unknown>> = {};
  private text: string;
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
    return this.snapshot;
  };

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
    this.props = props;
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
  getNodeValue: (node) => node.getSnapshot().text,
  getAttribute: (node, name) => {
    const value = node.getSnapshot().props[name];
    return value == null ? null : String(value);
  },
  setAttribute: (node, key, value: unknown) => {
    const props = node.getSnapshot().props;
    if (Object.is(props[key], value)) return;
    node.setProps({ ...props, [key]: value });
  },
  removeAttribute: (node, key) => {
    const props = { ...node.getSnapshot().props };
    if (!Object.hasOwn(props, key)) return;
    delete props[key];
    node.setProps(props);
  },
  hasAttribute: (node, key) => Object.hasOwn(node.getSnapshot().props, key),
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
