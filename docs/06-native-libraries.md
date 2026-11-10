# Native libraries

The Expo and React Native ecosystem is full of useful libraries: sensors, notifications, maps, video, secure storage. Svelte Native can use most of them. How you use one depends on what it gives you.

## Modules with a plain JavaScript API

Many libraries are a set of functions that talk to the platform: read the location, send a notification, store a secret. You import them as usual:

```svelte
<!--- file: src/routes/+mobile.svelte --->
<script lang="ts">
	import { Pressable, Screen, Text } from '@example/svelte-native';
	import * as Haptics from 'expo-haptics';
</script>

<Screen title="Haptics">
	<Pressable onPress={() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)} accessibilityRole="button">
		<Text>Buzz</Text>
	</Pressable>
</Screen>
```

To add one, install it, put its config plugin and permissions in `app.json` if it has any, and prebuild, because the library brings native code with it:

```sh
npx expo install expo-haptics
pnpm exec expo prebuild --platform android
pnpm android
```

A test app in the repository loads 35 native libraries of a real production app this way, among them `expo-notifications`, `expo-location`, `expo-secure-store`, `expo-web-browser`, `@react-native-async-storage/async-storage` and `react-native-mmkv`, and calls one function of each. [Development builds](05-development-builds.md) says more about when to prebuild.

A module's _functions_ work. Its React _hooks_ don't, because there is no React to run them. `expo-location`'s `getCurrentPositionAsync()` is fine, and its `useForegroundPermissions()` isn't.

To use a native module by name instead of importing a library, the library has `turboModule()` and `nativeModule()`. See [Native modules](../packages/svelte-native/README.md#native-modules) in the package README.

## Native views

A map, a video player and an image with a blur are views: the platform draws them. Svelte Native has Svelte components for the common ones, in `@example/svelte-native/foreign`, and for SVG in `@example/svelte-native/svg`:

| Library | Components |
| --- | --- |
| expo-image, expo-blur, expo-linear-gradient, expo-conic-gradient | `ExpoImage`; `BlurView`; `LinearGradient`; `ConicGradient` |
| react-native-video, expo-video, lottie-react-native, rive-react-native | `Video`; `VideoView`; `LottieView`; `Rive` |
| react-native-pdf, react-native-webview, react-native-maps | `Pdf`; `WebView`; `MapView` and `Marker` |
| react-native-svg | `Svg`, shapes, text, gradients |

[The package README](../packages/svelte-native/README.md#native-views-from-other-libraries) has the full list. Install the library, then import the component:

```sh
npx expo install expo-linear-gradient
```

Four of these libraries (`lottie-react-native`, `react-native-maps`, `react-native-pdf` and `react-native-video`) need a patch from the library, or they lose events on Android. Pin the library at the patch's version, and run `pnpm exec svelte-native init` again: it copies the patch into `patches/svelte-native/` and declares it in `pnpm-workspace.yaml` ([Project structure](03-project-structure.md#patches)). `svelte-native doctor` tells you if one is missing.

A touch inside a native view goes to the view, not to your JavaScript. If you need the touches of its frame, give it `pointerEvents="box-only"`.

For a view without a ready component, `ForeignView` mounts a React Native component by its name.

For the native view of any other Expo module, `defineExpoView` makes a typed Svelte component of it, with no wrapper written for the library:

```svelte
<!--- file: src/routes/camera/+mobile.svelte --->
<script lang="ts">
	import { Pressable, Text } from '@example/svelte-native';
	import { defineExpoView, type ExpoViewHandle } from '@example/svelte-native/foreign';
	import type { CameraNativeProps, CameraViewRef } from 'expo-camera';

	const CameraView = defineExpoView<CameraNativeProps, CameraViewRef>('ExpoCamera');
	let camera: ExpoViewHandle<CameraViewRef> | null = null;
</script>

<CameraView facing="back" barcodeScannerEnabled={false} style={{ flex: 1 }} ref={(handle) => (camera = handle)} />
<Pressable onPress={async () => console.log((await camera?.takePicture({ quality: 1 }))?.uri)}>
	<Text>Take a picture</Text>
</Pressable>
```

The component is the native view, not the library's React component. Its props are the names the native module declares, an `on…` handler gets React Native's event object (`{ nativeEvent }`), and `ref` gives you the functions the module defines for the view.

## What you can't use

A library whose API is its React components or hooks can't be imported, because there is no React in the app. That covers UI kits written for React, data libraries built on hooks, and anything that calls `useState`. You have three options:

- Use its native module directly, by name, as the library's own wrappers do.
- Use a Svelte equivalent.
- Write the part you need yourself.

Svelte's DOM transitions and libraries that touch the DOM don't apply either: there is no DOM.

## Further reading

- Expo's [library catalog](https://docs.expo.dev/versions/latest/) lists the modules available for SDK 57.
- [The package README](../packages/svelte-native/README.md#native-views-from-other-libraries) for every wrapper, what its patch changes, and how events behave on Android.
