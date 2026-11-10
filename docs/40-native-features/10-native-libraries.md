---
title: Native libraries
---

The Expo and React Native ecosystem has libraries for most of what a phone can do: sensors, notifications, location, secure storage, haptics. Svelte Native can use the ones whose API is plain JavaScript functions. This page shows how to add one, and what to do when a library's API is React.

For libraries that draw a view (images, video, maps), see [Native views](native-views).

## Adding a library

Import the library's functions and call them, as you would in any JavaScript project:

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

A library like this brings native code with it, so adding it takes three steps:

```sh
npx expo install expo-haptics
pnpm exec expo prebuild --platform android
pnpm android
```

1. `npx expo install` picks the version that matches Expo SDK 57.
2. If the library has a config plugin or needs permissions, add them to `app.json` as its documentation says.
3. Prebuild and build again, because the app on your device doesn't contain the new native code yet. [Development builds](development-builds#when-to-run-expo-prebuild) says when a prebuild is needed.

Libraries that have been loaded this way include `expo-notifications`, `expo-location`, `expo-secure-store`, `expo-web-browser`, `expo-file-system`, `@react-native-async-storage/async-storage` and `react-native-mmkv`.

## Functions work, hooks don't

There is no React in a Svelte Native app, so a library's React hooks can't run. Its plain functions can. For example, `expo-location`'s `getCurrentPositionAsync()` works, and its `useForegroundPermissions()` hook doesn't. Most Expo libraries offer both, and the hook is a thin wrapper around a function you can call yourself:

```svelte
<!--- file: src/routes/location/+mobile.svelte --->
<script lang="ts">
	import { Screen, Text } from '@example/svelte-native';
	import * as Location from 'expo-location';

	let position = $state<Location.LocationObject | null>(null);

	$effect(() => {
		Location.requestForegroundPermissionsAsync().then(async ({ granted }) => {
			if (granted) position = await Location.getCurrentPositionAsync();
		});
	});
</script>

<Screen title="Where am I?">
	<Text>{position ? `${position.coords.latitude}, ${position.coords.longitude}` : 'Locating…'}</Text>
</Screen>
```

To keep a value up to date, put the library's subscription in an `$effect` and return its cleanup, so it ends when the screen goes away.

## Calling a native module directly

When a library has no plain-JavaScript entry, or you wrote a native module yourself, call the module by name. `@example/svelte-native/native-modules` has the two lookups React Native uses, and Expo modules work through `expo-modules-core` as usual:

```ts
/// file: src/lib/native.ts
import { nativeModule, turboModule } from '@example/svelte-native/native-modules';
import { requireNativeModule } from 'expo-modules-core';

// A TurboModule, by name. Throws when the build doesn't have it.
const blobUtil = turboModule<{ getConstants(): object }>('ReactNativeBlobUtil');

// A legacy NativeModule, by name. undefined when the build doesn't have it.
const legacy = nativeModule<{ ping(): void }>('MyLegacyModule');

// An Expo module.
const fileSystem = requireNativeModule('ExpoFileSystem');
```

The type argument describes the module's functions. Your own Expo modules go in the app's `modules/` directory, where Expo's autolinking finds them.

## What you can't use

A library whose API is React components or hooks can't be imported: UI kits written for React, data libraries built on hooks, and anything that calls `useState`. You have three ways around it:

- Call its native module directly, by name, as shown above. Many React wrappers are thin, and the native module does the real work.
- Use a Svelte library that does the same job, as long as it doesn't touch the DOM.
- Write the part you need yourself.

Libraries that use the DOM don't apply either, Svelte's `transition:` directives included. There is no DOM: use [Animation](animation) instead.
