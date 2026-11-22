import { describe, expect, test } from "bun:test";
import { snapshotGlobals } from "./globals.ts";
import { type FakeNode, createHost } from "./host.ts";
import { fakeHost } from "./fake-host.ts";

/** Every string-keyed own property of the global object with the parts of its descriptor a test can see change. */
const globalsOf = () => Object.fromEntries(Reflect.ownKeys(globalThis).filter((key): key is string => typeof key === "string").map((key) => {
  const { value, get, set, writable, enumerable, configurable } = Object.getOwnPropertyDescriptor(globalThis, key) as PropertyDescriptor;
  return [key, { value, get, set, writable, enumerable, configurable }];
}));
const scope = globalThis as Record<string, unknown>;
const initial = globalsOf();

describe("restore() returns the global object to how it was", () => {
  test("every global the fake, the test and the bundle set is gone, and what they replaced or deleted is back", () => {
    scope.__kept = "as found";
    scope.__replaced = { was: true };
    scope.__deleted = 1;
    const before = globalsOf();
    const installed = createHost().install({ expo: {}, RN$registerCallableModule: () => {}, RN$Bridgeless: true, __DEV__: true, __gh: {}, __anim: {}, __harness: {}, global: "not the global object" });
    scope.__madeByABundle = 1;
    scope.__replaced = "something else";
    delete scope.__deleted;
    Object.defineProperty(globalThis, "__kept", { value: "frozen", writable: false, configurable: true });
    expect(scope.nativeFabricUIManager).toBeDefined();
    expect(globalsOf()).not.toEqual(before);

    installed.restore();
    expect(globalsOf()).toEqual(before);
    expect(scope.__replaced).toEqual({ was: true });
    expect(scope.__deleted).toBe(1);
    delete scope.__kept; delete scope.__replaced; delete scope.__deleted;
  });

  test("restoring twice, or after nothing was set, changes nothing", () => {
    const before = globalsOf();
    const installed = createHost().install();
    installed.restore();
    installed.restore();
    snapshotGlobals().restore();
    expect(globalsOf()).toEqual(before);
  });

  test("a fake installed over another one gives it back, and the first restores what was there before both", () => {
    const before = globalsOf();
    const first = createHost();
    const second = createHost();
    const outer = first.install({ __marker: "first" });
    const inner = second.install({ __marker: "second" });
    expect(scope.nativeFabricUIManager).toBe(second.fake);
    inner.restore();
    expect(scope.nativeFabricUIManager).toBe(first.fake);
    expect(scope.__marker).toBe("first");
    outer.restore();
    expect(globalsOf()).toEqual(before);
  });
});

describe("fakeHost installs the fake around each test of a file", () => {
  const host = fakeHost({ globals: { __probe: "set by the host" } });

  test("the fake is on the global object while the test runs, with what the file asked for", () => {
    expect(scope.nativeFabricUIManager).toBe(host.fake);
    expect(scope.__probe).toBe("set by the host");
    host.calls.push("left by the test");
    host.roots[1] = [];
    scope.__leak = "a test's own global";
  });

  test("the next test starts with the log and the surfaces empty and the leak gone", () => {
    expect(host.calls).toEqual([]);
    expect(host.roots).toEqual({});
    expect("__leak" in globalThis).toBe(false);
  });
});

// The file is loaded after the tests of the one before it ended, so `initial` is what the hosts of this file must leave behind.
test("nothing the block above or the tests before it set is left on the global object after them", () => {
  expect(globalsOf()).toEqual(initial);
});

describe("the binding", () => {
  const mount = (host: ReturnType<typeof createHost>, root = 1) => {
    const { fake } = host;
    const text = fake.createNode(2, "RCTText", root, { a: 1 }, "target");
    const view = fake.createNode(1, "RCTView", root, null, undefined);
    fake.appendChild(view, text);
    const set = fake.createChildSet(root);
    fake.appendChildToSet(set, view);
    fake.completeRoot(root, set);
    return { view, text };
  };

  test("builds nodes, clones them with their children or props, and keeps the committed tree of each surface", () => {
    const host = createHost();
    const { view } = mount(host);
    expect(host.roots[1]).toEqual([view]);
    expect(host.nodes(1).map((node) => node.name)).toEqual(["RCTView", "RCTText"]);
    const cloned = host.fake.cloneNodeWithNewProps(view, { padding: 2 });
    expect(cloned).not.toBe(view);
    expect(cloned.props).toEqual({ padding: 2 });
    expect(cloned.children).toEqual(view.children);
    expect(cloned.sealed).toBe(false);
    const both = host.fake.cloneNodeWithNewChildrenAndProps(view, { padding: 3 });
    expect(both.children).toEqual([]);
    expect(host.fake.cloneNodeWithNewChildren(view).children).toEqual([]);
    expect(host.calls).toEqual(["create RCTText", "create RCTView", "completeRoot", "cloneProps RCTView", "cloneBoth RCTView", "cloneChildren RCTView"]);
  });

  test("Fabric's rules: a committed node takes no more children, and a ScrollView takes one", () => {
    const host = createHost();
    const { view } = mount(host);
    expect(() => host.fake.appendChild(view, host.fake.createNode(3, "RCTView", 1, {}, undefined))).toThrow("appendChild on sealed RCTView");
    const scroll = host.fake.createNode(4, "RCTScrollView", 1, {}, undefined);
    host.fake.appendChild(scroll, host.fake.createNode(5, "RCTView", 1, {}, undefined));
    expect(() => host.fake.appendChild(scroll, host.fake.createNode(6, "RCTView", 1, {}, undefined))).toThrow("ScrollView can host only one direct child");
    const loose = createHost({ strict: false });
    const { view: committed } = mount(loose);
    expect(() => loose.fake.appendChild(committed, loose.fake.createNode(3, "RCTView", 1, {}, undefined))).not.toThrow();
  });

  test("measures, dispatches commands and sets native props through the log, and sends events to the handler the host registered", () => {
    const host = createHost();
    const { view } = mount(host);
    host.calls.length = 0;
    const measured: number[][] = [];
    host.fake.measure(view, (...args) => measured.push(args));
    host.fake.measureInWindow(view, (...args) => measured.push(args));
    host.fake.dispatchCommand(view, "focus", [1]);
    host.fake.setNativeProps(view, { a: 1 });
    expect(measured).toEqual([[1, 2, 3, 4, 5, 6], [5, 6, 3, 4]]);
    expect(host.calls).toEqual(["measure 1", "measureInWindow 1", "dispatchCommand 1 focus [1]", 'setNativeProps 1 {"a":1}']);
    const events: unknown[][] = [];
    host.emit("nobody", "topPress");
    host.fake.registerEventHandler((target, type, event) => events.push([target, type, event]));
    host.emit("target", "topLayout", { layout: 1 });
    host.emit("target", "topPress");
    expect(events).toEqual([["target", "topLayout", { layout: 1 }], ["target", "topPress", {}]]);
  });

  test("a test chooses the lines of the log and where they go", () => {
    const shared = ["engine told first"];
    const host = createHost({ calls: shared, describe: (call) => (call.op === "create" ? `create ${call.name}` : call.op === "dispatchCommand" ? `fabric.dispatchCommand ${call.node.name} ${call.command}` : undefined) });
    const { view } = mount(host);
    host.fake.dispatchCommand(view, "blur", []);
    expect(shared).toEqual(["engine told first", "create RCTText", "create RCTView", "fabric.dispatchCommand RCTView blur"]);
    expect(host.calls).toBe(shared);
    host.reset();
    expect(shared).toEqual([]);
    expect(host.roots).toEqual({});
  });

  test("a test can replace a method of the binding, and put it back", () => {
    const host = createHost();
    const { view } = mount(host);
    const original = host.fake.dispatchCommand;
    const commands: string[] = [];
    host.fake.dispatchCommand = (_node: FakeNode, command: string) => { commands.push(command); };
    host.fake.dispatchCommand(view, "focus", []);
    host.fake.dispatchCommand = original;
    expect(commands).toEqual(["focus"]);
  });
});
