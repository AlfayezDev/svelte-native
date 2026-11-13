/** Portable JS-thread interactions for ordinary Svelte state. Import this subpath on web to avoid native component imports. */
export type DragPoint = {
    x: number;
    y: number;
};
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
export type SwipeDirection = "left" | "right" | "up" | "down";
export type SwipeOptions = Omit<DragOptions, "onend"> & {
    distance?: number;
    onswipe: (direction: SwipeDirection) => void;
};
/** Shared pointer lifecycle. Native builds provide a lazy RNGH pan factory; web never loads native code. */
export declare function createInteractions(makePan?: () => ReturnType<typeof import("./gestures/index.js").Gesture.Pan>): {
    drag: (node: Target, initial?: DragOptions) => {
        update(next: DragOptions): void;
        destroy(): void;
    };
    draggable: (options?: DragOptions) => (node: Target) => () => void;
    swipe: (node: Target, initial: SwipeOptions) => {
        update: (next: SwipeOptions) => void;
        destroy: () => void;
    };
};
export {};
