/**
 * The prop processing and commands of `react-native-video` 6 (`Video.tsx`, `utils.ts`) without React. The native view is
 * `RCTVideo`, a legacy view manager (`requireNativeComponent`, not codegen) that React Native mounts through its Fabric
 * interop; its commands (`seek`, `pause`, ...) are methods of the `VideoManager` native module that take the view's tag, as
 * the library's own ref does (`NativeVideoManager.seekCmd(findNodeHandle(ref), ...)`). Nothing here imports `react-native-video`.
 */
import type { Commandable } from "./foreign.ts";

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
  cmcd?: boolean | { mode?: number; request?: Record<string, string | number>; session?: Record<string, string | number>; object?: Record<string, string | number>; status?: Record<string, string | number> };
  textTracksAllowChunklessPreparation?: boolean;
  textTracks?: unknown[];
  ad?: VideoAd;
  minLoadRetryCount?: number;
  bufferConfig?: Record<string, unknown>;
};
export type VideoDrm = {
  type?: string; licenseServer?: string; headers?: Headers; contentId?: string; certificateUrl?: string; base64Certificate?: boolean;
  multiDrm?: boolean; localSourceEncryptionKeyScheme?: string; getLicense?: (...args: string[]) => string | Promise<string>;
};
export type VideoAd = { type?: "csai" | "ssai"; adTagUrl?: string; adLanguage?: string; streamType?: string; contentSourceId?: string; videoId?: string; assetKey?: string; format?: string; adTagParameters?: Record<string, string>; fallbackUri?: string };
/** `resolveAssetSource`: what a `require`d video is (`{ uri }`), or null. */
export type ResolveVideoAsset = (asset: number) => { uri: string } | null | undefined;
export type SelectedTrack = { type?: string; value?: string | number };

/** Android's view types (`ViewType.kt`); the library's order, not the order one would guess. */
export const ViewType = { TEXTURE: 0, SURFACE: 1, SURFACE_SECURE: 2 } as const;
export const CmcdMode = { MODE_REQUEST_HEADER: 0, MODE_QUERY_PARAMETER: 1 } as const;

/** Headers as the native side takes them: a list of `{ key, value }`. */
export const generateHeaderForNative = (headers?: Record<string, unknown>): { key: string; value: unknown }[] => (headers ? Object.entries(headers).map(([key, value]) => ({ key, value })) : []);

function normalizeAd(ad: VideoAd | undefined, legacyAdTagUrl: string | undefined, legacyAdLanguage: string | undefined): VideoAd | undefined {
  if (ad) {
    // A source without a type is client-side ads, for backward compatibility with the old API.
    if ((ad.type ?? "csai") === "ssai") {
      return { type: "ssai", streamType: ad.streamType, adLanguage: ad.adLanguage, contentSourceId: ad.contentSourceId, videoId: ad.videoId, assetKey: ad.assetKey, format: ad.format, adTagParameters: ad.adTagParameters, fallbackUri: ad.fallbackUri };
    }
    return { type: "csai", adTagUrl: ad.adTagUrl, adLanguage: ad.adLanguage };
  }
  if (legacyAdTagUrl || legacyAdLanguage) return { type: "csai", adTagUrl: legacyAdTagUrl, adLanguage: legacyAdLanguage };
  return undefined;
}

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
export function videoSource(source: VideoSource | number | undefined, resolveAsset: ResolveVideoAsset, platform: "android" | "ios", defaults: VideoSourceDefaults = {}): Record<string, unknown> | undefined {
  if (source === undefined || source === null) return undefined;
  const object: VideoSource = typeof source === "number" ? {} : source;
  const isLocalAssetFile =
    typeof source === "number" ||
    typeof object.uri === "number" ||
    (typeof object.uri === "string" && (object.uri.startsWith("file://") || object.uri.startsWith("content://") || object.uri.startsWith(".")));
  const assetNumber = typeof source === "number" ? source : typeof object.uri === "number" ? object.uri : undefined;
  const resolved: VideoSource = assetNumber === undefined ? object : { ...object, uri: resolveAsset(assetNumber)?.uri };
  if (assetNumber !== undefined && resolved.uri === undefined) console.warn("cannot resolve item ", assetNumber);
  let uri = typeof resolved.uri === "string" ? resolved.uri : "";
  if (uri.startsWith("/")) uri = `file://${uri}`;
  const isNetwork = !!(uri && /^(rtp|rtsp|http|https):/.test(uri));
  const isAsset = !!(uri && /^(assets-library|ipod-library|file|content|ms-appx|ms-appdata|asset):/.test(uri));

  const selectedDrm = object.drm ?? defaults.drm;
  const drm = selectedDrm && {
    type: selectedDrm.type,
    licenseServer: selectedDrm.licenseServer,
    headers: generateHeaderForNative(selectedDrm.headers),
    contentId: selectedDrm.contentId,
    certificateUrl: selectedDrm.certificateUrl,
    base64Certificate: selectedDrm.base64Certificate,
    useExternalGetLicense: !!selectedDrm.getLicense,
    multiDrm: selectedDrm.multiDrm,
    localSourceEncryptionKeyScheme: selectedDrm.localSourceEncryptionKeyScheme ?? defaults.localSourceEncryptionKeyScheme,
  };

  let cmcd: Record<string, unknown> | undefined;
  if (platform === "android" && object.cmcd) {
    const configuration = object.cmcd;
    if (typeof configuration === "boolean") cmcd = configuration ? { mode: CmcdMode.MODE_QUERY_PARAMETER } : undefined;
    else if (typeof configuration === "object" && !Array.isArray(configuration)) {
      const header = (data?: Record<string, unknown>) => (data ? generateHeaderForNative(data) : undefined);
      cmcd = { mode: configuration.mode ?? CmcdMode.MODE_QUERY_PARAMETER, request: header(configuration.request), session: header(configuration.session), object: header(configuration.object), status: header(configuration.status) };
    } else throw new Error("Invalid CMCD configuration: Expected a boolean or an object.");
  }

  return {
    uri,
    isNetwork,
    isAsset,
    isLocalAssetFile,
    shouldCache: resolved.shouldCache || false,
    type: resolved.type || "",
    mainVer: resolved.mainVer || 0,
    patchVer: resolved.patchVer || 0,
    requestHeaders: generateHeaderForNative(resolved.headers),
    startPosition: resolved.startPosition ?? -1,
    cropStart: resolved.cropStart,
    cropEnd: resolved.cropEnd,
    contentStartTime: object.contentStartTime || defaults.contentStartTime,
    metadata: resolved.metadata,
    drm,
    ad: normalizeAd(object.ad, defaults.adTagUrl, defaults.adLanguage),
    cmcd,
    textTracks: object.textTracks || defaults.textTracks,
    textTracksAllowChunklessPreparation: resolved.textTracksAllowChunklessPreparation,
    minLoadRetryCount: object.minLoadRetryCount || defaults.minLoadRetryCount,
    bufferConfig: object.bufferConfig || defaults.bufferConfig,
  };
}

/** A selected track as the native side takes it: its value is always a string; a value of any other type drops the selection. */
export function selectedTrack(track: SelectedTrack | undefined, name: string): { type?: string; value: string } | undefined {
  if (!track) return undefined;
  const kind = typeof track.value;
  if (kind !== "number" && kind !== "string" && kind !== "undefined") {
    console.warn(`invalid type provided to ${name}.value: `, kind);
    return undefined;
  }
  return { type: track.type, value: `${track.value}` };
}

/** Android's view type from the props that choose it (`viewType`, and the deprecated `useTextureView` and `useSecureView`); DRM content needs a surface. */
export function videoViewType(props: { drm?: VideoDrm; useSecureView?: boolean; useTextureView?: boolean; viewType?: number | null }): number {
  const { drm, useSecureView, useTextureView, viewType } = props;
  const hasValidDrm = drm !== undefined && Object.keys(drm).length !== 0;
  if (useSecureView && useTextureView) console.warn("cannot use SecureView on texture view. please set useTextureView={false}");
  if (hasValidDrm && (viewType === ViewType.TEXTURE || useTextureView)) {
    console.warn("cannot use DRM on texture view. please set useTextureView={false}");
    return useSecureView ? ViewType.SURFACE_SECURE : ViewType.SURFACE;
  }
  if (viewType !== undefined && viewType !== null) return viewType;
  if (useSecureView) return ViewType.SURFACE_SECURE;
  if (useTextureView) return ViewType.TEXTURE;
  return ViewType.SURFACE;
}

/**
 * The events of the native view by the component's callback names: `[callback, native event prop, whether the callback gets the
 * event's payload]`. A callback that is given sends nothing different to the native view, which emits every event; the library
 * registers a handler only for the ones it needs, as this does.
 */
export const videoEvents: readonly (readonly [callback: string, native: string, payload: boolean])[] = [
  ["onLoadStart", "onVideoLoadStart", true], ["onLoad", "onVideoLoad", true], ["onError", "onVideoError", true], ["onProgress", "onVideoProgress", true],
  ["onSeek", "onVideoSeek", true], ["onEnd", "onVideoEnd", false], ["onBuffer", "onVideoBuffer", true], ["onPlaybackStateChanged", "onVideoPlaybackStateChanged", true],
  ["onBandwidthUpdate", "onVideoBandwidthUpdate", true], ["onTimedMetadata", "onTimedMetadata", true], ["onAudioTracks", "onAudioTracks", true],
  ["onTextTracks", "onTextTracks", true], ["onTextTrackDataChanged", "onTextTrackDataChanged", true], ["onVideoTracks", "onVideoTracks", true],
  ["onFullscreenPlayerDidDismiss", "onVideoFullscreenPlayerDidDismiss", false], ["onFullscreenPlayerDidPresent", "onVideoFullscreenPlayerDidPresent", false],
  ["onFullscreenPlayerWillDismiss", "onVideoFullscreenPlayerWillDismiss", false], ["onFullscreenPlayerWillPresent", "onVideoFullscreenPlayerWillPresent", false],
  ["onExternalPlaybackChange", "onVideoExternalPlaybackChange", true], ["onIdle", "onVideoIdle", false], ["onAudioFocusChanged", "onAudioFocusChanged", true],
  ["onReadyForDisplay", "onReadyForDisplay", false], ["onPlaybackRateChange", "onPlaybackRateChange", true], ["onVolumeChange", "onVolumeChange", true],
  ["onAudioBecomingNoisy", "onVideoAudioBecomingNoisy", false], ["onPictureInPictureStatusChanged", "onPictureInPictureStatusChanged", true],
  ["onRestoreUserInterfaceForPictureInPictureStop", "onRestoreUserInterfaceForPictureInPictureStop", false], ["onAspectRatio", "onVideoAspectRatio", true],
  ["onReceiveAdEvent", "onReceiveAdEvent", true], ["onControlsVisibilityChange", "onControlsVisibilityChange", true],
];

type Callbacks = Record<string, ((...args: never[]) => void) | undefined>;
type Event = { nativeEvent: unknown };

/** What the library's wrapper hands a callback: the payload as it is, except the text track data, which loses the `target` the native event carries (`Video.tsx` deletes it from a copy). */
function shaped(callback: string, payload: unknown): unknown {
  if (callback !== "onTextTrackDataChanged" || typeof payload !== "object" || payload === null) return payload;
  const { target: _target, ...rest } = payload as Record<string, unknown>;
  void _target;
  return rest;
}

/** The native event handlers for the callbacks that were given (`onLoad` becomes `onVideoLoad` and receives the event's payload). */
export function videoHandlers(callbacks: Callbacks, extra: { readyForDisplay?: () => void; loadStart?: () => void } = {}): Record<string, (event: Event) => void> {
  const handlers: Record<string, (event: Event) => void> = {};
  for (const [callback, native, payload] of videoEvents) {
    const user = callbacks[callback] as ((value?: unknown) => void) | undefined;
    const before = callback === "onReadyForDisplay" ? extra.readyForDisplay : callback === "onLoadStart" ? extra.loadStart : undefined;
    if (!user && !before) continue;
    handlers[native] = (event) => { before?.(); user?.(payload ? shaped(callback, event.nativeEvent) : undefined); };
  }
  return handlers;
}

/**
 * The native props for the component's: the source as `src`, the selected tracks as `{ type, value }` strings, the view type
 * from `viewType` and its deprecated forms, and everything else as given, without the callbacks (`videoHandlers` makes those
 * the native event handlers). `shutterColor` stays a colour for the view's config to convert.
 */
export function videoNativeProps(props: Record<string, unknown>, resolveAsset: ResolveVideoAsset, platform: "android" | "ios"): Record<string, unknown> {
  const {
    source, resizeMode, poster, posterResizeMode, renderLoader, contentStartTime, drm, textTracks, selectedVideoTrack, selectedAudioTrack, selectedTextTrack,
    useTextureView, useSecureView, viewType, adTagUrl, adLanguage, localSourceEncryptionKeyScheme, minLoadRetryCount, bufferConfig, ...rest
  } = props as Record<string, never>;
  for (const [callback] of videoEvents) delete rest[callback];
  void poster; void posterResizeMode; void renderLoader;
  return {
    ...rest,
    src: videoSource(source, resolveAsset, platform, { drm, textTracks, contentStartTime, adTagUrl, adLanguage, localSourceEncryptionKeyScheme, minLoadRetryCount, bufferConfig }),
    resizeMode,
    selectedTextTrack: selectedTrack(selectedTextTrack, "selectedTextTrack"),
    selectedAudioTrack: selectedTrack(selectedAudioTrack, "selectedAudioTrack"),
    selectedVideoTrack: selectedTrack(selectedVideoTrack, "selectedVideoTrack"),
    viewType: videoViewType({ drm, useSecureView, useTextureView, viewType }),
  };
}

type VideoManager = {
  seekCmd(tag: number, time: number, tolerance: number): void;
  setPlayerPauseStateCmd(tag: number, paused: boolean): Promise<void>;
  setVolumeCmd(tag: number, volume: number): Promise<void>;
  setFullScreenCmd(tag: number, fullScreen: boolean): Promise<void>;
  setSourceCmd(tag: number, source?: Record<string, unknown>): Promise<void>;
  enterPictureInPictureCmd(tag: number): Promise<void>;
  exitPictureInPictureCmd(tag: number): Promise<void>;
  getCurrentPosition(tag: number): Promise<number>;
  save?(tag: number, options: object): Promise<{ uri: string }>;
};
let manager: VideoManager | undefined;
function videoManager(): VideoManager {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const modules = (require("react-native/Libraries/BatchedBridge/NativeModules") as { default: Record<string, VideoManager | undefined> }).default;
  manager ??= modules.VideoManager;
  if (!manager) throw new Error("react-native-video's VideoManager native module is not linked");
  return manager;
}

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
  save(options: object): Promise<{ uri: string } | undefined>;
};
export function videoHandle(host: Commandable, convertSource: (source?: VideoSource | number) => Record<string, unknown> | undefined, platform: "android" | "ios"): VideoHandle {
  // Android's module methods have no promise to hand back (the library's own ref returns whatever they return), so each command is awaited here.
  const command = async <T>(run: (manager: VideoManager) => Promise<T> | T): Promise<T> => run(videoManager());
  return {
    seek: (time, tolerance) => {
      if (time === null || Number.isNaN(time)) throw new Error(`Specified time is not a number: '${time}'`);
      videoManager().seekCmd(host.tag, time, tolerance || 0);
    },
    pause: () => command((manager) => manager.setPlayerPauseStateCmd(host.tag, true)),
    resume: () => command((manager) => manager.setPlayerPauseStateCmd(host.tag, false)),
    setVolume: (volume) => command((manager) => manager.setVolumeCmd(host.tag, volume)),
    setFullScreen: (fullScreen) => command((manager) => manager.setFullScreenCmd(host.tag, fullScreen)),
    presentFullscreenPlayer: () => command((manager) => manager.setFullScreenCmd(host.tag, true)),
    dismissFullscreenPlayer: () => command((manager) => manager.setFullScreenCmd(host.tag, false)),
    enterPictureInPicture: () => { void command((manager) => manager.enterPictureInPictureCmd(host.tag)); },
    exitPictureInPicture: () => { void command((manager) => manager.exitPictureInPictureCmd(host.tag)); },
    getCurrentPosition: () => command((manager) => manager.getCurrentPosition(host.tag)),
    setSource: (source) => command((manager) => manager.setSourceCmd(host.tag, convertSource(source))),
    save: (options) => (platform === "ios" ? command((manager) => manager.save?.(host.tag, options) as Promise<{ uri: string }>) : Promise.resolve(undefined)),
  };
}
