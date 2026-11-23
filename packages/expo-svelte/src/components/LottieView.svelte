<script lang="ts">
  import { forwardRef } from "./forward-ref.ts";
  import type {} from "../elements.d.ts";
  import type { ClassProps } from "../classes.ts";
  import { createNativeProps } from "../native-props.ts";
  import { resolveAssetSource } from "../fabric/deps-rn.ts";
  import type { Commandable } from "../fabric/foreign.ts";
  import { lottieHandle, lottieSources, lottieSpeed, type LottieHandle, type LottieSource } from "../fabric/foreign-lottie.ts";
  import type { ViewProps } from "react-native";

  /**
   * The native animation view of `lottie-react-native` (`LottieAnimationView`) as a Svelte component, with that package's props:
   * `source` (a name in the app's assets, `{ uri }`, a `require`d `.lottie` asset, or the animation as an object, which a
   * `require`d `.json` file is), `autoPlay`, `loop` (default true), `speed`, `progress`, `duration`, `resizeMode`, `renderMode`,
   * `colorFilters`, the text filters and the Android switches; `onAnimationFinish(isCancelled)`, `onAnimationFailure(error)`
   * and `onAnimationLoaded()`. `ref` receives `play(startFrame?, endFrame?)`, `reset()`, `pause()` and `resume()`.
   * Not ported: the web-only props (`hover`, `webStyle`) and `containerStyle`.
   */
  let {
    source, progress = 0, speed = 1, duration, loop = true, autoPlay = false, resizeMode = "contain", cacheComposition = true,
    enableMergePathsAndroidForKitKatAndAbove = false, applyOpacityToLayersAndroid = false, enableSafeModeAndroid = false, colorFilters = [], textFiltersAndroid = [], textFiltersIOS = [],
    onAnimationFinish, onAnimationFailure, onAnimationLoaded, ref, ...attributes
  }: Omit<ViewProps, "children"> & {
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
    colorFilters?: readonly { keypath: string; color: string }[];
    textFiltersAndroid?: readonly { find: string; replace: string }[];
    textFiltersIOS?: readonly { keypath: string; text: string }[];
    onAnimationFinish?: (isCancelled: boolean) => void;
    onAnimationFailure?: (error: string) => void;
    onAnimationLoaded?: () => void;
    /** Receives `play`, `reset`, `pause` and `resume` (`host` is the view's handle), or null on unmount. */
    ref?: (handle: (LottieHandle & { host: unknown }) | null) => void;
    [prop: string]: unknown;
  } & ClassProps = $props();
  const resolveProps = createNativeProps();
  const sources = $derived(source === null || source === undefined ? undefined : lottieSources(source, (asset) => resolveAssetSource(asset as never) as { uri: string } | null));
  // The library plays from its ref callback too: an animation that is ready before the first `autoPlay` update still starts.
  const hostRef = $derived(forwardRef(ref, (host: Commandable) => ({ ...lottieHandle(host), host }), (host) => { if (host && autoPlay === true) lottieHandle(host).play(); }));
  type Event<Native> = { nativeEvent: Native };
  const handlers = {
    onAnimationFinish: (event: Event<{ isCancelled: boolean }>) => onAnimationFinish?.(event.nativeEvent.isCancelled),
    onAnimationFailure: (event: Event<{ error: string }>) => onAnimationFailure?.(event.nativeEvent.error),
    onAnimationLoaded: () => onAnimationLoaded?.(),
  };
</script>
{#if source !== null && source !== undefined}
  <native-foreign component="LottieAnimationView" nativeProps={resolveProps({
    ...attributes, progress, loop, resizeMode, cacheComposition, enableMergePathsAndroidForKitKatAndAbove, applyOpacityToLayersAndroid, enableSafeModeAndroid,
    colorFilters, textFiltersAndroid, textFiltersIOS, autoPlay,
    speed: lottieSpeed(speed, duration, source, sources),
    ...sources, ...handlers, ref: hostRef,
  })}></native-foreign>
{/if}
