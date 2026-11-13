/**
 * The window's size, reactive, like `colorScheme.current`: a template, `$derived` or `$effect` that reads it runs again when the window changes
 * (the device turns, a foldable opens, split screen, the font scale changes).
 *
 *   const wide = $derived(windowSize.width >= 768);
 *
 * `width` and `height` are the window's, in points (dp); `scale` is the pixel ratio, `fontScale` the system's text size, and `screen` the
 * whole screen's size. Svelte's own `innerWidth`, `innerHeight` and `devicePixelRatio` (`svelte/reactivity/window`) read the same values.
 */
export declare const windowSize: {
    readonly width: number;
    readonly height: number;
    readonly scale: number;
    readonly fontScale: number;
    readonly screen: {
        width: number;
        height: number;
    };
};
