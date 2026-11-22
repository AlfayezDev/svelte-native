import type { ClassProps } from "../classes.js";
import { type SelectedTrack, type VideoHandle, type VideoSource } from "../fabric/foreign-video.js";
import type { ViewProps } from "react-native";
type Event<Native = Record<string, unknown>> = (event: Native) => void;
type Poster = string | {
    source?: {
        uri: string;
    } | number;
    resizeMode?: "contain" | "cover" | "stretch" | "center" | "repeat";
    style?: unknown;
};
type $$ComponentProps = Omit<ViewProps, "children"> & {
    source?: VideoSource | number;
    poster?: Poster;
    /** @deprecated Use `poster.resizeMode`. */
    posterResizeMode?: string;
    /** Receives the `VideoRef` functions (`host` is the view's handle), or null on unmount. */
    ref?: (handle: (VideoHandle & {
        host: unknown;
    }) | null) => void;
    paused?: boolean;
    muted?: boolean;
    repeat?: boolean;
    resizeMode?: "none" | "contain" | "cover" | "stretch";
    rate?: number;
    volume?: number;
    controls?: boolean;
    /** Android: 0 texture view, 1 surface view (default), 2 secure surface view. */
    viewType?: number;
    selectedTextTrack?: SelectedTrack;
    selectedAudioTrack?: SelectedTrack;
    selectedVideoTrack?: SelectedTrack;
    shutterColor?: string;
    onLoadStart?: Event;
    onLoad?: Event;
    onError?: Event;
    onProgress?: Event<{
        currentTime: number;
        playableDuration: number;
        seekableDuration: number;
    }>;
    onSeek?: Event;
    onEnd?: () => void;
    onBuffer?: Event<{
        isBuffering: boolean;
    }>;
    onReadyForDisplay?: () => void;
    onPlaybackStateChanged?: Event<{
        isPlaying: boolean;
        isSeeking: boolean;
    }>;
    [prop: string]: unknown;
} & ClassProps;
declare const Video: import("svelte").Component<$$ComponentProps, {}, "">;
type Video = ReturnType<typeof Video>;
export default Video;
