export type { DragPoint, DragOptions, SwipeDirection, SwipeOptions } from "./interactions-core.js";
export declare const drag: (node: HTMLElement | import("./interactions-core.js").NativeTarget, initial?: import("./interactions-core.js").DragOptions) => {
    update(next: import("./interactions-core.js").DragOptions): void;
    destroy(): void;
}, draggable: (options?: import("./interactions-core.js").DragOptions) => (node: HTMLElement | import("./interactions-core.js").NativeTarget) => () => void, swipe: (node: HTMLElement | import("./interactions-core.js").NativeTarget, initial: import("./interactions-core.js").SwipeOptions) => {
    update: (next: import("./interactions-core.js").SwipeOptions) => void;
    destroy: () => void;
};
