<script lang="ts">
  import type {} from "../elements.d.ts";
  import { createNativeProps } from "../native-props.ts";
  import { resolveAssetSource } from "../fabric/deps-rn.ts";
  import { expoViewName } from "../fabric/foreign.ts";
  import { expoImageProps, type ExpoImageProps } from "../fabric/foreign-image.ts";
  import type { ViewProps } from "react-native";

  type LoadEvent = { cacheType: "none" | "disk" | "memory"; source: { url: string; width: number; height: number; mediaType: string | null; isAnimated?: boolean } };
  /**
   * The native image view of `expo-image` (`ExpoImage`) as a Svelte component, with the props and events of that
   * package's `Image`: `source` as a URL, an `{ uri, headers, cacheKey }` object, a `require`d asset, a list of those or a
   * blurhash or thumbhash; `contentFit`, `contentPosition`, `transition`, `placeholder`, `tintColor`, `cachePolicy`,
   * `priority`, `recyclingKey`, `blurRadius`, `autoplay`, `allowDownscaling`, `decodeFormat` and the iOS-only ones. The
   * deprecated React Native props (`resizeMode`, `fadeDuration`, `defaultSource`, `alt`) still map to the current ones.
   * Not ported: the static methods (`prefetch`, `loadAsync`, the cache functions) and the view's own functions
   * (`startAnimating`, `stopAnimating`, `lockResourceAsync`, `unlockResourceAsync`, `reloadAsync`), which are reachable through the
   * native module (`requireNativeModule("ExpoImage")`). Our own `Image` is unchanged and still the lighter choice for plain images.
   */
  let {
    onLoadStart, onLoad, onProgress, onError, onLoadEnd, onDisplay, ref, ...attributes
  }: Omit<ViewProps, "children"> & ExpoImageProps & {
    /** Receives the host handle (`tag`, `measure`, ...), or null on unmount. */
    ref?: (handle: unknown) => void;
    onLoadStart?: () => void;
    onLoad?: (event: LoadEvent) => void;
    onProgress?: (event: { loaded: number; total: number }) => void;
    onError?: (event: { error: string }) => void;
    /** After `onLoad` or `onError`. */
    onLoadEnd?: () => void;
    onDisplay?: () => void;
  } = $props();
  const resolveProps = createNativeProps();
  // The view's only view: `ViewManagerAdapter_ExpoImage`, with the colour props the module's config does not tell from plain ones.
  const component = expoViewName("ExpoImage", undefined, { colors: "tintColor" });
  type Event<Native> = { nativeEvent: Native };
  const handlers = {
    onLoadStart: () => onLoadStart?.(),
    onLoad: (event: Event<LoadEvent>) => { onLoad?.(event.nativeEvent); onLoadEnd?.(); },
    onProgress: (event: Event<{ loaded: number; total: number }>) => onProgress?.(event.nativeEvent),
    onError: (event: Event<{ error: string }>) => { onError?.(event.nativeEvent); onLoadEnd?.(); },
    onDisplay: () => onDisplay?.(),
  };
</script>
<native-foreign {component} nativeProps={resolveProps({
  ...expoImageProps(attributes, (asset) => resolveAssetSource(asset as never) as never),
  ...handlers,
  ref,
})}></native-foreign>
