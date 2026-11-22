<script lang="ts">
  import type {} from "../elements.d.ts";
  import type { ClassProps } from "../classes.ts";
  import { createNativeProps } from "../native-props.ts";
  import { expoViewName, sharedObjectId } from "../fabric/foreign.ts";
  import type { ViewProps } from "react-native";

  /**
   * The native video view of `expo-video` (`ExpoVideo`'s `SurfaceVideoView`, or its `TextureVideoView` with
   * `surfaceType="textureView"`) as a Svelte component. The player is created with expo-video's `createVideoPlayer`
   * (the `expo-video/build/VideoPlayer` module, which needs no React component) and given as `player`.
   */
  let { player, surfaceType = "surfaceView", ref, ...attributes }: Omit<ViewProps, "children"> & {
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
  } & ClassProps = $props();
  const resolveProps = createNativeProps();
  const component = $derived(expoViewName("ExpoVideo", surfaceType === "textureView" ? "TextureVideoView" : "SurfaceVideoView"));
</script>
<!-- The two surface types are two native views: a node keeps the one it was created for. -->
{#key component}<native-foreign {component} nativeProps={resolveProps({ ...attributes, player: sharedObjectId(player), ref })}></native-foreign>{/key}
