import { type ClassProps } from "../classes.js";
import { type ExpoImageProps } from "../fabric/foreign-image.js";
import type { ViewProps } from "react-native";
type LoadEvent = {
    cacheType: "none" | "disk" | "memory";
    source: {
        url: string;
        width: number;
        height: number;
        mediaType: string | null;
        isAnimated?: boolean;
    };
};
type $$ComponentProps = Omit<ViewProps, "children"> & ExpoImageProps & {
    /** Receives the host handle (`tag`, `measure`, ...), or null on unmount. */
    ref?: (handle: unknown) => void;
    onLoadStart?: () => void;
    onLoad?: (event: LoadEvent) => void;
    onProgress?: (event: {
        loaded: number;
        total: number;
    }) => void;
    onError?: (event: {
        error: string;
    }) => void;
    /** After `onLoad` or `onError`. */
    onLoadEnd?: () => void;
    onDisplay?: () => void;
} & ClassProps;
declare const ExpoImage: import("svelte").Component<$$ComponentProps, {}, "">;
type ExpoImage = ReturnType<typeof ExpoImage>;
export default ExpoImage;
