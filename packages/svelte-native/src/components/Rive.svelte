<script lang="ts">
  import type { Snippet } from "svelte";
  import type {} from "../elements.d.ts";
  import { createNativeProps } from "../native-props.ts";
  import { resolveAssetSource } from "../fabric/deps-rn.ts";
  import type { Commandable } from "../fabric/foreign.ts";
  import {
    noAutoBind, riveError, riveHandle, riveReferencedAssets, riveResource,
    type RiveAlignment, type RiveAssetSource, type RiveDataBinding, type RiveError, type RiveFileSource, type RiveFit, type RiveHandle, type RiveLoopMode, type RiveSource,
  } from "../fabric/foreign-rive.ts";
  import View from "./View.svelte";
  import type { ViewProps } from "react-native";

  type Event<Native> = { nativeEvent: Native };
  /**
   * The native animation view of `rive-react-native` (`RiveReactNativeView`) as a Svelte component, with that package's props:
   * `resourceName` (a `.riv` in the app's assets), `url` or `source` (a `require`d asset or `{ uri }`), `artboardName`,
   * `animationName`, `stateMachineName`, `autoplay` (default true), `fit`, `alignment`, `layoutScaleFactor`, `referencedAssets`
   * and `dataBinding`; the callbacks `onPlay(animationName, isStateMachine)`, `onPause`, `onStop`, `onLoopEnd(animationName,
   * loopMode)`, `onStateChanged(stateMachineName, stateName)`, `onRiveEventReceived(event)` and `onError(error)` (given, it turns
   * the library's own error logging off). `ref` receives `play`, `pause`, `stop`, `reset`, `fireState`, `setInputState`, the state
   * getters, touch and text-run calls and the data-binding setters; they are the view's commands. Children are drawn behind the
   * animation, as the library's container does. Not ported: the property listeners (`useRiveNumber` and the other hooks, which
   * subscribe through a device event emitter) and the renderer choice (`RiveRenderer.defaultRenderer`).
   */
  let {
    resourceName, url, source, artboardName, animationName, stateMachineName, autoplay = true, fit = "contain", alignment = "center",
    layoutScaleFactor, referencedAssets, dataBinding = noAutoBind, onPlay, onPause, onStop, onLoopEnd, onStateChanged, onRiveEventReceived,
    onError, style, children, ref, ...attributes
  }: Omit<ViewProps, "children"> & {
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
    referencedAssets?: Record<string, { source: RiveAssetSource | RiveFileSource }>;
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
    ref?: (handle: (RiveHandle & { host: unknown }) | null) => void;
    [prop: string]: unknown;
  } = $props();
  const resolveProps = createNativeProps();
  const asset = (number: number) => resolveAssetSource(number as never) as { uri?: string } | null;
  const resource = $derived.by(() => {
    const found = riveResource({ resourceName, url, source }, asset);
    if (!found.resourceName && !found.url) throw new Error("Invalid Rive resource. Please provide a valid resource.");
    return found;
  });
  const assets = $derived(riveReferencedAssets(referencedAssets, asset));
  const hostRef = (handle: unknown) => {
    const host = handle as Commandable | null;
    ref?.(host ? { ...riveHandle(host), host } : null);
  };
  const handlers = {
    onPlay: (event: Event<{ animationName: string; isStateMachine: boolean }>) => onPlay?.(event.nativeEvent.animationName, event.nativeEvent.isStateMachine),
    onPause: (event: Event<{ animationName: string; isStateMachine: boolean }>) => onPause?.(event.nativeEvent.animationName, event.nativeEvent.isStateMachine),
    onStop: (event: Event<{ animationName: string; isStateMachine: boolean }>) => onStop?.(event.nativeEvent.animationName, event.nativeEvent.isStateMachine),
    onLoopEnd: (event: Event<{ animationName: string; loopMode: RiveLoopMode }>) => onLoopEnd?.(event.nativeEvent.animationName, event.nativeEvent.loopMode),
    onStateChanged: (event: Event<{ stateMachineName: string; stateName: string }>) => onStateChanged?.(event.nativeEvent.stateMachineName, event.nativeEvent.stateName),
    onRiveEventReceived: (event: Event<{ riveEvent: Record<string, unknown> }>) => onRiveEventReceived?.(event.nativeEvent.riveEvent),
    onError: (event: Event<{ type: string; message: string }>) => {
      const error = riveError(event.nativeEvent);
      if (error !== null) onError?.(error);
      else console.warn("[Rive] Unknown error type received from native: ", event.nativeEvent.type);
    },
  };
  const fill = { position: "absolute", width: "100%", height: "100%" } as const;
</script>
<View {...attributes} style={[{ flexGrow: 1 }, style]}>
  <View style={fill}>{@render children?.()}</View>
  <native-foreign component="RiveReactNativeView" nativeProps={resolveProps({
    ...resource, isUserHandlingErrors: onError !== undefined, autoplay, fit, layoutScaleFactor, alignment, artboardName, referencedAssets: assets,
    dataBinding, animationName, stateMachineName, ...handlers, style: { flex: 1 }, ref: hostRef,
  })}></native-foreign>
</View>
