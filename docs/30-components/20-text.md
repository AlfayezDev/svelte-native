---
title: Text
group: Basics
video: text
---

`Text` draws text. It's the only component that can: a string anywhere else isn't drawn. A `Text` inside a `Text` styles part of a sentence, as a `span` does on the web.

```svelte
<!--- file: src/routes/+mobile.svelte --->
<script lang="ts">
	import { Screen, Text, View } from '@alfayez/svelte-native';

	let name = $state('Amal');
</script>

<Screen title="Text">
	<View style={{ padding: 20, gap: 8 }}>
		<Text style={{ fontSize: 28, fontWeight: '700' }}>Hello, {name}</Text>
		<Text style={{ fontSize: 16, color: '#374151' }}>
			You have <Text style={{ fontWeight: '700', color: '#ff3e00' }}>3 new messages</Text> waiting.
		</Text>
		<Text numberOfLines={1} ellipsizeMode="tail">A long line that ends with an ellipsis when it doesn't fit on one line of the screen.</Text>
	</View>
</Screen>
```

A `Text` without a `color` has the system's text colour, in the app's light or dark mode: black or white on iOS, Material's near-black or near-white on Android. A `Text` inside another takes its colour from it. [Light and dark mode](styling#light-and-dark-mode) shows how to switch your own colours.

## Props

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `children` | `Snippet` | | The text, and nested `Text`s. |
| `style` | `TextStyle` | | `color`, `fontSize`, `fontWeight`, `fontFamily`, `fontStyle`, `lineHeight`, `letterSpacing`, `textAlign`, `textDecorationLine`, `textTransform`, and the layout keys of a `View`. |
| `class` | `ClassValue` | | A list of classes: a string, an array or an object, as on a DOM element in Svelte. Their style goes under `style`, which wins. Needs the `css` option ([Classes](styling#classes)). |
| `numberOfLines` | `number` | | Cuts the text to this many lines. |
| `ellipsizeMode` | `'head' \| 'middle' \| 'tail' \| 'clip'` | `'tail'` | Where the ellipsis goes when the text is cut. |
| `selectable` | `boolean` | `false` | Lets the user select and copy the text. |
| `onPress`, `onLongPress` | `(event) => void` | | Makes the text tappable, for a link inside a sentence. |
| `onPressIn`, `onPressOut`, `onPressChange` | | | As on [`Pressable`](pressable#props). |
| `allowFontScaling` | `boolean` | `true` | Follows the user's font size setting. |
| `maxFontSizeMultiplier` | `number` | | The largest scale the font size setting can apply. |
| `adjustsFontSizeToFit` | `boolean` | `false` | Shrinks the font until the text fits its box. |
| `gesture` | `Gesture` | | A gesture to recognise on the text. See [gestures](gestures). |
| `accessibilityRole` | `string` | | Use `'header'` for a heading and `'link'` for a link. |

It also takes the other props of React Native's [`Text`](https://reactnative.dev/docs/text).

## Nested text

A nested `Text` inherits the style of the one around it and overrides what it sets. Only the outer `Text` is a box: nested ones flow inside its lines, and their layout keys (padding, margin, width) don't apply.

A nested `Text` with `onPress` is a link inside a sentence:

```svelte
<Text style={{ fontSize: 16 }}>
	By continuing you accept the <Text style={{ color: '#2563eb' }} onPress={() => console.log('terms')}>terms</Text>.
</Text>
```

The press goes to the nested `Text` under the finger and to nothing else: the `Text` around it, which can have an `onPress` of its own for the rest of the sentence, does not hear it. A nested `Text` without a handler passes the press on to the one around it. `onPressChange` says while the link is held, to colour it, and a finger that moves far off the sentence cancels the press, as on any pressable. Give the link `role="link"` so that a screen reader lists it as one.

## Whitespace

`Text` keeps whitespace as you write it. A browser collapses whitespace with CSS, and there's no CSS here, so a sentence split over two source lines shows the line break and the next line's indentation:

```svelte
<Text>
	A sentence that is split
	across two source lines.
</Text>
<!-- draws "A sentence that is split", a line break, a tab, "across two source lines." -->
```

The Svelte compiler still removes the whitespace at the start and end of an element's content, and turns the whitespace between a string and a nested element into one space. Inside a string, nothing changes.

Write a long sentence on one source line, or as a string expression:

```svelte
<Text>{'A long sentence, written as one string so that the editor can wrap it however it likes.'}</Text>
```

## Fonts

`fontFamily` picks a font by name. The system's sans-serif is the default. The names of the other system families differ per platform: `'serif'` and `'monospace'` on Android, `'Georgia'` and `'Menlo'` on iOS, for example. A font you bundle with the app (with the `expo-font` config plugin) is used by the name the font file declares.
