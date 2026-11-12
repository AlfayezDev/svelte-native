---
title: Platform APIs
video: platform-apis
---

The device is more than a screen. It has an operating system, a window size, a light and dark mode, a safe area around the notch, a keyboard, and links that open your app. This page covers how to read and use them.

`@example/svelte-native/platform` exports React Native's platform modules, typed, for an app without React. They are React Native's own objects, so a library that imports them from `react-native` sees the same state. Each one loads the first time you use it.

```svelte
<!--- file: src/routes/+mobile.svelte --->
<script lang="ts">
	import { Screen, Text } from '@example/svelte-native';
	import { Dimensions, Platform } from '@example/svelte-native/platform';

	const { width, height } = Dimensions.get('window');
</script>

<Screen title="Device">
	<Text>{Platform.OS} {Platform.Version}, {Math.round(width)} x {Math.round(height)} points</Text>
</Screen>
```

## Platform

`Platform.OS` is `'ios'` or `'android'`. `Platform.Version` is the system version: a number (the API level) on Android, a string on iOS. `Platform.select` picks a value per platform:

```ts
import { Platform } from '@example/svelte-native/platform';

const label = Platform.select({ ios: 'iPhone', android: 'Android phone' });
const shadow = Platform.OS === 'ios' ? { shadowOpacity: 0.2, shadowRadius: 8 } : { elevation: 4 };
```

## Light and dark mode

`colorScheme.current`, from the main entry, is `'light'` or `'dark'`. A template, `$derived` or `$effect` that reads it runs again when the user switches:

```svelte
<script lang="ts">
	import { Text, colorScheme } from '@example/svelte-native';
</script>

<Text style={{ color: colorScheme.current === 'dark' ? '#ffffff' : '#000000' }}>Hello</Text>
```

[Styling](styling#light-and-dark-mode) shows how to build a theme on it. `Appearance` is the underlying React Native module, with `getColorScheme()` and `addChangeListener(listener)`, for code outside a component.

## Window size

`windowSize` is the window's size, reactive like [`colorScheme`](#light-and-dark-mode): read it in the markup, a `$derived` or an `$effect`, and that part runs again when the window changes (the device turns, a foldable opens, split screen, the user's text size).

```svelte
<script lang="ts">
	import { Text, View, windowSize } from '@example/svelte-native';

	const wide = $derived(windowSize.width >= 768);
	const columns = $derived(Math.max(1, Math.floor(windowSize.width / 180)));
</script>

<View style={{ flexDirection: wide ? 'row' : 'column' }}>
	<Text>{columns} columns at {windowSize.width} × {windowSize.height}</Text>
</View>
```

| Property | What it is |
| --- | --- |
| `width`, `height` | The window, in points. |
| `scale` | The pixel density (pixels per point). |
| `fontScale` | The user's text size setting (1 is the default). |
| `screen` | `{ width, height }` of the whole screen. |

All the readers share one listener, added when the first one renders and removed when the last one goes. Read outside the markup, `$derived` or `$effect` (in an event handler, say), it gives the current value and subscribes to nothing.

Svelte's own reactive window values work too, from the same import as on the web, so a component shared with your SvelteKit pages needs no change: `innerWidth`, `innerHeight`, `outerWidth`, `outerHeight` and `devicePixelRatio` read the same values, and the ones a native app has no counterpart for (`scrollX`, `scrollY`, `screenLeft`, `screenTop`, `online`) are `undefined`, as on the server.

```svelte
<script lang="ts">
	import { innerWidth } from 'svelte/reactivity/window';

	const wide = $derived((innerWidth.current ?? 0) >= 768);
</script>
```

`Dimensions` itself is in `@example/svelte-native/platform` (`Dimensions.get('window')`, `Dimensions.addEventListener('change', ...)`), and `PixelRatio.roundToNearestPixel(points)` aligns a size to whole pixels.

## Safe area and keyboard

`insets`, from the main entry, is reactive state that says how much of the screen the system takes: the status bar, the notch, the home indicator, and the keyboard when it's open. Read it anywhere, and the view updates when it changes.

| Field | Description |
| --- | --- |
| `top`, `right`, `bottom`, `left` | The safe area insets, in points. |
| `keyboardVisible` | Whether the keyboard is open. |
| `keyboardHeight` | The keyboard's height, in points. 0 when it's closed. |
| `frame` | The app's window, `{ x, y, width, height }`. |

```svelte
<script lang="ts">
	import { Text, View, insets } from '@example/svelte-native';
</script>

<View style={{ flex: 1, paddingBottom: insets.keyboardVisible ? insets.keyboardHeight : insets.bottom }}>
	<Text>The content ends above the keyboard.</Text>
</View>
```

Usually you don't need it directly. Content under a native header already starts below it, [`SafeAreaView`](safe-area-view) pads its content by the insets, and [`KeyboardAvoidingView`](keyboard-avoiding-view) moves content out of the keyboard's way.

`Keyboard` is React Native's keyboard module: `Keyboard.dismiss()` closes the keyboard, `Keyboard.isVisible()` says whether it's open, and `Keyboard.addListener('keyboardDidShow', listener)` reports it opening.

## Links

`Linking` opens other apps and web pages, and tells you about links that opened yours:

```ts
import { Linking } from '@example/svelte-native/platform';

await Linking.openURL('https://svelte.dev');        // the browser
await Linking.openURL('mailto:hello@example.com');  // the mail app
await Linking.openSettings();                       // this app's page in the system settings
```

You don't need `Linking` to handle links into your app. The router opens a link that matches one of your routes, whether it started the app or arrived while it was running: see [Routing](routing#deep-links). `Linking.getInitialURL()` and `Linking.addEventListener('url', listener)` are there for links the router doesn't handle.

## App state

`AppState.currentState` is `'active'`, `'background'` or `'inactive'`. Listen for changes to pause work while the app isn't on screen:

```svelte
<script lang="ts">
	import { AppState } from '@example/svelte-native/platform';

	$effect(() => {
		const subscription = AppState.addEventListener('change', (state) => {
			if (state === 'active') refresh();
		});
		return () => subscription.remove();
	});
</script>
```

## Back button

Android's back button already goes back in your app's navigation, through the router. `BackHandler` is for a screen that needs to handle it differently, such as a form that asks before it's left:

```svelte
<script lang="ts">
	import { BackHandler } from '@example/svelte-native/platform';

	let dirty = $state(false);

	$effect(() => {
		const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
			if (!dirty) return false; // let the router go back
			confirmLeaving();
			return true; // handled here
		});
		return () => subscription.remove();
	});
</script>
```

## Alerts, sharing and vibration

```ts
import { Alert, Share, Vibration } from '@example/svelte-native/platform';

Alert.alert('Delete this note?', 'You can’t undo this.', [
	{ text: 'Cancel', style: 'cancel' },
	{ text: 'Delete', style: 'destructive', onPress: () => remove() }
]);

await Share.share({ message: 'Have a look at this', url: 'https://svelte.dev' });

Vibration.vibrate(50);
```

`Alert.alert` shows the system's alert dialog, `Share.share` opens the share sheet, and `Vibration.vibrate` buzzes for a number of milliseconds or a pattern. For richer haptics, use `expo-haptics`: see [Native libraries](native-libraries).
