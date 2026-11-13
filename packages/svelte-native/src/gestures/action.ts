import type { GestureAttribute } from "./types.ts";

// Structural only: importing the helpers must not load the renderer or gesture runtime.
type HostNode = { setProp(key: string, value: unknown): void; removeProp(key: string): void; getProp(key: string): unknown };
const owners = new WeakMap<object, symbol>();

/**
 * `use:gesture={pan}`: the `gesture` attribute as an action, for hand-written host tags and for the primitives the lowering turns
 * into them (`<View use:gesture={pan}>`). It sets the attribute, follows the value, and removes it when the element is destroyed.
 * A component cannot take a `use:` directive (`AnimatedView`, or a primitive the lowering leaves a component): give those `gesture={pan}`.
 * A newer action/attachment or direct attribute replacement takes ownership: the old handle cannot update or remove its gesture.
 * Use one owner per element and `Gesture.Race`, `Gesture.Simultaneous` or `Gesture.Exclusive` to compose recognizers.
 */
export function gesture(node: object, value: GestureAttribute | undefined) {
  const host = node as HostNode;
  const token = Symbol();
  let disposed = false;
  let current = value;
  host.setProp("gesture", current);
  owners.set(node, token);
  const owns = () => owners.get(node) === token && host.getProp("gesture") === current;
  return {
    update(next: GestureAttribute | undefined) {
      if (disposed || !owns()) return;
      current = next;
      host.setProp("gesture", next);
    },
    destroy() {
      if (disposed) return;
      disposed = true;
      if (owns()) host.removeProp("gesture");
      if (owners.get(node) === token) owners.delete(node);
    },
  };
}

/**
 * Svelte attachment: `<View {@attach gestureAttachment(pan)} />`. Reactive arguments reattach automatically; cleanup releases
 * only this attachment's gesture. Accepts the same recognizer or composition as `gesture={pan}` and `use:gesture={pan}`.
 * Native hosts only; this does not turn RNGH gestures into browser pointer listeners. Use `/interactions` for portable drag/swipe.
 */
export function gestureAttachment(value: GestureAttribute | undefined) {
  return (node: object): (() => void) => gesture(node, value).destroy;
}
