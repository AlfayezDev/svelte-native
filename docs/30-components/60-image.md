---
title: Image
group: Basics
video: image
---

`Image` shows a picture: a file bundled with the app, or one from a URL.

```svelte
<!--- file: src/routes/+mobile.svelte --->
<script lang="ts">
	import { Image, Screen, Text, View } from '@example/svelte-native';
	import photo from '../../assets/images/photo.png';

	let status = $state('loading');
</script>

<Screen title="Images">
	<View style={{ padding: 20, gap: 12 }}>
		<Image source={photo} resizeMode="cover" accessibilityLabel="A sunset over hills" style={{ height: 160, borderRadius: 12 }} />
		<Image
			source={{ uri: 'https://picsum.photos/id/1015/600/400' }}
			resizeMode="cover"
			accessibilityLabel="A river between mountains"
			onLoad={() => (status = 'loaded')}
			onError={() => (status = 'failed')}
			style={{ height: 160, borderRadius: 12, backgroundColor: '#e5e7eb' }}
		/>
		<Text>The second image is {status}.</Text>
	</View>
</Screen>
```

## Sources

- **A bundled file.** Import it, or `require()` it: `import photo from '../assets/photo.png'`. Metro bundles the file with the app, picks the `@2x` or `@3x` file for the screen when you have them, and the image takes the file's size unless the style says otherwise.
- **A URL.** `{ uri: 'https://...' }`, with `headers` when the server needs them: `{ uri, headers: { Authorization: 'Bearer ...' } }`. A network image has no size until it loads, so give it a `width` and a `height` (or a `height` and let `alignSelf: 'stretch'` set the width).
- **A file or data URI.** `{ uri: 'file:///...' }`, or `{ uri: 'data:image/png;base64,...' }`.

## Props

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `source` | `ImageSource` | | What to show: an imported file, `{ uri, headers?, width?, height? }`, or an array of sources at different sizes. |
| `resizeMode` | `'cover' \| 'contain' \| 'stretch' \| 'repeat' \| 'center'` | `'cover'` | How the picture fills the image's box. |
| `style` | `ImageStyle` | | Size, border, border radius, `tintColor` and the layout keys. |
| `class` | `ClassValue` | | A list of classes: a string, an array or an object, as on a DOM element in Svelte. Their style goes under `style`, which wins. Needs the `css` option ([Classes](styling#classes)). |
| `defaultSource` | `ImageSource` | | A bundled image shown while a network one loads. |
| `blurRadius` | `number` | | Blurs the picture. |
| `onLoadStart`, `onLoad`, `onLoadEnd` | `(event) => void` | | Loading started, succeeded, finished either way. |
| `onError` | `(event) => void` | | The picture couldn't be loaded. |
| `accessibilityLabel` | `string` | | What a screen reader says. Leave it out, with `accessible={false}`, for a purely decorative image. |
| `gesture` | `Gesture` | | A gesture to recognise on the image. See [gestures](gestures). |

It also takes the other props of React Native's [`Image`](https://reactnative.dev/docs/image).

For placeholders (blurhash, thumbhash), transitions between pictures and control over caching, use `ExpoImage` from `@example/svelte-native/foreign`, which is [expo-image](native-views).
