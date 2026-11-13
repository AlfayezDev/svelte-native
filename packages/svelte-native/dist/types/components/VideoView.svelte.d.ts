import type { ClassProps } from "../classes.js";
import type { ViewProps } from "react-native";
type $$ComponentProps = Omit<ViewProps, "children"> & {
    /** An expo-video `VideoPlayer`, or the id of a shared object. */
    player: unknown;
    surfaceType?: "surfaceView" | "textureView";
    ref?: (handle: unknown) => void;
    nativeControls?: boolean;
    contentFit?: "contain" | "cover" | "fill";
    onFirstFrameRender?: () => void;
    onFullscreenEnter?: () => void;
    onFullscreenExit?: () => void;
    onPictureInPictureStart?: () => void;
    onPictureInPictureStop?: () => void;
    [prop: string]: unknown;
} & ClassProps;
declare const VideoView: import("svelte").Component<$$ComponentProps, {}, "">;
type VideoView = ReturnType<typeof VideoView>;
export default VideoView;
