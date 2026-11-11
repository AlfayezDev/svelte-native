import { afterEach, expect, jest, test } from "bun:test";
import { type FakeNode, all, emit, host, load, settle } from "./html-harness.ts";

// A press on HTML elements: `onclick` is `onPress` (`lower-html.ts`), and a link inside a paragraph is a pressable nested Text (a span, which the Android engine finds under the finger and
// dispatches the touch to: the target of the touch is that node) with the role `link`. The responder starts from the node the touch names and walks up the tree.

const globals = globalThis as { __opened?: string[] };
let nextRoot = 700;

async function setup() {
  jest.useFakeTimers();
  const m = await load("html-press-fixture.svelte");
  host.roots = {};
  globals.__opened = [];
  const log: string[] = [];
  const root = nextRoot++;
  const app = m.startSurface(root, m.Fixture, { log: (entry: string) => log.push(entry) }) as { setGate: (open: boolean) => void; setWords: (shown: boolean) => void };
  const find = (testID: string): FakeNode => {
    const node = all(host.roots[root] ?? []).find((candidate) => candidate.props.testID === testID);
    if (!node) throw new Error(`no node ${testID}`);
    return node;
  };
  let clock = 1000;
  const sendTo = (target: unknown, type: string, x = 10, y = 10) => {
    const touch = { pageX: x, pageY: y, locationX: x, locationY: y, identifier: 0, target: 1, timestamp: clock++ };
    const lifting = type === "topTouchEnd" || type === "topTouchCancel";
    emit(target, type, { ...touch, touches: lifting ? [] : [touch], changedTouches: [touch] });
  };
  /** A tap: down, up, and the time the press stays active. */
  const tap = (testID: string) => {
    const target = find(testID).target;
    sendTo(target, "topTouchStart");
    sendTo(target, "topTouchEnd");
    jest.advanceTimersByTime(300);
  };
  return { m, log, app, find, root, tap, sendTo, settle: () => settle(m), tree: () => host.roots[root] ?? [] };
}

afterEach(() => { jest.useRealTimers(); });

test("an HTML element whose onclick is undefined is no responder: the press goes to the nearest element above it that has one, and back when the handler is a function again", async () => {
  const t = await setup();
  for (const id of ["div", "span"]) {
    t.tap(id);
    expect(t.log).toEqual([`${id}.press`]);
    t.log.length = 0;
  }
  t.app.setGate(false);
  await t.settle();
  for (const id of ["div", "span"]) {
    t.tap(id);
    expect(t.log).toEqual(["root.press"]);
    t.log.length = 0;
  }
  t.app.setGate(true);
  await t.settle();
  t.tap("div");
  expect(t.log).toEqual(["div.press"]);
});

test("an onclick that comes from a spread goes away with it too", async () => {
  const t = await setup();
  t.tap("spread");
  expect(t.log).toEqual(["spread.press"]);
  t.log.length = 0;
  t.app.setGate(false);
  await t.settle();
  t.tap("spread");
  expect(t.log).toEqual(["root.press"]);
});

test("a button is a button whatever its onclick is: it is pressed, and runs the handler only when there is one", async () => {
  const t = await setup();
  t.tap("button");
  expect(t.log).toEqual(["button.press"]);
  t.log.length = 0;
  t.app.setGate(false);
  await t.settle();
  t.tap("button");
  expect(t.log).toEqual([]);
});

test("a link in a paragraph is a pressable nested Text with the role link: a press on it runs its onclick and opens its href, and is not the paragraph's", async () => {
  const t = await setup();
  const link = t.find("link");
  expect(link.name).toBe("RCTVirtualText");
  expect(link.props.accessibilityRole).toBe("link");
  expect(t.find("para").name).toBe("RCTText");
  // The link is a child of the paragraph's text: the engine finds it under the finger (it is a fragment of the paragraph's state) and dispatches the touch to it.
  expect(t.find("para").children.includes(link)).toBe(true);
  t.tap("link");
  expect(t.log).toEqual(["link.press"]);
  expect(globals.__opened).toEqual(["mailto:a@b.c"]);
  t.log.length = 0;
  t.tap("para");
  expect(t.log).toEqual(["para.press"]);
  expect(globals.__opened).toEqual(["mailto:a@b.c"]);
});

test("a link whose onclick is undefined still follows its href, and is not the paragraph's press; an inline element whose onclick is undefined hands its press to the paragraph", async () => {
  const t = await setup();
  t.app.setGate(false);
  await t.settle();
  t.tap("link");
  expect(t.log).toEqual([]);
  expect(globals.__opened).toEqual(["mailto:a@b.c"]);
  t.tap("inner");
  expect(t.log).toEqual(["para.press"]);
});

test("an inline element among the words of a view (a run) is a span of the text that holds them, and keeps its press when the words around it go and come back", async () => {
  const t = await setup();
  expect(t.find("runSpan").name).toBe("RCTVirtualText");
  t.tap("runSpan");
  expect(t.log).toEqual(["runSpan.press"]);
  t.log.length = 0;
  // The words go: the span is the only thing in the run, and is drawn as a text of its own (made again, with another tag): its press is still its own.
  const before = t.find("runSpan").tag;
  t.app.setWords(false);
  await t.settle();
  expect(t.find("runSpan").name).toBe("RCTText");
  expect(t.find("runSpan").tag).not.toBe(before);
  t.tap("runSpan");
  expect(t.log).toEqual(["runSpan.press"]);
  t.log.length = 0;
  t.app.setWords(true);
  await t.settle();
  expect(t.find("runSpan").name).toBe("RCTVirtualText");
  t.tap("runSpan");
  expect(t.log).toEqual(["runSpan.press"]);
  t.tap("run");
  expect(t.log).toEqual(["runSpan.press", "run.press"]);
});

test("a link that is all of its view (not among text) is a pressable view: it follows its href, and its press is not the view's around it", async () => {
  const t = await setup();
  expect(t.find("boxLink").name).toBe("RCTView");
  expect(t.find("boxLink").props.accessibilityRole).toBe("link");
  t.tap("boxLink");
  expect(t.log).toEqual(["boxLink.press"]);
  expect(globals.__opened).toEqual(["mailto:r@b.c"]);
});

test("a touch that moves off a link is cancelled by the region of the text that holds it", async () => {
  const t = await setup();
  const measured: string[] = [];
  const fakeBinding = (globalThis as { nativeFabricUIManager?: { measure: (node: FakeNode, callback: (...args: number[]) => void) => void } }).nativeFabricUIManager;
  if (!fakeBinding) throw new Error("no fake binding");
  const measure = fakeBinding.measure;
  // Fabric has no frame for a Text nested in a Text: `measure` calls back with nothing, and the paragraph's answers.
  fakeBinding.measure = (node, callback) => { measured.push(node.name); if (node.name === "RCTVirtualText") callback(); else callback(0, 0, 100, 40, 0, 0); };
  try {
    const target = t.find("link").target;
    t.sendTo(target, "topTouchStart", 50, 20);
    expect(measured).toContain("RCTText");
    t.sendTo(target, "topTouchMove", 50, 300);
    t.sendTo(target, "topTouchEnd", 50, 300);
    jest.advanceTimersByTime(500);
    expect(t.log).toEqual([]);
    expect(globals.__opened).toEqual([]);
  } finally {
    fakeBinding.measure = measure;
  }
});
