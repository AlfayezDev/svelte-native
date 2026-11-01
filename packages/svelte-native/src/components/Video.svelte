<script lang="ts">
  import { forwardRef } from "./forward-ref.ts";
  import type {} from "../elements.d.ts";
  import { createNativeProps } from "../native-props.ts";
  import { Platform, resolveAssetSource } from "../fabric/deps-rn.ts";
  import type { Commandable } from "../fabric/foreign.ts";
  import { videoHandle, videoHandlers, videoNativeProps, videoSource, type SelectedTrack, type VideoHandle, type VideoSource, type VideoSourceDefaults } from "../fabric/foreign-video.ts";
  import Image from "./Image.svelte";
  import View from "./View.svelte";
  import type { ViewProps } from "react-native";

  type Event<Native = Record<string, unknown>> = (event: Native) => void;
  type Poster = string | { source?: { uri: string } | number; resizeMode?: "contain" | "cover" | "stretch" | "center" | "repeat"; style?: unknown };
  /**
   * The native video view of `react-native-video` 6 (`RCTVideo`) as a Svelte component, with that package's props and
   * callbacks: `source` (a `require`d asset, `{ uri, headers, ... }` with DRM, ads, text tracks and buffer config), `paused`,
   * `muted`, `repeat`, `resizeMode`, `rate`, `volume`, `controls`, `poster`, the track selections and the playback callbacks
   * (`onLoad`, `onProgress`, `onEnd`, `onError`, ...), each with the payload as its argument. `ref` receives the library's
   * `VideoRef` functions (`seek`, `pause`, `resume`, `setVolume`, `setFullScreen`, ...), which call its `VideoManager` module
   * with the view's tag. Not ported: `renderLoader`, FairPlay's `getLicense`, `restoreUserInterfaceForPictureInPictureStopCompleted`.
   * Android's `viewType` defaults to a surface; `TEXTURE` (0) keeps the video in the view tree's z-order.
   */
  let { source, style, poster, posterResizeMode, ref, ...attributes }: Omit<ViewProps, "children"> & {
    source?: VideoSource | number;
    poster?: Poster;
    /** @deprecated Use `poster.resizeMode`. */
    posterResizeMode?: string;
    /** Receives the `VideoRef` functions (`host` is the view's handle), or null on unmount. */
    ref?: (handle: (VideoHandle & { host: unknown }) | null) => void;
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
    onProgress?: Event<{ currentTime: number; playableDuration: number; seekableDuration: number }>;
    onSeek?: Event;
    onEnd?: () => void;
    onBuffer?: Event<{ isBuffering: boolean }>;
    onReadyForDisplay?: () => void;
    onPlaybackStateChanged?: Event<{ isPlaying: boolean; isSeeking: boolean }>;
    [prop: string]: unknown;
  } = $props();
  const resolveProps = createNativeProps();
  const platform = Platform.OS === "android" ? "android" : "ios";
  const asset = (number: number) => resolveAssetSource(number as never) as { uri: string } | null;
  const hasPoster = $derived(typeof poster === "string" ? poster !== "" : !!poster?.source);
  let posterShown = $state(true);
  let host: Commandable | null = null;
  const hostRef = $derived(forwardRef(
    ref,
    (given: Commandable) => ({ ...videoHandle(given, (next) => videoSource(next, asset, platform, attributes as VideoSourceDefaults), platform), host: given }),
    (given) => { host = given; },
  ));
  const native = $derived(videoNativeProps({ ...attributes, source }, asset, platform));
  const handlers = $derived(videoHandlers(attributes as never, { readyForDisplay: () => { posterShown = false; }, loadStart: () => { if (hasPoster) posterShown = true; } }));
  const fill = { position: "absolute", left: 0, top: 0, right: 0, bottom: 0 } as const;
  const posterSource = $derived(typeof poster === "string" ? { uri: poster } : poster?.source);
  const posterMode = $derived(typeof poster === "object" && poster?.resizeMode ? poster.resizeMode : posterResizeMode && posterResizeMode !== "none" ? posterResizeMode : "contain");
</script>
<View {style}>
  <native-foreign component="RCTVideo" nativeProps={resolveProps({ ...native, ...handlers, style: fill, ref: hostRef })}></native-foreign>
  {#if hasPoster && posterShown}
    <Image source={posterSource as never} style={[fill, { resizeMode: posterMode }, typeof poster === "object" ? poster.style : undefined] as never} />
  {/if}
</View>
