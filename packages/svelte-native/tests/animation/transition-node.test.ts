import { afterEach, expect, test } from "bun:test";
import { NativeNode, setAnimationDriver, setInvalidationSink, type AnimationDriver } from "../../src/renderer.ts";

// What a native element offers the code Svelte compiles for `transition:`, `in:`, `out:` and `animate:` (element.style, dispatchEvent, getComputedStyle, getBoundingClientRect,
// element.animate), without a host. That the compiled component reaches for them on a lowered tag is `compiler/lowering-boundaries.test.ts`.

afterEach(() => {
  setAnimationDriver(null);
  setInvalidationSink(null);
});

test("node.style keeps what Svelte writes (overflow, position, size, transform) and tells the host once per change; an empty value removes it", () => {
  const node = new NativeNode("element", "native-view");
  const told: string[] = [];
  setInvalidationSink((_, reason) => told.push(reason));
  expect(node.style.overflow).toBe("");
  node.style.overflow = "hidden";
  node.style.position = "absolute";
  node.style.width = "100px";
  node.style.transform = "translate(1px, 2px)";
  expect(node.dom?.inline).toEqual({ overflow: "hidden", position: "absolute", width: "100px", transform: "translate(1px, 2px)" });
  expect(told).toEqual(["props", "props", "props", "props"]);
  node.style.overflow = "hidden"; // no change, no word
  expect(told).toHaveLength(4);
  node.style.overflow = "";
  node.style.height = undefined as never;
  expect(node.style.overflow).toBe("");
  expect(node.style.getPropertyValue("position")).toBe("absolute");
  expect(node.style.removeProperty("position")).toBe("absolute");
  node.style.setProperty("width", null);
  node.style.transform = "";
  expect(node.dom?.inline).toBeNull();
  // the node's own attributes are not touched
  node.setProp("nativeStyle", { padding: 1 });
  expect(node.peekProps()).toEqual({ nativeStyle: { padding: 1 } });
});

test("an inert node takes no touches: element.inert is pointerEvents none over the node's own style", () => {
  const node = new NativeNode("element", "native-view");
  const told: string[] = [];
  setInvalidationSink((_, reason) => told.push(reason));
  expect(node.inert).toBe(false);
  node.inert = false; // what a transition does when it starts, with the value it read
  expect(told).toEqual([]);
  node.inert = true;
  expect(node.inert).toBe(true);
  expect(node.dom?.inline).toEqual({ pointerEvents: "none" });
  node.inert = false;
  expect(node.dom?.inline).toBeNull();
  expect(told).toEqual(["props", "props"]);
});

test("dispatchEvent calls the listeners of the event's type, which is how introstart and outroend reach the element's handlers", () => {
  const node = new NativeNode("element", "native-view");
  const seen: unknown[] = [];
  node.listeners = new Map([["introstart", new Set([(event: unknown) => seen.push(event)])]]);
  const event = new CustomEvent("introstart");
  expect(node.dispatchEvent(event)).toBe(true);
  expect(node.dispatchEvent(new CustomEvent("outroend"))).toBe(true);
  expect(seen).toEqual([event]);
});

test("without a host the node answers with no layout, no animations, and an animation that finishes at once, so an outro still ends", async () => {
  const node = new NativeNode("element", "native-view");
  const rect = node.getBoundingClientRect();
  expect([rect.left, rect.top, rect.right, rect.bottom, rect.width, rect.height]).toEqual([0, 0, 0, 0, 0, 0]);
  expect([node.clientWidth, node.clientHeight]).toEqual([0, 0]);
  expect(node.getAnimations()).toEqual([]);
  const animation = node.animate([{ opacity: "1" }, { opacity: "0" }], { duration: 400, fill: "forwards" });
  let finished = 0;
  animation.onfinish = () => { finished++; };
  expect(animation.playState).toBe("running");
  await Promise.resolve();
  expect(finished).toBe(1);
  expect(animation.playState).toBe("finished");
  const cancelled = node.animate([], { duration: 1 });
  let late = 0;
  cancelled.onfinish = () => { late++; };
  cancelled.cancel();
  cancelled.effect = null;
  await Promise.resolve();
  expect(late).toBe(0);
  expect(cancelled.playState).toBe("idle");
});

test("the global getComputedStyle answers for a node, from its own style, and does not fail for anything else", () => {
  expect(typeof getComputedStyle).toBe("function");
  const node = new NativeNode("element", "native-view");
  node.setProp("nativeStyle", { opacity: 0.25, transform: [{ rotate: "10deg" }] });
  const style = getComputedStyle(node as never);
  expect(style.opacity).toBe("0.25");
  expect(style.transform).toBe("rotate(10deg)");
  expect(+style.opacity).toBe(0.25);
  expect(style.transform === "none" ? "" : style.transform).toBe("rotate(10deg)");
  expect(getComputedStyle(null as never).opacity).toBe("1");
});

test("the layout a node reports is the host's, with the zoom a flip asks for answered here", () => {
  let forgot = 0;
  const driver: AnimationDriver = {
    animate: () => { throw new Error("not used"); },
    getAnimations: () => [],
    layout: () => ({ x: 10, y: 20, width: 100, height: 40 }),
    size: () => ({ width: 100, height: 40 }),
    forget: () => { forgot++; },
  };
  setAnimationDriver(driver);
  const node = new NativeNode("element", "native-view");
  const rect = node.getBoundingClientRect();
  expect([rect.left, rect.top, rect.right, rect.bottom, rect.width, rect.height]).toEqual([10, 20, 110, 60, 100, 40]);
  expect([node.clientWidth, node.clientHeight]).toEqual([100, 40]);
  expect("currentCSSZoom" in node).toBe(true);
  expect(node.currentCSSZoom).toBe(1);
  const style = getComputedStyle(node as never);
  expect([style.width, style.height, style.transformOrigin]).toEqual(["100px", "40px", "50px 20px"]);
  // flip's reading of it: the origin as a share of the size
  const [ox, oy] = style.transformOrigin.split(" ").map(parseFloat);
  expect([(ox as number) / node.clientWidth, (oy as number) / node.clientHeight]).toEqual([0.5, 0.5]);
  expect(node.getAnimations()).toEqual([]); // nothing animates it
  // `transition:draw` asks an SVG path for its length; a native element has none to give, and the transition degrades instead of throwing.
  expect(node.getTotalLength()).toBe(0);
  expect([style.strokeLinecap, style.strokeWidth]).toEqual(["butt", "0"]);
  node.forgetAnimated();
  expect(forgot).toBe(1);
});
