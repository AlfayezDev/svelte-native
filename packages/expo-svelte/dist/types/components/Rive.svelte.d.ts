import type { Snippet } from "svelte";
import type { ClassProps } from "../classes.js";
import { type RiveAlignment, type RiveAssetSource, type RiveDataBinding, type RiveError, type RiveFileSource, type RiveFit, type RiveHandle, type RiveLoopMode, type RiveSource } from "../fabric/foreign-rive.js";
import type { ViewProps } from "react-native";
type $$ComponentProps = Omit<ViewProps, "children"> & {
    resourceName?: string;
    url?: string;
    source?: RiveSource;
    artboardName?: string;
    animationName?: string;
    stateMachineName?: string;
    autoplay?: boolean;
    fit?: RiveFit;
    alignment?: RiveAlignment;
    layoutScaleFactor?: number;
    referencedAssets?: Record<string, {
        source: RiveAssetSource | RiveFileSource;
    }>;
    dataBinding?: RiveDataBinding;
    onPlay?: (animationName: string, isStateMachine: boolean) => void;
    onPause?: (animationName: string, isStateMachine: boolean) => void;
    onStop?: (animationName: string, isStateMachine: boolean) => void;
    onLoopEnd?: (animationName: string, loopMode: RiveLoopMode) => void;
    onStateChanged?: (stateMachineName: string, stateName: string) => void;
    onRiveEventReceived?: (event: Record<string, unknown>) => void;
    onError?: (error: RiveError) => void;
    children?: Snippet;
    /** Receives the view's commands (`host` is the handle of the view), or null on unmount. */
    ref?: (handle: (RiveHandle & {
        host: unknown;
    }) | null) => void;
    [prop: string]: unknown;
} & ClassProps;
declare const Rive: import("svelte").Component<$$ComponentProps, {}, "">;
type Rive = ReturnType<typeof Rive>;
export default Rive;
