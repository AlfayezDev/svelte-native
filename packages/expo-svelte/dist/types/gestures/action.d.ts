import type { GestureAttribute } from "./types.js";
/**
 * `use:gesture={pan}`: the `gesture` attribute as an action, for hand-written host tags and for the primitives the lowering turns
 * into them (`<View use:gesture={pan}>`). It sets the attribute, follows the value, and removes it when the element is destroyed.
 * A component cannot take a `use:` directive (`AnimatedView`, or a primitive the lowering leaves a component): give those `gesture={pan}`.
 */
export declare function gesture(node: object, value: GestureAttribute | undefined): {
    update(next: GestureAttribute | undefined): void;
    destroy(): void;
};
