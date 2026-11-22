import type { Component, Snippet } from "svelte";
import type { ExpoViewHandle } from "../fabric/foreign-expo-view.js";
/**
 * The props of a component made by `defineExpoView`: the library's own props type with what a React type says in React's terms
 * taken out and said in Svelte's (`children` is a `Snippet`, `ref` is a function that receives the handle, with the view's functions
 * typed as `Methods`). `style` and the event handlers are the library's own types.
 */
export type ExpoViewProps<Props extends object, Methods extends object = Record<never, never>> = Omit<Props, "children" | "ref" | "key"> & {
    children?: Snippet;
    /** Receives the host handle with the view's native functions, or null on unmount. */
    ref?: (handle: ExpoViewHandle<Methods> | null) => void;
};
/**
 * The component of an Expo module's view, typed by the library's own props: `const CameraView = defineExpoView<CameraNativeProps, CameraViewRef>("ExpoCamera")`
 * once, `<CameraView facing="back" />` wherever it is shown. It is `ExpoView` with the module and the view fixed: a `module` or `view`
 * prop is ignored, so a view's own prop of that name cannot be set through it, as through `ExpoView`. Nothing native is read until the
 * component is shown, so the call is safe at the top of a module.
 *
 * A Svelte 5 component is a function of the parent's anchor and its props object, whose properties are getters; the wrapper hands
 * `ExpoView` a proxy of that object that answers `module` and `view` itself and everything else from the original, so every prop stays
 * as reactive as it was.
 *
 * @param module The native module's name (`ExpoCamera`), the first argument of `requireNativeViewManager`.
 * @param view The view's name when the module has several; none for its only view, as in the library's own call.
 */
export declare function defineExpoView<Props extends object, Methods extends object = Record<never, never>>(module: string, view?: string): Component<ExpoViewProps<Props, Methods>>;
