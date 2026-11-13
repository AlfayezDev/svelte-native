import type { Snippet } from "svelte";
import type { ClassProps } from "../classes.js";
import type { LatLng } from "../fabric/foreign.js";
import type { ViewProps } from "react-native";
type Event<Native = Record<string, unknown>> = {
    nativeEvent: Native;
};
type $$ComponentProps = Omit<ViewProps, "children"> & {
    children?: Snippet;
    /** Receives the host handle; its `dispatchCommand` takes `showCallout`, `hideCallout`, `redraw`, `animateToCoordinates`. */
    ref?: (handle: unknown) => void;
    coordinate: LatLng;
    title?: string;
    description?: string;
    identifier?: string;
    pinColor?: string;
    draggable?: boolean;
    onPress?: (event: Event) => void;
    onSelect?: (event: Event) => void;
    onDeselect?: (event: Event) => void;
    [prop: string]: unknown;
} & ClassProps;
declare const Marker: import("svelte").Component<$$ComponentProps, {}, "">;
type Marker = ReturnType<typeof Marker>;
export default Marker;
