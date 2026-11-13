---
title: BlurView
group: Navigation and effects
video: blur-view
---

`BlurView` blurs whatever is behind it on the screen, and draws its children sharp on top: a frosted card over a photo, a header over a list. It is part of Svelte Native, so there is nothing to install and nothing to point it at; it is native code, so an app needs a new native build (not an over-the-air update) the first time it uses it.

```svelte
<!--- file: src/routes/+mobile.svelte --->
<script lang="ts">
	import { BlurView, Image, Text, View } from '@alfayez/svelte-native';
</script>

<View style={{ height: 200 }}>
	<Image source={{ uri: 'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=800&h=400&fit=crop&fm=jpg&q=70' }} style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }} />
	<BlurView intensity={60} tint="light" style={{ margin: 24, padding: 16, borderRadius: 16, overflow: 'hidden' }}>
		<Text style={{ fontSize: 18, fontWeight: '600' }}>Frosted</Text>
	</BlurView>
</View>
```

On iOS it is a `UIVisualEffectView`. On Android 12 and later it draws the screen behind it, blurred; earlier Android versions draw the tint only, a little stronger.

## Props

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `intensity` | `number` | `50` | How much it blurs, from 0 (none) to 100. |
| `tint` | `string` | `'default'` | The frost over the blur: `'light'`, `'extraLight'`, `'dark'`, `'regular'`, `'prominent'`, the iOS materials (`'systemThinMaterial'`, `'systemMaterialDark'`, ...), or `'default'`, which follows the system's light or dark mode. |
| `style` | `ViewStyle` | | The view's own style. Round it with `borderRadius` and `overflow: 'hidden'`. |
| `class` | `ClassValue` | | A list of classes: a string, an array or an object, as on a DOM element in Svelte. Their style goes under `style`, which wins. Needs the `css` option ([Classes](styling#classes)). |
| `children` | snippet | | Drawn on top of the blur, not blurred. |
| `ref` | `(handle) => void` | | The view's handle, like [`View`'s](view#ref). |

## What it blurs

It blurs what is drawn before it on the screen: the views behind it, and the screen's own background. On Android, a video, a map or a camera preview behind it isn't in the blur, because those draw on a surface of their own; iOS blurs them live. During a screen transition Android keeps the last picture until the screen settles.

On Android each `BlurView` draws the screen behind it into a small picture again whenever something on the screen changes, so a few on a screen are fine and dozens (one per list row) are not.

For `expo-blur`'s own view and props (`blurTarget`, `blurMethod`), use [`ExpoBlurView`](native-views#expoblurview-and-blurtargetview).
