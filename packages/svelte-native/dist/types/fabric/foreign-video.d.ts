/**
 * The prop processing and commands of `react-native-video` 6 (`Video.tsx`, `utils.ts`) without React. The native view is
 * `RCTVideo`, a legacy view manager (`requireNativeComponent`, not codegen) that React Native mounts through its Fabric
 * interop; its commands (`seek`, `pause`, ...) are methods of the `VideoManager` native module that take the view's tag, as
 * the library's own ref does (`NativeVideoManager.seekCmd(findNodeHandle(ref), ...)`). Nothing here imports `react-native-video`.
 */
import type { Commandable } from "./foreign.js";
export type Headers = Record<string, string>;
export type VideoSource = {
    uri?: string | number;
    isNetwork?: boolean;
    isAsset?: boolean;
    isLocalAssetFile?: boolean;
    shouldCache?: boolean;
    type?: string;
    mainVer?: number;
    patchVer?: number;
    headers?: Headers;
    startPosition?: number;
    cropStart?: number;
    cropEnd?: number;
    contentStartTime?: number;
    metadata?: Record<string, unknown>;
    drm?: VideoDrm;
    cmcd?: boolean | {
        mode?: number;
        request?: Record<string, string | number>;
        session?: Record<string, string | number>;
        object?: Record<string, string | number>;
        status?: Record<string, string | number>;
    };
    textTracksAllowChunklessPreparation?: boolean;
    textTracks?: unknown[];
    ad?: VideoAd;
    minLoadRetryCount?: number;
    bufferConfig?: Record<string, unknown>;
};
export type VideoDrm = {
    type?: string;
    licenseServer?: string;
    headers?: Headers;
    contentId?: string;
    certificateUrl?: string;
    base64Certificate?: boolean;
    multiDrm?: boolean;
    localSourceEncryptionKeyScheme?: string;
    getLicense?: (...args: string[]) => string | Promise<string>;
};
export type VideoAd = {
    type?: "csai" | "ssai";
    adTagUrl?: string;
    adLanguage?: string;
    streamType?: string;
    contentSourceId?: string;
    videoId?: string;
    assetKey?: string;
    format?: string;
    adTagParameters?: Record<string, string>;
    fallbackUri?: string;
};
/** `resolveAssetSource`: what a `require`d video is (`{ uri }`), or null. */
export type ResolveVideoAsset = (asset: number) => {
    uri: string;
} | null | undefined;
export type SelectedTrack = {
    type?: string;
    value?: string | number;
};
/** Android's view types (`ViewType.kt`); the library's order, not the order one would guess. */
export declare const ViewType: {
    readonly TEXTURE: 0;
    readonly SURFACE: 1;
    readonly SURFACE_SECURE: 2;
};
export declare const CmcdMode: {
    readonly MODE_REQUEST_HEADER: 0;
    readonly MODE_QUERY_PARAMETER: 1;
};
/** Headers as the native side takes them: a list of `{ key, value }`. */
export declare const generateHeaderForNative: (headers?: Record<string, unknown>) => {
    key: string;
    value: unknown;
}[];
/** The component-level props the source takes defaults from (the library still accepts them next to `source`, deprecated). */
export type VideoSourceDefaults = {
    drm?: VideoDrm;
    textTracks?: unknown[];
    contentStartTime?: number;
    adTagUrl?: string;
    adLanguage?: string;
    minLoadRetryCount?: number;
    bufferConfig?: Record<string, unknown>;
    localSourceEncryptionKeyScheme?: string;
};
/**
 * The native `src` for a `source` prop: a `require`d asset becomes its URI, a path becomes a `file://` URI, `isNetwork` and
 * `isAsset` follow from the scheme, headers become a list, and DRM, text tracks, ads, CMCD and the buffer config are
 * carried as the library's component does (a field of `source` first, the component-level prop as the default).
 */
export declare function videoSource(source: VideoSource | number | undefined, resolveAsset: ResolveVideoAsset, platform: "android" | "ios", defaults?: VideoSourceDefaults): Record<string, unknown> | undefined;
/** A selected track as the native side takes it: its value is always a string; a value of any other type drops the selection. */
export declare function selectedTrack(track: SelectedTrack | undefined, name: string): {
    type?: string;
    value: string;
} | undefined;
/** Android's view type from the props that choose it (`viewType`, and the deprecated `useTextureView` and `useSecureView`); DRM content needs a surface. */
export declare function videoViewType(props: {
    drm?: VideoDrm;
    useSecureView?: boolean;
    useTextureView?: boolean;
    viewType?: number | null;
}): number;
/**
 * The events of the native view by the component's callback names: `[callback, native event prop, whether the callback gets the
 * event's payload]`. A callback that is given sends nothing different to the native view, which emits every event; the library
 * registers a handler only for the ones it needs, as this does.
 */
export declare const videoEvents: readonly (readonly [callback: string, native: string, payload: boolean])[];
type Callbacks = Record<string, ((...args: never[]) => void) | undefined>;
type Event = {
    nativeEvent: unknown;
};
/** The native event handlers for the callbacks that were given (`onLoad` becomes `onVideoLoad` and receives the event's payload). */
export declare function videoHandlers(callbacks: Callbacks, extra?: {
    readyForDisplay?: () => void;
    loadStart?: () => void;
}): Record<string, (event: Event) => void>;
/**
 * The native props for the component's: the source as `src`, the selected tracks as `{ type, value }` strings, the view type
 * from `viewType` and its deprecated forms, and everything else as given, without the callbacks (`videoHandlers` makes those
 * the native event handlers). `shutterColor` stays a colour for the view's config to convert.
 */
export declare function videoNativeProps(props: Record<string, unknown>, resolveAsset: ResolveVideoAsset, platform: "android" | "ios"): Record<string, unknown>;
/** The functions of the library's `ref` (`VideoRef`), through its `VideoManager` module and the view's tag. */
export type VideoHandle = {
    seek(time: number, tolerance?: number): void;
    pause(): Promise<void>;
    resume(): Promise<void>;
    setVolume(volume: number): Promise<void>;
    setFullScreen(fullScreen: boolean): Promise<void>;
    presentFullscreenPlayer(): Promise<void>;
    dismissFullscreenPlayer(): Promise<void>;
    enterPictureInPicture(): void;
    exitPictureInPicture(): void;
    getCurrentPosition(): Promise<number>;
    /** Replaces the playing source (the same conversion as the `source` prop). */
    setSource(source?: VideoSource | number): Promise<void>;
    /** iOS only; resolves with nothing elsewhere. */
    save(options: object): Promise<{
        uri: string;
    } | undefined>;
};
export declare function videoHandle(host: Commandable, convertSource: (source?: VideoSource | number) => Record<string, unknown> | undefined, platform: "android" | "ios"): VideoHandle;
export {};
