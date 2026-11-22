import type { ClassProps } from "../classes.js";
import { type LottieHandle, type LottieSource } from "../fabric/foreign-lottie.js";
import type { ViewProps } from "react-native";
type $$ComponentProps = Omit<ViewProps, "children"> & {
    source?: LottieSource | null;
    progress?: number;
    speed?: number;
    /** Milliseconds; wins over `speed` for an animation given as an object. */
    duration?: number;
    loop?: boolean;
    autoPlay?: boolean;
    resizeMode?: "cover" | "contain" | "center";
    renderMode?: "AUTOMATIC" | "HARDWARE" | "SOFTWARE";
    imageAssetsFolder?: string;
    cacheComposition?: boolean;
    enableMergePathsAndroidForKitKatAndAbove?: boolean;
    applyOpacityToLayersAndroid?: boolean;
    enableSafeModeAndroid?: boolean;
    hardwareAccelerationAndroid?: boolean;
    colorFilters?: readonly {
        keypath: string;
        color: string;
    }[];
    textFiltersAndroid?: readonly {
        find: string;
        replace: string;
    }[];
    textFiltersIOS?: readonly {
        keypath: string;
        text: string;
    }[];
    onAnimationFinish?: (isCancelled: boolean) => void;
    onAnimationFailure?: (error: string) => void;
    onAnimationLoaded?: () => void;
    /** Receives `play`, `reset`, `pause` and `resume` (`host` is the view's handle), or null on unmount. */
    ref?: (handle: (LottieHandle & {
        host: unknown;
    }) | null) => void;
    [prop: string]: unknown;
} & ClassProps;
declare const LottieView: import("svelte").Component<$$ComponentProps, {}, "">;
type LottieView = ReturnType<typeof LottieView>;
export default LottieView;
