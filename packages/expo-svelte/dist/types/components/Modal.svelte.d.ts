import { type Snippet } from "svelte";
import type { ClassProps } from "../classes.js";
import type { ModalProps } from "react-native";
type $$ComponentProps = Omit<ModalProps, "children"> & {
    children?: Snippet;
    /** HTML's name for `visible` (an `<dialog open>`, written by the lowering of HTML elements): `bind:open` is set to `false` when the platform closes the modal (the Back key, a swipe). */
    open?: boolean;
    /** HTML's name for `onRequestClose`. The lowering renames an `onclose` written on a `<dialog>`; one that comes in a spread (`<dialog {...rest}>`) arrives as it is. */
    onclose?: ModalProps["onRequestClose"];
    /** Set by the lowering of an HTML `<dialog>`: the text bare in it is drawn, and its class and style are the text style of what is in it (`fabric/text-inherit.ts`). */
    nativeHtml?: boolean;
} & ClassProps;
declare const Modal: import("svelte").Component<$$ComponentProps, {}, "open">;
type Modal = ReturnType<typeof Modal>;
export default Modal;
