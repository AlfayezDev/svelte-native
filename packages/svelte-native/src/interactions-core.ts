/** Portable JS-thread interactions for ordinary Svelte state. Import this subpath on web to avoid native component imports. */
export type DragPoint = { x: number; y: number };
export type DragOptions = {
  axis?: "x" | "y" | "both";
  threshold?: number;
  disabled?: boolean;
  onstart?: () => void;
  onmove?: (translation: DragPoint) => void;
  onend?: (translation: DragPoint) => void;
  oncancel?: () => void;
};
export type NativeTarget = {
  setProp(key: string, value: unknown): void;
  removeProp(key: string): void;
  getProp(key: string): unknown;
};
type Target = HTMLElement | NativeTarget;
const native = (node: Target): node is NativeTarget => "setProp" in node;

export type SwipeDirection = "left" | "right" | "up" | "down";
export type SwipeOptions = Omit<DragOptions, "onend"> & {
  distance?: number;
  onswipe: (direction: SwipeDirection) => void;
};

/** Shared pointer lifecycle. Native builds provide a lazy RNGH pan factory; web never loads native code. */
export function createInteractions(makePan?: () => ReturnType<typeof import("./gestures/index.ts").Gesture.Pan>) {
  /** Svelte action: `use:drag={{ axis: "x", onmove: p => x = p.x }}`. Callbacks always run on JS, never in a worklet. */
  function drag(node: Target, initial: DragOptions = {}) {
    const validate = (value: DragOptions): DragOptions => {
      const threshold = value.threshold ?? 8;
      if (!Number.isFinite(threshold) || threshold < 0) throw new RangeError("drag threshold must be a finite nonnegative number");
      if (value.axis !== undefined && !["x", "y", "both"].includes(value.axis)) throw new RangeError("drag axis must be x, y or both");
      return { ...value };
    };
    let options = validate(initial);
    let generation = 0;
    let active = false;
    let last = { x: 0, y: 0 };
    let disposed = false;
    const axisPoint = (x: number, y: number) => ({ x: options.axis === "y" ? 0 : x, y: options.axis === "x" ? 0 : y });
    const start = () => { if (!disposed && !options.disabled && !active) { active = true; last = { x: 0, y: 0 }; options.onstart?.(); } };
    const move = (x: number, y: number) => { if (active && !disposed) { last = axisPoint(x, y); options.onmove?.(last); } };
    const finish = (success: boolean) => {
      if (!active) return;
      active = false;
      if (success) options.onend?.(last); else options.oncancel?.();
    };
    let release = () => {};
    const install = () => {
      const threshold = options.threshold ?? 8;
      const installed = ++generation;
      const current = () => !disposed && generation === installed;
      if (native(node)) {
        if (node.getProp("gesture") !== undefined) throw new Error("drag owns this element's gesture; use a separate handle or Gesture composition");
        if (!makePan) throw new Error("native drag requires the native interactions entry");
        const pan = makePan().runOnJS(true).enabled(!options.disabled).maxPointers(1);
        if (options.axis === "x") pan.activeOffsetX([-threshold, threshold]).failOffsetY([-threshold, threshold]);
        else if (options.axis === "y") pan.activeOffsetY([-threshold, threshold]).failOffsetX([-threshold, threshold]);
        else pan.minDistance(threshold);
        pan.onStart(() => { if (current()) start(); }).onUpdate(e => { if (current()) move(e.translationX, e.translationY); }).onEnd((e, success) => {
          if (!current()) return;
          if (success) move(e.translationX, e.translationY);
          if (current()) finish(success);
        }).onFinalize(() => { if (current()) finish(false); });
        node.setProp("gesture", pan);
        release = () => { generation++; if (node.getProp("gesture") === pan) node.removeProp("gesture"); };
        return;
      }
      const previousTouchAction = node.style.touchAction;
      const touchAction = options.disabled ? previousTouchAction : options.axis === "x" ? "pan-y" : options.axis === "y" ? "pan-x" : "none";
      node.style.touchAction = touchAction;
      let pointer: number | undefined;
      let origin = { x: 0, y: 0 };
      const reset = () => {
        const id = pointer;
        pointer = undefined;
        if (id !== undefined && node.hasPointerCapture(id)) node.releasePointerCapture(id);
      };
      const down = (e: PointerEvent) => {
        if (!current() || options.disabled || pointer !== undefined || !e.isPrimary || e.button !== 0) return;
        pointer = e.pointerId;
        origin = { x: e.clientX, y: e.clientY };
        node.setPointerCapture(e.pointerId);
      };
      const update = (e: PointerEvent) => {
        if (!current() || pointer !== e.pointerId) return;
        const x = e.clientX - origin.x, y = e.clientY - origin.y;
        if (!active) {
          if ((options.axis === "x" && Math.abs(y) > threshold) || (options.axis === "y" && Math.abs(x) > threshold)) { reset(); return; }
          const distance = options.axis === "x" ? Math.abs(x) : options.axis === "y" ? Math.abs(y) : Math.hypot(x, y);
          if (distance < threshold) return;
          start();
        }
        if (current()) move(x, y);
      };
      const up = (e: PointerEvent) => { if (current() && pointer === e.pointerId) { if (active) move(e.clientX - origin.x, e.clientY - origin.y); reset(); if (current()) finish(true); } };
      const cancel = (e: PointerEvent) => { if (current() && pointer === e.pointerId) { reset(); finish(false); } };
      node.addEventListener("pointerdown", down);
      node.addEventListener("pointermove", update);
      node.addEventListener("pointerup", up);
      node.addEventListener("pointercancel", cancel);
      node.addEventListener("lostpointercapture", cancel);
      release = () => {
        generation++;
        reset();
        node.removeEventListener("pointerdown", down);
        node.removeEventListener("pointermove", update);
        node.removeEventListener("pointerup", up);
        node.removeEventListener("pointercancel", cancel);
        node.removeEventListener("lostpointercapture", cancel);
        if (node.style.touchAction === touchAction) node.style.touchAction = previousTouchAction;
      };
    };
    install();
    return {
      update(next: DragOptions) {
        if (disposed) return;
        const validated = validate(next); // Invalid updates leave the current interaction intact.
        release();
        const released = generation;
        finish(false);
        if (disposed || generation !== released) return; // A callback may destroy or update the action.
        options = validated;
        install();
      },
      destroy() { if (disposed) return; disposed = true; release(); finish(false); },
    };
  }

  /** Svelte attachment form: `{@attach draggable({ onmove: p => x = p.x })}`. Reactive options are reattached by Svelte. */
  function draggable(options: DragOptions = {}) {
    return (node: Target) => { const action = drag(node, options); return () => action.destroy(); };
  }

  /** A committed swipe, with cancellation and scroll arbitration inherited from drag. Supply visible buttons for every swipe-only action. */
  function swipe(node: Target, initial: SwipeOptions) {
    const asDrag = (options: SwipeOptions): DragOptions => {
      const distance = options.distance ?? 48;
      if (!Number.isFinite(distance) || distance <= 0) throw new RangeError("swipe distance must be finite and positive");
      options = { ...options };
      return { ...options, axis: options.axis ?? "x", onend: ({ x, y }) => {
        if (Math.max(Math.abs(x), Math.abs(y)) < distance) return;
        options.onswipe(Math.abs(x) >= Math.abs(y) ? x < 0 ? "left" : "right" : y < 0 ? "up" : "down");
      } };
    };
    const action = drag(node, asDrag(initial));
    return { update: (next: SwipeOptions) => action.update(asDrag(next)), destroy: action.destroy };
  }

  return { drag, draggable, swipe };
}
