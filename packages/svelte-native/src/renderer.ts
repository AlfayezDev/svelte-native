import { createRenderer } from "svelte/renderer";

export type NativeReference = { focus?: () => void; blur?: () => void };
type Listener = (...args: unknown[]) => void;
type Snapshot = {
  props: Readonly<Record<string, unknown>>;
  children: readonly NativeNode[];
  text: string;
};

let nextId = 0;

export class NativeNode {
  readonly id = ++nextId;
  parent: NativeNode | null = null;
  reference: NativeReference | null = null;
  readonly listeners = new Map<string, Set<Listener>>();
  private readonly subscribers = new Set<() => void>();
  private snapshot: Snapshot;

  constructor(readonly kind: "element" | "fragment" | "text" | "comment", readonly name = "", text = "") {
    this.snapshot = { props: {}, children: [], text };
  }

  getSnapshot = (): Snapshot => this.snapshot;
  subscribe = (listener: () => void): (() => void) => {
    this.subscribers.add(listener);
    return () => { this.subscribers.delete(listener); };
  };

  update(patch: Partial<Snapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.subscribers) listener();
  }

  focus(): void { this.reference?.focus?.(); }
  blur(): void { this.reference?.blur?.(); }
}

function remove(node: NativeNode): void {
  const parent = node.parent;
  if (!parent) return;
  node.parent = null;
  parent.update({ children: parent.getSnapshot().children.filter((child) => child !== node) });
}

function insert(parent: NativeNode, node: NativeNode, anchor: NativeNode | null): void {
  if (node === anchor) return;
  if (node.kind === "fragment") {
    for (const child of [...node.getSnapshot().children]) insert(parent, child, anchor);
    return;
  }
  remove(node);
  const children = [...parent.getSnapshot().children];
  const index = anchor === null ? children.length : children.indexOf(anchor);
  if (index < 0) throw new Error("Native insertion anchor is not a child of its parent");
  children.splice(index, 0, node);
  node.parent = parent;
  parent.update({ children });
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
    if (Object.is(node.getSnapshot().props[key], value)) return;
    node.update({ props: { ...node.getSnapshot().props, [key]: value } });
  },
  removeAttribute: (node, key) => {
    const props = { ...node.getSnapshot().props };
    delete props[key];
    node.update({ props });
  },
  hasAttribute: (node, key) => Object.hasOwn(node.getSnapshot().props, key),
  setText: (node, text) => {
    if (node.kind === "text" || node.kind === "comment") node.update({ text });
    else {
      for (const child of [...node.getSnapshot().children]) remove(child);
      if (text) insert(node, new NativeNode("text", "", text), null);
    }
  },
  getFirstChild: (node) => node.getSnapshot().children[0] ?? null,
  getLastChild: (node) => node.getSnapshot().children.at(-1) ?? null,
  getNextSibling: (node) => {
    const siblings = node.parent?.getSnapshot().children;
    return siblings?.[siblings.indexOf(node) + 1] ?? null;
  },
  insert,
  remove,
  getParent: (node) => node.parent,
  addEventListener: (node, type, handler: Listener) => {
    let handlers = node.listeners.get(type);
    if (!handlers) {
      handlers = new Set();
      node.listeners.set(type, handlers);
    }
    handlers.add(handler);
    node.update({});
  },
  removeEventListener: (node, type, handler: Listener) => {
    node.listeners.get(type)?.delete(handler);
    if (!node.listeners.get(type)?.size) node.listeners.delete(type);
    node.update({});
  },
});

export default renderer;
