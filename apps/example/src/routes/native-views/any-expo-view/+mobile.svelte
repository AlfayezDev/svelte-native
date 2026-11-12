<script lang="ts">
  import { onMount } from "svelte";
  import { Text } from "@rasheed/svelte-native";
  import { defineExpoView, type ExpoViewHandle } from "@rasheed/svelte-native/foreign";
  import type { CameraNativeProps, CameraViewRef } from "expo-camera";
  import CameraManager from "expo-camera/build/ExpoCameraManager";
  import type { ImageLoadEventData, ImageNativeProps } from "expo-image";
  import resolveAssetSource from "react-native/Libraries/Image/resolveAssetSource";
  import Button from "#lib/components/Button.svelte";
  import Page from "#lib/components/Page.svelte";
  import Section from "#lib/components/Section.svelte";
  import { scroller, useDemo } from "#lib/demo.ts";
  import { text } from "#lib/theme.svelte.ts";
  import sample from "../../../../assets/images/sample.png";

  // `defineExpoView(module)` makes a component of an Expo module's native view, by the module's name. Its props are the native view's (expo-camera's
  // `flashMode` and `autoFocus`, not the React component's `flash` and `autofocus`), an `on...` prop is an event called with `{ nativeEvent }`, and
  // `ref` gives the functions the module defines for the view. The types come from the packages and nothing of them runs, so no React is loaded.
  const CameraView = defineExpoView<CameraNativeProps, CameraViewRef>("ExpoCamera");
  // expo-image types `onLoad` and `onError` as its React component calls them, with the data; the native view sends `{ nativeEvent }`.
  type NativeImageProps = Omit<ImageNativeProps, "onLoad" | "onError"> & {
    onLoad?: (event: { nativeEvent: ImageLoadEventData }) => void;
    onError?: (event: { nativeEvent: { error: string } }) => void;
  };
  type ImageViewRef = { readonly reloadAsync: () => Promise<void> };
  const ImageView = defineExpoView<NativeImageProps, ImageViewRef>("ExpoImage");

  const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

  // The permission calls are expo-camera's native module, which `Camera.getCameraPermissionsAsync` calls; the package's index would also load its
  // React component and the `expo` package.
  let permission = $state("checking");
  let cameraStatus = $state("Camera starting");
  let pictureStatus = $state("");
  let camera: ExpoViewHandle<CameraViewRef> | null = null;

  async function askPermission(ask: boolean) {
    try {
      const response = ask ? await CameraManager.requestCameraPermissionsAsync() : await CameraManager.getCameraPermissionsAsync();
      permission = response.status;
    } catch (error) {
      permission = `error, ${message(error)}`;
    }
  }
  onMount(() => { void askPermission(false); });

  async function takePicture() {
    try {
      const picture = await camera?.takePicture({ quality: 1 });
      pictureStatus = picture ? `Picture: ${picture.width}×${picture.height}` : "Picture failed: no camera view";
    } catch (error) {
      pictureStatus = `Picture failed: ${message(error)}`;
    }
  }

  // A bundled picture in the native view's own shape: a list of `{ uri, width, height }`.
  const bundled = resolveAssetSource(sample);
  let imageStatus = $state("Image loading");
  let functionStatus = $state("");
  let image: ExpoViewHandle<ImageViewRef> | null = null;

  async function reload() {
    try {
      await image?.reloadAsync();
      functionStatus = "View function: ok";
    } catch (error) {
      functionStatus = `View function failed: ${message(error)}`;
    }
  }

  // `?demo`: with the camera permission already granted, take a picture; then scroll to the image and call its reload function.
  let { url }: { url: URL } = $props();
  const view = scroller();
  useDemo(() => url, [
    [() => cameraStatus === "Camera ready" ? takePicture() : undefined, 2000],
    [() => view.glide(340, 1000), 700],
    [reload, 1800],
    [() => view.glide(0, 800), 0],
  ], { settle: 2500 });
</script>

<Page title="Any Expo view" scrollRef={view.ref} intro="These views are mounted by name, with no wrapper written for them: defineExpoView reads the native module's view at run time and gives a component typed by the library's own types.">
  <Section title="expo-camera, no wrapper" note="svelte-native has no component for expo-camera. The preview is the ExpoCamera view; Take a picture calls the view's takePicture through ref.">
    <Text style={text.caption}>{`Camera permission: ${permission}`}</Text>
    {#if permission === "granted"}
      <!-- expo-camera's React component always sends barcodeScannerEnabled; on Android that prop is what starts the camera, so it is given here too. -->
      <CameraView
        facing="back"
        barcodeScannerEnabled={false}
        flashMode="off"
        autoFocus="on"
        ref={(handle) => { camera = handle; }}
        onCameraReady={() => { cameraStatus = "Camera ready"; }}
        onMountError={(event) => { cameraStatus = `Camera failed: ${event.nativeEvent.message}`; }}
        style={{ height: 240, borderRadius: 8, overflow: "hidden" }}
      />
      <Text style={text.caption}>{cameraStatus}</Text>
      <Button label="Take a picture" disabled={cameraStatus !== "Camera ready"} onPress={takePicture} />
      {#if pictureStatus}<Text style={text.caption}>{pictureStatus}</Text>{/if}
    {:else}
      <Button label="Allow camera" disabled={permission === "checking"} onPress={() => askPermission(true)} />
    {/if}
  </Section>

  <Section title="expo-image through the generic view" note="ExpoImage has a component of its own (the Image screen). Here the same native view is mounted by name, with a source in its native shape.">
    <ImageView
      source={bundled ? [bundled] : []}
      contentFit="cover"
      accessibilityLabel="Sample picture"
      ref={(handle) => { image = handle; }}
      onLoad={() => { imageStatus = "Image loaded"; }}
      onError={(event) => { imageStatus = `Image failed: ${event.nativeEvent.error}`; }}
      style={{ height: 160, borderRadius: 8 }}
    />
    <Text style={text.caption}>{imageStatus}</Text>
    <Button label="Reload the image" variant="secondary" onPress={reload} />
    {#if functionStatus}<Text style={text.caption}>{functionStatus}</Text>{/if}
  </Section>
</Page>
