import type { Snippet } from "svelte";
import type { ViewProps } from "react-native";
import type { ClassProps } from "../classes.js";
import type { HostHandle } from "../fabric/host.js";
type $$ComponentProps = Omit<ViewProps, "children"> & ClassProps & {
    children?: Snippet;
    /** Extra translation (dp) added to the keyboard's, `closed` while the keyboard is closed and `opened` while it is open, in between in proportion. */
    offset?: {
        closed?: number;
        opened?: number;
    };
    /** `false` leaves the view at its `closed` offset whatever the keyboard does. */
    enabled?: boolean;
    /** Receives the host handle (`HostHandle` in `fabric/host.ts`), or null on unmount. */
    ref?: (handle: HostHandle | null) => void;
};
declare const KeyboardStickyView: import("svelte").Component<$$ComponentProps, {}, "">;
type KeyboardStickyView = ReturnType<typeof KeyboardStickyView>;
export default KeyboardStickyView;
