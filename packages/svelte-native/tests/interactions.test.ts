import { expect, test } from "bun:test";
import { build } from "esbuild";
import { resolve } from "node:path";
import { drag, draggable, swipe } from "../src/interactions.web.ts";
import { createInteractions, type NativeTarget } from "../src/interactions-core.ts";
import { lowerPrimitives } from "../src/lower.ts";

class PointerNode extends EventTarget {
  style = { touchAction: "auto" };
  captures = new Set<number>();
  setPointerCapture(id: number) { this.captures.add(id); }
  hasPointerCapture(id: number) { return this.captures.has(id); }
  releasePointerCapture(id: number) { this.captures.delete(id); }
  pointer(type: string, x: number, y = 0, id = 1) {
    this.dispatchEvent(Object.assign(new Event(type), { clientX: x, clientY: y, pointerId: id, isPrimary: id === 1, button: 0 }));
  }
  get element() { return this as unknown as HTMLElement; }
}

function nativeMock() {
  const pans: { calls: Record<string, unknown>; handlers: Record<string, (...args: unknown[]) => void> }[] = [];
  const makePan = () => {
    const calls: Record<string, unknown> = {}, handlers: Record<string, (...args: unknown[]) => void> = {};
    const pan = new Proxy({ calls, handlers }, { get(target, key: string) {
      if (key in target) return target[key as keyof typeof target];
      return (...args: unknown[]) => {
        if (key.startsWith("on")) handlers[key] = args[0] as (...args: unknown[]) => void;
        else calls[key] = args;
        return pan;
      };
    } });
    pans.push(pan);
    return pan;
  };
  const props = new Map<string, unknown>();
  const node: NativeTarget = { getProp: key => props.get(key), setProp: (key, value) => { props.set(key, value); }, removeProp: key => { props.delete(key); } };
  return { node, props, pans, ...createInteractions(makePan as unknown as Parameters<typeof createInteractions>[0]) };
}

test("web drag captures one pointer, applies threshold and axis, and restores styles", () => {
  const node = new PointerNode(), seen: unknown[] = [];
  const action = drag(node.element, { axis: "x", onstart: () => seen.push("start"), onmove: p => seen.push(p), onend: p => seen.push(["end", p]) });
  expect(node.style.touchAction).toBe("pan-y");
  node.pointer("pointerdown", 10, 10);
  node.pointer("pointermove", 13, 11);
  expect(seen).toEqual([]);
  node.pointer("pointermove", 25, 12);
  node.pointer("pointermove", 200, 0, 2);
  node.pointer("pointerup", 30, 12);
  expect(seen).toEqual(["start", { x: 15, y: 0 }, { x: 20, y: 0 }, ["end", { x: 20, y: 0 }]]);
  expect(node.captures.size).toBe(0);
  action.destroy();
  expect(node.style.touchAction).toBe("auto");
  node.pointer("pointerdown", 0); node.pointer("pointermove", 50);
  expect(seen).toHaveLength(4);
});

test("cross-axis scroll wins before activation; cancellation and lost capture never commit", () => {
  const node = new PointerNode(); let starts = 0, ends = 0, cancels = 0;
  const action = drag(node.element, { axis: "x", onstart: () => starts++, onend: () => ends++, oncancel: () => cancels++ });
  node.pointer("pointerdown", 0); node.pointer("pointermove", 1, 20); node.pointer("pointerup", 100, 20);
  expect(starts).toBe(0); expect(node.captures.size).toBe(0);
  for (const event of ["pointercancel", "lostpointercapture"]) {
    node.pointer("pointerdown", 0); node.pointer("pointermove", 20); node.pointer(event, 20); node.pointer("pointerup", 40);
  }
  expect(starts).toBe(2); expect(cancels).toBe(2); expect(ends).toBe(0);
  action.destroy();
});

test("invalid updates preserve an active drag; valid updates cancel and disabled drags do not block scrolling", () => {
  const node = new PointerNode(); let cancels = 0, ends = 0;
  const action = drag(node.element, { oncancel: () => cancels++, onend: () => ends++ });
  node.pointer("pointerdown", 0); node.pointer("pointermove", 20);
  expect(() => action.update({ threshold: NaN })).toThrow(RangeError);
  expect(cancels).toBe(0); expect(node.captures.size).toBe(1);
  node.pointer("pointerup", 30); expect(ends).toBe(1);
  node.pointer("pointerdown", 0); node.pointer("pointermove", 20);
  action.update({ disabled: true });
  expect(cancels).toBe(1); expect(node.style.touchAction).toBe("auto");
  node.pointer("pointerdown", 0); expect(node.captures.size).toBe(0);
  action.destroy(); action.update({}); expect(node.style.touchAction).toBe("auto");
});

test("attachment cleanup and swipe direction/distance share drag cancellation", () => {
  const node = new PointerNode(), directions: string[] = [];
  const detach = draggable()(node.element);
  detach(); expect(node.style.touchAction).toBe("auto");
  const action = swipe(node.element, { onswipe: d => directions.push(d) });
  node.pointer("pointerdown", 0); node.pointer("pointermove", -20); node.pointer("pointerup", -30);
  expect(directions).toEqual([]);
  expect(() => action.update({ onswipe() {}, distance: 0 })).toThrow(RangeError);
  node.pointer("pointerdown", 0); node.pointer("pointermove", -55); node.pointer("pointerup", -60);
  expect(directions).toEqual(["left"]);
  node.pointer("pointerdown", 0); node.pointer("pointermove", 60); node.pointer("pointercancel", 60);
  expect(directions).toEqual(["left"]);
  action.destroy();
});

test("native callbacks from replaced/destroyed recognizers cannot mutate a new drag", () => {
  const m = nativeMock(), seen: unknown[] = [];
  const action = m.drag(m.node, { axis: "x", onstart: () => seen.push("old"), oncancel: () => seen.push("cancel") });
  const old = m.pans[0]!;
  expect(old.calls.runOnJS).toEqual([true]); expect(old.calls.maxPointers).toEqual([1]);
  old.handlers.onStart!();
  expect(() => action.update({ threshold: -1 })).toThrow(RangeError);
  expect(m.props.get("gesture")).toBe(old);
  action.update({ onstart: () => seen.push("new"), onend: p => seen.push(p) });
  const fresh = m.pans[1]!;
  fresh.handlers.onStart!();
  old.handlers.onStart!(); old.handlers.onUpdate!({ translationX: 99, translationY: 99 });
  old.handlers.onEnd!({ translationX: 99, translationY: 99 }, true); old.handlers.onFinalize!();
  fresh.handlers.onEnd!({ translationX: 12, translationY: 3 }, true);
  expect(seen).toEqual(["old", "cancel", "new", { x: 12, y: 3 }]);
  action.destroy();
  fresh.handlers.onStart!(); fresh.handlers.onEnd!({ translationX: 50, translationY: 50 }, true);
  expect(m.props.has("gesture")).toBe(false); expect(seen).toHaveLength(4);
});

test("native gesture ownership is not silently overwritten or removed", () => {
  const m = nativeMock(); const external = {};
  m.props.set("gesture", external);
  expect(() => m.drag(m.node)).toThrow("owns");
  m.props.delete("gesture");
  const action = m.drag(m.node);
  m.props.set("gesture", external); action.destroy();
  expect(m.props.get("gesture")).toBe(external);
});

test("portable subpath browser bundle excludes every native dependency", async () => {
  const result = await build({ stdin: { contents: "export { drag, swipe, draggable } from '@alfayez/svelte-native/interactions';", resolveDir: resolve(import.meta.dirname, "..") }, bundle: true, platform: "browser", format: "esm", write: false, metafile: true });
  expect(Object.keys(result.metafile!.inputs).every(path => /interactions(?:-core|\.web)?\.ts$/.test(path) || path === "<stdin>")).toBe(true);
  expect(result.outputFiles[0]!.text).not.toContain("react-native");
});

test("lowering recognizes aliased drag/swipe actions on native primitives", () => {
  const warnings: string[] = [];
  const result = lowerPrimitives(`<script>import { View } from '@alfayez/svelte-native'; import { drag as move, swipe } from '@alfayez/svelte-native/interactions';</script><View use:move use:swipe={{onswipe(){}}} />`, { warn: message => warnings.push(message) });
  expect(result).toContain("native-view"); expect(result).toContain("use:move"); expect(warnings).toEqual([]);
});

test("callbacks may destroy an action during start without a trailing move", () => {
  const node = new PointerNode(); let moves = 0, cancelled = 0;
  const action = drag(node.element, { onstart: () => action.destroy(), onmove: () => moves++, oncancel: () => cancelled++ });
  node.pointer("pointerdown", 0); node.pointer("pointermove", 20);
  expect(moves).toBe(0); expect(cancelled).toBe(1); expect(node.captures.size).toBe(0);
  expect(node.style.touchAction).toBe("auto");
});

test("a cancellation callback's update wins over the outer update", () => {
  const m = nativeMock(); let starts = 0;
  const action = m.drag(m.node, { oncancel: () => action.update({ onstart: () => starts++ }) });
  m.pans[0]!.handlers.onStart!();
  action.update({ disabled: true });
  expect(m.pans).toHaveLength(2);
  m.pans[1]!.handlers.onStart!();
  expect(starts).toBe(1);
  action.destroy();
});
