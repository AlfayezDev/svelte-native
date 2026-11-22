import type { Snippet } from "svelte";
import type { ClassProps } from "../classes.js";
import { type MapHandle, type LatLng, type Region } from "../fabric/foreign.js";
import type { ViewProps } from "react-native";
type Event<Native = Record<string, unknown>> = {
    nativeEvent: Native;
};
type $$ComponentProps = Omit<ViewProps, "children"> & {
    children?: Snippet;
    /** Receives the commands (`animateToRegion`, `fitToCoordinates`, ...) or null on unmount. */
    ref?: (handle: (MapHandle & {
        host: unknown;
    }) | null) => void;
    region?: Region;
    initialRegion?: Region;
    onMapReady?: (event: Event) => void;
    /** A finger moves on the map (react-native-maps' `onPanDrag`: the native view sends it only when asked to, which a handler does). */
    onPanDrag?: (event: Event) => void;
    onPress?: (event: Event<{
        coordinate: LatLng;
        position: {
            x: number;
            y: number;
        };
    }>) => void;
    onRegionChange?: (event: Event) => void;
    onRegionChangeComplete?: (event: Event) => void;
    onMarkerPress?: (event: Event) => void;
    [prop: string]: unknown;
} & ClassProps;
declare const MapView: import("svelte").Component<$$ComponentProps, {}, "">;
type MapView = ReturnType<typeof MapView>;
export default MapView;
