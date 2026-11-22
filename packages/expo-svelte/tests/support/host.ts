import { snapshotGlobals } from "./globals.ts";

/**
 * The one fake Fabric host of the test suite: the `nativeFabricUIManager` binding the renderer's host talks to, with the rules of the real one that a bug could
 * break (a committed node takes no more children, a ScrollView holds one child), a log of what the host asked for, the committed tree of each surface, and the
 * event handler the host registered.
 *
 * The bundled host reads the binding when its module is evaluated, so a fake has to be on the global object before a bundle is imported, and Bun runs every
 * test file in one process: what a fake leaves behind is what the next file starts with. `install()` therefore returns a handle whose `restore()` puts the global
 * object back as it was (every global the fake, the test or the bundle set, `globals.ts`), and `fakeHost()` (`fake-host.ts`) does that around each test of a file.
 */
export type FakeNode = { tag: number; name: string; props: Record<string, unknown>; children: FakeNode[]; sealed: boolean; target?: unknown };
export type ChildSet = { root: number; children: FakeNode[] };
export type EventHandler = (target: unknown, type: string, event: object) => void;

/** One call the host made to the binding, before it is written to `calls`. */
export type HostCall =
  | { op: "create"; name: string }
  | { op: "cloneChildren" | "cloneProps" | "cloneBoth" | "measure" | "measureInWindow"; node: FakeNode }
  | { op: "completeRoot"; root: number }
  | { op: "dispatchCommand"; node: FakeNode; command: string; args: unknown[] }
  | { op: "setNativeProps"; node: FakeNode; props: object };

/** The default line of `calls` for a call. */
export function describeCall(call: HostCall): string {
  switch (call.op) {
    case "create": return `create ${call.name}`;
    case "completeRoot": return "completeRoot";
    case "dispatchCommand": return `dispatchCommand ${call.node.tag} ${call.command} ${JSON.stringify(call.args)}`;
    case "setNativeProps": return `setNativeProps ${call.node.tag} ${JSON.stringify(call.props)}`;
    case "measure": case "measureInWindow": return `${call.op} ${call.node.tag}`;
    default: return `${call.op} ${call.node.name}`;
  }
}

export type Binding = {
  createNode(tag: number, name: string, root: number, props: Record<string, unknown> | null, target: unknown): FakeNode;
  cloneNodeWithNewChildren(node: FakeNode): FakeNode;
  cloneNodeWithNewProps(node: FakeNode, props: Record<string, unknown>): FakeNode;
  cloneNodeWithNewChildrenAndProps(node: FakeNode, props: Record<string, unknown>): FakeNode;
  appendChild(parent: FakeNode, child: FakeNode): void;
  createChildSet(root: number): ChildSet;
  appendChildToSet(set: ChildSet, child: FakeNode): void;
  completeRoot(root: number, set: ChildSet): void;
  measure(node: FakeNode, callback: (...args: number[]) => void): void;
  measureInWindow(node: FakeNode, callback: (...args: number[]) => void): void;
  dispatchCommand(node: FakeNode, command: string, args: unknown[]): void;
  setNativeProps(node: FakeNode, props: object): void;
  registerEventHandler(handler: EventHandler): void;
};

export type HostOptions = {
  /** Fabric's own rules: a node that was committed takes no more children, and a ScrollView takes one. Default true. */
  strict?: boolean;
  /** Where the log goes, for a test that writes other lines into the same log (the foreign tests' engine calls). Default: a log of its own. */
  calls?: string[];
  /** The line a call writes to the log; `undefined` leaves it out. Default: `describeCall`. */
  describe?: (call: HostCall) => string | undefined;
};

/** Puts the global object back as `install()` found it. Does it once: later calls do nothing. */
export type Installed = { restore(): void };

export type FabricHost = {
  /** The binding that `install()` puts on the global object. A test may replace one of its methods for the length of a test. */
  readonly fake: Binding;
  /** What the host asked the binding for, in order. */
  readonly calls: string[];
  /** The committed children of each surface by root tag; a test may replace the object to forget the surfaces of an earlier one. */
  roots: Record<number, FakeNode[]>;
  /** The handler the host registered with `registerEventHandler`. */
  handler: EventHandler | undefined;
  /** Sends a native event to a node's `target`, as React Native's event emitter does (`topLoad`, not `onLoad`). */
  emit(target: unknown, type: string, event?: object): void;
  /** The nodes of a surface, flattened, parents before children. */
  nodes(rootTag: number): FakeNode[];
  /** Forgets the log and the surfaces. */
  reset(): void;
  /** Sets `nativeFabricUIManager` and `globals` (a bundle's own stand-ins read them) and returns what puts the global object back as it was before. */
  install(globals?: Record<string, unknown>): Installed;
};

export const flatten = (nodes: FakeNode[]): FakeNode[] => nodes.flatMap((node) => [node, ...flatten(node.children)]);

/**
 * Installs that nobody has restored. A harness that installs when it is first used keeps its globals until its owner restores them; the hooks of `preload.ts` put back
 * what a test installed during itself (its hooks and body) when the test ends, and everything that is left when the run ends. An install made before a file's first test
 * (at module scope or in `beforeAll`) belongs to the file, which restores it in `afterAll`.
 */
const outstanding: Installed[] = [];
let before = new Set<Installed>();

/** The test starts: what is installed now is not the test's. */
export function beginTest(): void { before = new Set(outstanding); }

/** The test is over: puts back what it installed, newest first. */
export function endTest(): void {
  for (const installed of outstanding.filter((candidate) => !before.has(candidate)).reverse()) installed.restore();
}

/** Puts back every install that is still in place, newest first. */
export function restoreStrays(): void {
  for (const installed of [...outstanding].reverse()) installed.restore();
}

export function createHost(options: HostOptions = {}): FabricHost {
  const strict = options.strict ?? true;
  const describe = options.describe ?? describeCall;
  const calls = options.calls ?? [];
  const record = (call: HostCall) => { const line = describe(call); if (line !== undefined) calls.push(line); };
  const seal = (node: FakeNode) => { node.sealed = true; node.children.forEach(seal); };
  let current: Installed | undefined;

  const host: FabricHost = {
    calls,
    roots: {},
    handler: undefined,
    emit: (target, type, event = {}) => host.handler?.(target, type, event),
    nodes: (rootTag) => flatten(host.roots[rootTag] ?? []),
    reset() { calls.length = 0; host.roots = {}; },
    fake: {
      createNode(tag, name, _root, props, target) { record({ op: "create", name }); return { tag, name, props: { ...props }, children: [], sealed: false, target }; },
      cloneNodeWithNewChildren(node) { record({ op: "cloneChildren", node }); return { ...node, children: [], sealed: false }; },
      cloneNodeWithNewProps(node, props) { record({ op: "cloneProps", node }); return { ...node, props: { ...node.props, ...props }, children: [...node.children], sealed: false }; },
      cloneNodeWithNewChildrenAndProps(node, props) { record({ op: "cloneBoth", node }); return { ...node, props: { ...node.props, ...props }, children: [], sealed: false }; },
      appendChild(parent, child) {
        if (strict) {
          if (parent.sealed) throw new Error(`appendChild on sealed ${parent.name}`);
          if (parent.name === "RCTScrollView" && parent.children.length >= 1) throw new Error("ScrollView can host only one direct child");
        }
        parent.children.push(child);
      },
      createChildSet: (root) => ({ root, children: [] }),
      appendChildToSet(set, child) { set.children.push(child); },
      completeRoot(root, set) {
        record({ op: "completeRoot", root });
        if (strict) set.children.forEach(seal);
        host.roots[root] = set.children;
      },
      measure(node, callback) { record({ op: "measure", node }); callback(1, 2, 3, 4, 5, 6); },
      measureInWindow(node, callback) { record({ op: "measureInWindow", node }); callback(5, 6, 3, 4); },
      dispatchCommand(node, command, args) { record({ op: "dispatchCommand", node, command, args }); },
      setNativeProps(node, props) { record({ op: "setNativeProps", node, props }); },
      registerEventHandler(handler) { host.handler = handler; },
    },
    install(globals = {}) {
      // Installing again while the fake is in place sets the globals once more (a harness does it before each bundle it evaluates) and keeps the one snapshot.
      if (!current) {
        const snapshot = snapshotGlobals();
        let restored = false;
        const installed: Installed = {
          restore() {
            // Once: a second call would put an old snapshot over what the test did since.
            if (restored) return;
            restored = true;
            snapshot.restore();
            if (current === installed) current = undefined;
            const at = outstanding.indexOf(installed);
            if (at >= 0) outstanding.splice(at, 1);
          },
        };
        current = installed;
        outstanding.push(installed);
      }
      Object.assign(globalThis, { nativeFabricUIManager: host.fake, ...globals });
      return current;
    },
  };
  return host;
}

/** `tick`, then the microtasks a flush needs: what a test waits for after it changes state the host commits. */
export const settle = async (loaded: { tick: () => Promise<void> }): Promise<void> => { await loaded.tick(); await Promise.resolve(); await Promise.resolve(); };
