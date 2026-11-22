---
title: Stack
group: Navigation and effects
video: routing
---

`Stack` sets the defaults of every screen in a stack navigator: the header style, the transition, the background, the system bars. You write it in the layout of the stack, around `children`. It draws nothing itself: the stack is the navigator the routes make, and `Stack` only configures it.

```svelte
<!--- file: src/routes/+layout.mobile.svelte --->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import { Stack, colorScheme } from 'expo-svelte';

	let { children }: { children: Snippet } = $props();
</script>

<Stack
	header={{ tint: '#ff3e00' }}
	animation="slide_from_right"
	statusBar={{ style: 'auto' }}
	style={{ backgroundColor: colorScheme.current === 'dark' ? '#000000' : '#ffffff' }}
>
	{@render children()}
</Stack>
```

The root layout, `src/routes/+layout.mobile.svelte`, holds the app's root stack, and a layout that exports `navigator = 'stack'` holds a nested one. See [navigators](routing#navigators).

## Props

| Prop | Type | Description |
| --- | --- | --- |
| `header` | `HeaderOptions` | The header options of every screen: `large`, `tint`, `background`, `hideShadow`, ... See [Screen's header](screen#header). |
| `animation` | `'default' \| 'android_activity' \| 'fade' \| 'slide_from_right' \| 'slide_from_left' \| 'slide_from_bottom' \| 'fade_from_bottom' \| 'simple_push' \| 'flip' \| 'none'` | How screens are pushed and popped. React Navigation's native-stack values, plus `'android_activity'`; see [animations](#animations). |
| `gestureEnabled` | `boolean` | Whether screens can be swiped away. |
| `statusBar` | `{ style?: 'auto' \| 'light' \| 'dark'; hidden?: boolean }` | The status bar. `{ style: 'auto' }` follows light and dark mode. |
| `navigationBar` | `{ color?: string; style?: 'auto' \| 'light' \| 'dark' }` | Android's system navigation bar. |
| `style` | `ViewStyle` | The style of each screen's content area. |
| `loading` | `Snippet<[location]>` | Shown in a screen while its page's code loads. It receives the screen's location: `url`, `params` and `route`. |
| `children` | `Snippet` | The navigator: render `children` here. |

Each screen's own [`Screen`](screen) options win over these, option by option, and object options merge key by key. A stack without `Stack` gives its screens no defaults.

## Screen backgrounds

Every screen is opaque, so a pushed screen hides the one below it once it is in. On Android, with the default animation the one below fades out before the new one fades in, with `'fade'` the two crossfade over the new screen's background, and the others cover it as they move. One without a background of its own takes its stack's (a page whose `<Screen style>` sets only a padding keeps the `Stack`'s colour), else the one of the screen it is in: the screens of a tab, or of a nested stack, look as the screen around them does. A screen inside none has the system's: white or black on iOS, Material's surface on Android, in the app's light or dark mode. A transparent modal has none, and neither do the screens inside it or inside a `<Modal transparent>`. `style={{ backgroundColor }}` (or a `class`) on the `Stack` gives every screen of the stack yours, and the stacks inside them take it; [light and dark mode](styling#light-and-dark-mode) shows how to switch it with the mode.

## Animations

`animation` takes the values of React Navigation's native stack, so a screen option written for Expo Router means the same here, and adds `'android_activity'`. Only `'default'` differs from React Navigation on Android, on purpose; the other differences are on iOS, where a push is UIKit's.

| `animation` | Android | iOS | React Navigation's native stack |
| --- | --- | --- | --- |
| `'default'` | Both screens move 96 dp together over 450 ms (the movement of Android's own transition between two screens) and fade through: the one going away fades out, then the new one fades in, so their content never shows at once. | UIKit's push: the new screen slides in across the width while the one below moves part of the way left. | Android: `'android_activity'` (with 10 % of the width). iOS: the same push. |
| `'android_activity'` | Android's transition between two screens as it is: the same movement, the new screen fading in over 83 ms over the one below, which stays opaque. | UIKit's push. | Its Android default. |
| `'fade'` | Both screens crossfade over 150 ms. | A modal cross-dissolves; a push is UIKit's push. | Fades on both. |
| `'slide_from_right'` | Both screens slide the whole width over 400 ms, the new one in from the right. | UIKit's push. | The same; on iOS the default. |
| `'slide_from_left'` | The same from the left. | UIKit's push. | The same; on iOS the default. |
| `'slide_from_bottom'` | The new screen rises the whole height over 400 ms over the one below. | UIKit's push. | Slides up on both. |
| `'fade_from_bottom'` | The new screen rises 8 % while it fades in (350 ms); it sinks and fades out when popped (250 ms). | UIKit's push. | Fades up on both. |
| `'simple_push'` | The default. | UIKit's push, with its shadow. | Android: the default. iOS: the push without its shadow and header transition. |
| `'flip'` | The default. | A full-screen modal flips over. | Android: the default. iOS: the same flip. |
| `'none'` | No animation. | No animation. | No animation. |

The Android values other than `'default'` and `'android_activity'` are react-native-screens' own: the same distances, times and curves. A modal, a sheet or a form sheet on Android comes up from the bottom, and a transparent modal fades in; of the values, only `'none'`, `'fade'` (it fades in alone), `'slide_from_right'` and `'slide_from_bottom'` (a transparent modal then comes from the bottom) change that. The back gesture and the edge swipe move the screen with the finger whatever the animation; when they complete, the screen leaves to the right from where they took it: with `'default'` and `'android_activity'` it moves on and fades out, with the others it slides off across the width.

## Loading

Pages load when they're first shown. Without a `loading` snippet, a screen you navigate to comes in once its page has loaded (in an app's bundle that takes a moment, not a frame), so its own `<Screen>` options, its `animation` included, are there from the start. With one, the screen comes in at once and the snippet fills it meanwhile, usually for a split second; the page's options then arrive with the page, too late for the push's animation (put the animation on the `Stack` instead):

```svelte
<Stack>
	{#snippet loading()}
		<View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
			<ActivityIndicator />
		</View>
	{/snippet}
	{@render children()}
</Stack>
```
