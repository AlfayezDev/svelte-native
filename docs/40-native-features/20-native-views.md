---
title: Native views
---

Some libraries give you a view that the platform draws: an image with a placeholder and a disk cache, a blur, a video player, a map. `@example/svelte-native/foreign` has Svelte components for the common ones. Each mounts the library's native view directly, with the library's own props, and none of them loads React.

```svelte
<!--- file: src/routes/+mobile.svelte --->
<script lang="ts">
	import { Screen, Text } from '@example/svelte-native';
	import { LinearGradient } from '@example/svelte-native/foreign';
</script>

<Screen title="Gradient">
	<LinearGradient
		colors={['#ff7a18', '#af002d', '#319197']}
		start={{ x: 0, y: 0 }}
		end={{ x: 1, y: 1 }}
		style={{ height: 120, borderRadius: 12, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }}
	>
		<Text style={{ color: '#ffffff', fontSize: 20, fontWeight: '600' }}>Gradient</Text>
	</LinearGradient>
</Screen>
```

## Installing a library

Every library on this page is optional. Install the ones you use, then prebuild and build, because each one adds native code:

```sh
npx expo install expo-linear-gradient
pnpm exec expo prebuild --platform android
pnpm android
```

An app that doesn't install a library doesn't bundle anything of it, even if it imports its component.

| Library | Components |
| --- | --- |
| `expo-image` | [`ExpoImage`](#expoimage) |
| `expo-blur` | [`BlurView`, `BlurTargetView`](#blurview-and-blurtargetview) |
| `expo-linear-gradient` | [`LinearGradient`](#lineargradient) |
| `expo-conic-gradient` | [`ConicGradient`](#conicgradient) |
| `react-native-video` | [`Video`](#video) |
| `expo-video` | [`VideoView`](#videoview) |
| `lottie-react-native` | [`LottieView`](#lottieview) |
| `rive-react-native` | [`Rive`](#rive) |
| `@react-native-community/datetimepicker` | [`DateTimePicker`, `openDatePicker`](#datetimepicker-and-opendatepicker) |
| `react-native-pdf` and `react-native-blob-util` | [`Pdf`](#pdf) |
| `react-native-webview` | [`WebView`](#webview) |
| `react-native-maps` | [`MapView`, `Marker`](#mapview-and-marker) |
| `react-native-view-shot` | [`ViewShot`, `captureRef`](#viewshot-and-captureref) |
| `react-native-fast-shadow` | [`ShadowedView`, `shadowStyle`](#shadowedview-and-shadowstyle) |
| `react-native-animateable-text` | [`AnimateableText`](#animateabletext) |
| `react-native-svg` | the components of [SVG](svg) |
| any other Expo module | [`ExpoView`, `defineExpoView`](#any-expo-view) |
| anything else | [`ForeignView`](#foreignview) |

Four of these libraries need a patch: see [Patches](#patches).

Every component takes the usual layout and accessibility props of a [`View`](view) (`style`, `accessibilityLabel`, `testID`, ...) besides its own. `ref` gives a handle: the host handle (`tag`, `measure`, ...) or, where the library has them, its functions.

## Components

### ExpoImage

An image with `expo-image`'s extras: a placeholder (a blurhash or thumbhash), a fade-in, a disk and memory cache and animated formats. The [`Image`](image) primitive is lighter and enough for a plain picture.

```svelte
<script lang="ts">
	import { ExpoImage } from '@example/svelte-native/foreign';
</script>

<ExpoImage
	source="https://picsum.photos/id/1015/600/400"
	placeholder="blurhash:/LEHV6nWB2yk8pyo0adR*.7kCMdnj/32/32"
	contentFit="cover"
	transition={300}
	accessibilityLabel="A river between mountains"
	style={{ height: 200, borderRadius: 12 }}
/>
```

| Prop | Description |
| --- | --- |
| `source` | A URL, `{ uri, headers, cacheKey }`, an imported asset, a list of those, or a blurhash or thumbhash. |
| `placeholder` | What shows while `source` loads. Takes the same forms as `source`. |
| `contentFit` | `cover`, `contain`, `fill`, `none` or `scale-down`. |
| `contentPosition`, `transition`, `tintColor`, `blurRadius` | Placement, a fade in milliseconds, a tint, a blur. |
| `cachePolicy`, `priority`, `recyclingKey` | `none`, `disk`, `memory` or `memory-disk`; the load priority; a key for views that are reused in a list. |
| `onLoadStart`, `onProgress`, `onLoad`, `onError`, `onLoadEnd`, `onDisplay` | Called with the payload itself: `onLoad({ cacheType, source })`, `onError({ error })`. |

The library's static functions (`prefetch`, the cache functions) are reached through its native module, `requireNativeModule('ExpoImage')`.

### BlurView and BlurTargetView

`BlurView` blurs what is behind it. On iOS that's all you need. On Android, the real blur draws what a `BlurTargetView` holds: put the content to blur in the target, and give the target's `ref` handle to `blurTarget`. Without a target, Android draws a translucent tint instead (`blurMethod="none"`, the default).

```svelte
<script lang="ts">
	import { Text, View } from '@example/svelte-native';
	import { BlurTargetView, BlurView } from '@example/svelte-native/foreign';

	const fill = { position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 } as const;
	let target = $state<{ tag: number } | null>(null);
</script>

<View style={{ height: 140, borderRadius: 12, overflow: 'hidden' }}>
	<BlurTargetView ref={(handle) => (target = handle as { tag: number } | null)} style={{ ...fill, flexDirection: 'row' }}>
		<View style={{ flex: 1, backgroundColor: '#e5484d' }} />
		<View style={{ flex: 1, backgroundColor: '#0091ff' }} />
	</BlurTargetView>
	<BlurView blurTarget={target} blurMethod="dimezisBlurView" intensity={60} tint="light" style={{ ...fill, margin: 24, alignItems: 'center', justifyContent: 'center' }}>
		<Text>Blurred</Text>
	</BlurView>
</View>
```

| Prop | Description |
| --- | --- |
| `intensity` | 1 to 100. Default 50. |
| `tint` | `light`, `dark`, `default` and the other tints of `expo-blur`. |
| `blurTarget` | Android: the `ref` handle of a `BlurTargetView`. |
| `blurMethod` | Android: `none` (a tint, the default), `dimezisBlurView` or `dimezisBlurViewSdk31Plus`. |
| `blurReductionFactor` | Android: the number the intensity is divided by, so that a value looks alike on both platforms. Default 4. |

The views inside a `BlurTargetView` draw and lay out as usual, but they don't receive touches. On iOS, `BlurTargetView` is a plain `View`.

### LinearGradient

A linear gradient behind its children.

| Prop | Description |
| --- | --- |
| `colors` | The colours, any form React Native takes. Required. |
| `locations` | Where each colour sits along the line, from 0 to 1. |
| `start`, `end` | Points as fractions of the view: `{ x, y }` or `[x, y]`. Default top to bottom. |
| `dither` | Android: dither the gradient. |

Round its corners with `borderRadius`. The children are ordinary views and take touches. The example at the top of this page uses it.

### ConicGradient

A sweep gradient around a centre point.

| Prop | Description |
| --- | --- |
| `colors` | The colours. Required. |
| `locations` | Fractions of the turn, one per colour. |
| `center` | `[x, y]` as fractions of the view. Default the middle. |
| `angle` | Degrees. 0 starts at the top. |

The gradient fills the view and the children are drawn above it. Round the corners with `borderRadius` and `overflow: 'hidden'`.

### Video

`react-native-video`'s player.

```svelte
<script lang="ts">
	import { Pressable, Text } from '@example/svelte-native';
	import { Video, type VideoHandle } from '@example/svelte-native/foreign';

	let paused = $state(false);
	let seconds = $state(0);
	let player: VideoHandle | null = null;
</script>

<Video
	source={{ uri: 'https://example.com/clip.mp4' }}
	{paused}
	repeat
	resizeMode="cover"
	ref={(handle) => (player = handle)}
	onProgress={(event) => (seconds = event.currentTime)}
	style={{ height: 200 }}
/>
<Pressable onPress={() => (paused = !paused)} accessibilityRole="button">
	<Text>{paused ? 'Play' : 'Pause'} ({Math.round(seconds)} s)</Text>
</Pressable>
<Pressable onPress={() => player?.seek(0)} accessibilityRole="button">
	<Text>Back to the start</Text>
</Pressable>
```

| Prop | Description |
| --- | --- |
| `source` | An imported file or `{ uri, headers, ... }`, with the library's DRM, text track and buffer options. |
| `paused`, `muted`, `repeat`, `rate`, `volume`, `controls` | Playback state. |
| `resizeMode` | `none`, `contain`, `cover` or `stretch`. |
| `poster` | An image shown before the first frame: a URL or `{ source, resizeMode }`. |
| `selectedAudioTrack`, `selectedTextTrack`, `selectedVideoTrack` | Track choices, as in the library. |
| `viewType` | Android: `1` a surface (the default), `0` a texture, which keeps the video in the views' stacking order, `2` a secure surface. |
| `onLoad`, `onProgress`, `onEnd`, `onError`, `onBuffer`, `onSeek`, ... | Called with the event's payload, for example `onProgress({ currentTime, playableDuration, seekableDuration })`. |

The `ref` handle has `seek(time)`, `pause()`, `resume()`, `setVolume(volume)`, `setFullScreen(on)`, `presentFullscreenPlayer()`, `dismissFullscreenPlayer()`, `enterPictureInPicture()`, `exitPictureInPicture()`, `getCurrentPosition()`, `setSource(source)` and, on iOS, `save(options)`.

### VideoView

`expo-video`'s view. Create the player with `createVideoPlayer` from `expo-video/build/VideoPlayer`, which has no React in it, and pass it as `player`:

```svelte
<script lang="ts">
	import { VideoView } from '@example/svelte-native/foreign';
	import { createVideoPlayer } from 'expo-video/build/VideoPlayer';

	const player = createVideoPlayer({ uri: 'https://example.com/clip.mp4' });
	player.play();
</script>

<VideoView {player} contentFit="cover" nativeControls style={{ height: 200 }} />
```

| Prop | Description |
| --- | --- |
| `player` | An `expo-video` player. Required. |
| `contentFit` | `contain`, `cover` or `fill`. |
| `nativeControls` | Show the platform's playback controls. |
| `surfaceType` | Android: `surfaceView` (the default) or `textureView`. |
| `onFirstFrameRender`, `onFullscreenEnter`, `onFullscreenExit`, `onPictureInPictureStart`, `onPictureInPictureStop` | Events. |

Control playback through the player (`player.play()`, `player.pause()`, `player.currentTime`).

### LottieView

Plays a Lottie animation.

```svelte
<script lang="ts">
	import { LottieView, type LottieHandle } from '@example/svelte-native/foreign';
	import pulse from '../../assets/pulse.json';

	let player: LottieHandle | null = null;
</script>

<LottieView source={pulse} autoPlay loop ref={(handle) => (player = handle)} style={{ height: 160 }} />
```

| Prop | Description |
| --- | --- |
| `source` | The animation: an imported `.json` (the object), a `{ uri }`, an imported `.lottie` file, or the name of an asset. |
| `autoPlay`, `loop` | Start on its own (default `false`); repeat (default `true`). |
| `speed`, `duration`, `progress` | Playback speed; a duration in milliseconds, which wins over `speed`; a fixed point from 0 to 1. |
| `resizeMode` | `cover`, `contain` (the default) or `center`. |
| `colorFilters` | `[{ keypath, color }]` to recolour layers. |
| `onAnimationLoaded`, `onAnimationFinish(isCancelled)`, `onAnimationFailure(error)` | Events. |

The `ref` handle has `play(startFrame?, endFrame?)`, `pause()`, `resume()` and `reset()`.

### Rive

Plays a Rive animation, with its state machines.

```svelte
<script lang="ts">
	import { Rive, type RiveHandle } from '@example/svelte-native/foreign';

	let rive: RiveHandle | null = null;
</script>

<Rive
	url="https://cdn.rive.app/animations/vehicles.riv"
	stateMachineName="bumpy"
	fit="contain"
	ref={(handle) => (rive = handle)}
	style={{ height: 200 }}
/>
```

| Prop | Description |
| --- | --- |
| `resourceName`, `url`, `source` | The `.riv` file: the name of an asset, a URL, or an imported file or `{ uri }`. |
| `artboardName`, `animationName`, `stateMachineName` | What to play. |
| `autoplay` | Default `true`. |
| `fit`, `alignment` | How the artboard fits the view. Default `contain` and `center`. |
| `onPlay`, `onPause`, `onStop`, `onLoopEnd`, `onStateChanged(stateMachine, state)`, `onRiveEventReceived`, `onError` | Events. |

The `ref` handle has `play`, `pause`, `stop`, `reset`, `fireState(stateMachine, input)`, `setInputState(stateMachine, input, value)`, `getBooleanState(input)`, `getNumberState(input)`, `setTextRunValue(name, value)`, the `…AtPath` variants and the data-binding setters.

### DateTimePicker and openDatePicker

The system date and time picker. iOS has a view, `DateTimePicker`. Android has dialogs instead, which `openDatePicker` opens. One screen handles both:

```svelte
<script lang="ts">
	import { Pressable, Text } from '@example/svelte-native';
	import { DateTimePicker, openDatePicker } from '@example/svelte-native/foreign';
	import { Platform } from '@example/svelte-native/platform';

	let date = $state(new Date());
</script>

{#if Platform.OS === 'ios'}
	<DateTimePicker value={date} mode="date" display="compact" onValueChange={(_, picked) => (date = picked)} />
{:else}
	<Pressable onPress={async () => (date = (await openDatePicker({ value: date, mode: 'date' })) ?? date)} accessibilityRole="button">
		<Text>{date.toDateString()}</Text>
	</Pressable>
{/if}
```

`DateTimePicker` is controlled: `value` is the date it shows, and `onValueChange(event, date)` tells you what the user picked. `mode` is `date`, `time`, `datetime` or `countdown`, and `display` is `default`, `spinner`, `compact` or `inline`. `onDismiss` is called when a compact or inline picker closes without a pick. It also takes `minimumDate`, `maximumDate`, `minuteInterval`, `locale` and the library's other props.

`openDatePicker(options)` opens the Android dialog and resolves with the `Date`, or `null` when the user dismisses it. Its options are `value` (required), `mode` (`date` or `time`), `minimumDate`, `maximumDate`, `is24Hour`, `minuteInterval`, `display` and `firstDayOfWeek`. `dismissDatePicker()` closes an open dialog.

### Pdf

Shows a PDF document. It needs `react-native-blob-util` installed as well.

```svelte
<script lang="ts">
	import { Text } from '@example/svelte-native';
	import { Pdf } from '@example/svelte-native/foreign';

	let page = $state(1);
	let pages = $state(0);
</script>

<Pdf
	source={{ uri: 'https://example.com/manual.pdf', cache: true }}
	onLoadComplete={(count) => (pages = count)}
	onPageChanged={(current) => (page = current)}
	style={{ flex: 1 }}
/>
<Text>Page {page} of {pages}</Text>
```

| Prop | Description |
| --- | --- |
| `source` | `{ uri, headers, method, body, cache }` for a URL, a `bundle-assets://` path, a `data:application/pdf;base64,` URI, a file path, or an imported file. Required. |
| `page`, `scale`, `minScale`, `maxScale` | Starting page (from 1) and zoom. |
| `horizontal`, `enablePaging`, `spacing`, `fitPolicy` | Layout. `fitPolicy` is `0` width, `1` height, `2` both (the default). |
| `password` | For an encrypted document. |
| `loading` | A snippet shown until the file is ready. |
| `onLoadComplete(pages, path, size)`, `onPageChanged(page, pages)`, `onError(error)`, `onPressLink(url)`, `onPageSingleTap(page, x, y)`, `onScaleChanged(scale)` | Events. |

The `ref` handle has `setPage(page)`.

### WebView

A web page inside your screen, with `react-native-webview`.

```svelte
<script lang="ts">
	import { WebView } from '@example/svelte-native/foreign';
</script>

<WebView
	source={{ uri: 'https://svelte.dev' }}
	onMessage={(event) => console.log(event.nativeEvent.data)}
	style={{ flex: 1 }}
/>
```

| Prop | Description |
| --- | --- |
| `source` | `{ uri, headers, method, body }` or `{ html, baseUrl }`. |
| `originWhitelist` | Origins the view may navigate to. Default `['http://*', 'https://*']`. |
| `onShouldStartLoadWithRequest(request)` | Return `false` to cancel a navigation. |
| `onMessage` | A message from the page's `window.ReactNativeWebView.postMessage(data)`. |
| `onLoadStart`, `onLoad`, `onLoadEnd`, `onLoadProgress`, `onError`, `onHttpError`, `onNavigationStateChange` | Events, with React Native's event object (`event.nativeEvent`). |

Every other prop of the library's native view works too (`javaScriptEnabled`, `injectedJavaScript`, `userAgent`, ...). The `ref` handle has `injectJavaScript(script)`, `postMessage(data)`, `reload()`, `goBack()`, `goForward()`, `stopLoading()`, `loadUrl(url)`, `requestFocus()`, `clearCache(includeDiskFiles)`, `clearHistory()` and `clearFormData()`.

### MapView and Marker

A map with `react-native-maps`. iOS draws Apple Maps. Android draws Google Maps, which needs an API key at build time: add `["react-native-maps", { "androidGoogleMapsApiKey": "<your key>" }]` to the `plugins` of `app.json`. Without one, the map mounts but draws no tiles.

```svelte
<script lang="ts">
	import { Pressable, Text } from '@example/svelte-native';
	import { MapView, Marker, type MapHandle } from '@example/svelte-native/foreign';

	const london = { latitude: 51.5072, longitude: -0.1276, latitudeDelta: 0.2, longitudeDelta: 0.2 };
	const paris = { latitude: 48.8566, longitude: 2.3522, latitudeDelta: 0.2, longitudeDelta: 0.2 };
	let map: MapHandle | null = null;
</script>

<MapView initialRegion={london} ref={(handle) => (map = handle)} style={{ height: 260 }}>
	<Marker coordinate={london} title="London" />
	<Marker coordinate={paris} title="Paris" />
</MapView>
<Pressable onPress={() => map?.animateToRegion(paris, 800)} accessibilityRole="button">
	<Text>Go to Paris</Text>
</Pressable>
```

`MapView` takes the props of the library's map (`initialRegion`, `region`, `mapType`, `showsUserLocation`, ...) and the events `onMapReady`, `onPress`, `onRegionChange`, `onRegionChangeComplete`, `onMarkerPress` and `onPanDrag`. Its children mount once the map is ready. The `ref` handle has `animateToRegion(region, duration)`, `setCamera(camera)`, `animateCamera(camera, duration)`, `fitToElements`, `fitToSuppliedMarkers`, `fitToCoordinates` and `getCamera()`.

`Marker` takes `coordinate` (required), `title`, `description`, `identifier`, `pinColor`, `draggable` and the events `onPress`, `onSelect` and `onDeselect`. Its children, if any, are its custom view.

### ViewShot and captureRef

Draws views into an image. `ViewShot` is a `View` whose `ref` handle has `capture()`, which resolves with where the image is:

```svelte
<script lang="ts">
	import { Image, Pressable, Text, View } from '@example/svelte-native';
	import { ViewShot } from '@example/svelte-native/foreign';

	let shot: { capture(): Promise<string> } | null = null;
	let picture = $state<string | null>(null);
</script>

<ViewShot ref={(handle) => (shot = handle)} options={{ format: 'png', result: 'data-uri' }} style={{ width: 120, height: 80 }}>
	<View style={{ flex: 1, backgroundColor: '#0091ff' }} />
</ViewShot>
<Pressable onPress={async () => (picture = (await shot?.capture()) ?? null)} accessibilityRole="button">
	<Text>Capture</Text>
</Pressable>
{#if picture}
	<Image source={{ uri: picture }} style={{ width: 120, height: 80 }} />
{/if}
```

| Option | Description |
| --- | --- |
| `format` | `png` (the default) or `jpg`; on Android also `webm`. |
| `quality` | 0 to 1, for `jpg`. |
| `result` | `tmpfile` (the default: a file that lasts until the app exits), `base64` or `data-uri`. |
| `width`, `height` | The image size: pixels on Android, points on iOS (drawn at the screen's scale). |

`ViewShot` also takes `captureMode="mount"` (capture once when it mounts) and the events `onCapture(uri)` and `onCaptureFailure(error)`.

`captureRef(handle, options)` captures any view you have a `ref` handle for, and `captureScreen(options)` the whole screen. `releaseCapture(uri)` deletes a `tmpfile` before the app exits. On iOS a `tmpfile` result is a plain path: add `file://` where a URI is wanted.

### ShadowedView and shadowStyle

Android draws a `View`'s shadow from `elevation` only. `ShadowedView` draws the iOS-style shadow props on Android too, so one style looks the same on both:

```svelte
<script lang="ts">
	import { Text } from '@example/svelte-native';
	import { ShadowedView, shadowStyle } from '@example/svelte-native/foreign';
</script>

<ShadowedView style={[{ padding: 20, borderRadius: 16, backgroundColor: '#ffffff' }, shadowStyle({ color: '#000000', opacity: 0.2, radius: 12, offset: [0, 4] })]}>
	<Text>A card with a shadow</Text>
</ShadowedView>
```

It reads `shadowColor`, `shadowOpacity`, `shadowRadius` and `shadowOffset` from its style, shaped by the corner radii. `shadowStyle({ color, opacity, radius, offset })` writes those four keys and halves the radius on iOS, so a radius means the same on both platforms (and in design tools). Don't give a `ShadowedView` `overflow: 'hidden'`: it clips the shadow. Put that on the child that needs it. On iOS, `ShadowedView` is a plain `View`.

### AnimateableText

A `Text` whose string a worklet can set on the UI thread, for numbers that change every frame (a counter, a progress readout) without a render:

```svelte
<script lang="ts">
	import { createSharedValue, withTiming } from '@example/svelte-native/animation';
	import { AnimateableText } from '@example/svelte-native/foreign';

	const count = createSharedValue(0);
	count.value = withTiming(100, { duration: 2000 });
</script>

<AnimateableText text="0" animatedProps={() => { 'worklet'; return { text: String(Math.round(count.value)) }; }} style={{ fontSize: 32 }} />
```

`text` is the first string; `animatedProps` is a worklet that returns `{ text }`. It takes the props of [`Text`](text) except the press handlers, and has no children.

## Any Expo view

An Expo library without a component above (`expo-camera`, say) needs no wrapper. `defineExpoView` makes a typed component of a module's native view:

```svelte
<!--- file: src/routes/camera/+mobile.svelte --->
<script lang="ts">
	import { Pressable, Text } from '@example/svelte-native';
	import { defineExpoView, type ExpoViewHandle } from '@example/svelte-native/foreign';
	import type { CameraNativeProps, CameraViewRef } from 'expo-camera';

	const CameraView = defineExpoView<CameraNativeProps, CameraViewRef>('ExpoCamera');
	let camera: ExpoViewHandle<CameraViewRef> | null = null;
</script>

<CameraView
	facing="back"
	barcodeScannerEnabled={false}
	style={{ flex: 1 }}
	ref={(handle) => (camera = handle)}
	onMountError={(event) => console.warn(event.nativeEvent.message)}
/>
<Pressable onPress={async () => console.log((await camera?.takePicture({ quality: 1 }))?.uri)} accessibilityRole="button">
	<Text>Take a picture</Text>
</Pressable>
```

`defineExpoView<Props, Methods>(module, view?)` takes the native module's name and, for a module with several views, the view's name. The component it returns is the native view itself, not the library's React component:

- Its props are the names the native module declares. A prop the module doesn't declare is dropped.
- An `on…` prop handles the event of that name and gets React Native's event object, `{ nativeEvent }`.
- A shared object, such as an `expo-video` player, is passed as its id.
- `ref` gets the host handle with the functions the module defines for the view, such as `takePicture`.

Some React components change their props before the view sees them. `expo-camera`'s `CameraView` turns `flash` into the native `flashMode`, and sends `barcodeScannerEnabled`, which Android needs to start the camera. With the native view, you do those steps yourself: that's why the example passes `barcodeScannerEnabled` and types the props as `CameraNativeProps`. Likewise, a function the React component only wraps in JavaScript (`takePictureAsync`) isn't on the handle: call the native one (`takePicture`).

`<ExpoView module="ExpoCamera" facing="back" />` is the same without the types, for one-off use. A module or view the build doesn't have throws when the view mounts, with a message that tells you to install the library and rebuild.

## ForeignView

`ForeignView` mounts any native component by its Fabric name, for a library that has no component here and isn't an Expo module. Here it mounts the native view of `@react-native-community/slider`:

```svelte
<ForeignView component="RNCSlider" value={0.5} minimumValue={0} maximumValue={1} style={{ height: 40 }} />
```

Every prop besides `component` goes to the native view as it is, so you pass the native props, not the library's React props.

## Touches

A touch inside a native view goes to that view, not to your JavaScript. A tap on a map moves the map; a tap on a web page goes to the page. To handle the touches of a native view's frame in Svelte instead, give it `pointerEvents="box-only"`.

Native views work inside [`List`](list) rows, sheets and modals.

## Patches

On Android, React Native can drop an event of a native view when JavaScript is busy and a newer event of the same name arrives from the same view. For a progress stream that's fine; for a "loaded" message it's a lost event. Svelte Native ships patches for four libraries so that their one-off events are always delivered:

| Library | Version |
| --- | --- |
| `lottie-react-native` | 7.3.8 |
| `react-native-maps` | 1.27.2 |
| `react-native-pdf` | 7.0.3 |
| `react-native-video` | 6.19.3 |

Each patch is for exactly one version. To use one of these libraries, install that version, then run `svelte-native init` again: it copies the patch into `patches/svelte-native/` and declares it in `pnpm-workspace.yaml`.

```sh
pnpm add react-native-pdf@7.0.3 react-native-blob-util
pnpm exec svelte-native init
```

`pnpm exec svelte-native doctor` fails when an installed library is missing its patch. [Configuration](configuration#patches) has the details.
