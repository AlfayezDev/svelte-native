import type { GestureAttribute } from "./types.ts";

// The host node the action receives, by what it uses of it (`NativeNode` in renderer.ts; not imported, so that a type-check of an app
// that uses the action does not pull the renderer module in).
type HostNode = { setProp(key: string, value: unknown): void; removeProp(key: string): void };

/**
 * `use:gesture={pan}`: the `gesture` attribute as an action, for hand-written host tags and for the primitives the lowering turns
 * into them (`<View use:gesture={pan}>`). It sets the attribute, follows the value, and removes it when the element is destroyed.
 * A component cannot take a `use:` directive (`AnimatedView`, or a primitive the lowering leaves a component): give those `gesture={pan}`.
 */
export function gesture(node: object, value: GestureAttribute | undefined) {
  const host = node as HostNode;
  host.setProp("gesture", value);
  return {
    update(next: GestureAttribute | undefined) { host.setProp("gesture", next); },
    destroy() { host.removeProp("gesture"); },
  };
}
