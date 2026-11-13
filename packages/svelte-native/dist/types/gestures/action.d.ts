import type { GestureAttribute } from "./types.js";
/**
 * `use:gesture={pan}`: the `gesture` attribute as an action, for hand-written host tags and for the primitives the lowering turns
 * into them (`<View use:gesture={pan}>`). It sets the attribute, follows the value, and removes it when the element is destroyed.
 * A component cannot take a `use:` directive (`AnimatedView`, or a primitive the lowering leaves a component): give those `gesture={pan}`.
 * A newer action/attachment or direct attribute replacement takes ownership: the old handle cannot update or remove its gesture.
 * Use one owner per element and `Gesture.Race`, `Gesture.Simultaneous` or `Gesture.Exclusive` to compose recognizers.
 */
export declare function gesture(node: object, value: GestureAttribute | undefined): {
    update(next: GestureAttribute | undefined): void;
    destroy(): void;
};
/**
 * Svelte attachment: `<View {@attach gestureAttachment(pan)} />`. Reactive arguments reattach automatically; cleanup releases
 * only this attachment's gesture. Accepts the same recognizer or composition as `gesture={pan}` and `use:gesture={pan}`.
 * Native hosts only; this does not turn RNGH gestures into browser pointer listeners. Use `/interactions` for portable drag/swipe.
 */
export declare function gestureAttachment(value: GestureAttribute | undefined): (node: object) => (() => void);
