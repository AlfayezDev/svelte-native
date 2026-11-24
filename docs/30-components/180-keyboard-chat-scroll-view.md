---
title: KeyboardChatScrollView
group: Scrolling and overlays
---

`KeyboardChatScrollView` is a [`ScrollView`](scroll-view) for a chat thread. When the keyboard opens, its content lifts with the keyboard, frame by frame, so the last message stays just above the keyboard; when the keyboard closes the content comes back. `keyboardLiftBehavior` says when it lifts, and `onEndVisible` tells you whether the end of the thread is in view.

```svelte
<!--- file: src/routes/chat/+mobile.svelte --->
<script lang="ts">
	import { KeyboardChatScrollView, KeyboardStickyView, Screen, Text, TextInput, View, insets } from 'expo-svelte';

	let atEnd = $state(true);
	const messages = Array.from({ length: 40 }, (_, index) => `Message ${index + 1}`);
</script>

<Screen title="Chat">
	<View style={{ flex: 1 }}>
		<KeyboardChatScrollView
			keyboardLiftBehavior="whenAtEnd"
			onEndVisible={(visible) => (atEnd = visible)}
			style={{ flex: 1 }}
			contentContainerStyle={{ padding: 16, gap: 8 }}
		>
			{#each messages as message (message)}
				<Text>{message}</Text>
			{/each}
		</KeyboardChatScrollView>
		<KeyboardStickyView offset={{ closed: 0, opened: insets.bottom }}>
			<TextInput placeholder="Message" accessibilityLabel="Message" style={{ margin: 12 }} />
		</KeyboardStickyView>
	</View>
</Screen>
```

## Props

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `keyboardLiftBehavior` | `'always' \| 'whenAtEnd' \| 'never'` | `'always'` | When the content lifts with the keyboard. See [when it lifts](#when-it-lifts). |
| `offset` | `number` | `0` | The distance, in points, between the bottom of the scroll view and the bottom of the screen (a tab bar, an inset). The content lifts by the keyboard's height less this. |
| `onEndVisible` | `(visible: boolean) => void` | | Called when the end of the content comes into view (`true`) or leaves it (`false`), and once when the scroll view has been laid out. |
| `ref` | `(instance) => void` | | As [`ScrollView`](scroll-view#props)'s. |

It also takes the props of [`ScrollView`](scroll-view#props).

## When it lifts

| `keyboardLiftBehavior` | What happens |
| --- | --- |
| `'always'` | The content lifts whatever the scroll position. |
| `'whenAtEnd'` | The content lifts only when the last message is in view, within 20 points of the end, at the moment the keyboard starts to open. A thread scrolled up to older messages stays where it is. |
| `'never'` | The content stays where it is. |

Whichever it is, the scroll view keeps the room the keyboard takes at its bottom for as long as the keyboard is up, so the thread can be scrolled past its last message, and gives it back when the keyboard has closed. When the keyboard closes, a thread that lifted comes back by the distance it lifted, not by the keyboard's height.

## How it moves

On Android the lift is the engine's, on the main thread: each frame of the keyboard's animation sets the scroll offset, in the frame the keyboard moves in, with no JavaScript in between. `onEndVisible` is told from the scroll view's own position, and so is the decision of `whenAtEnd`. Elsewhere the component is a plain `ScrollView`; `onEndVisible` still works, from the scroll events.

A list that is not inverted is covered. An `inverted` list, `keyboardLiftBehavior="persistent"` and the blank space and extra padding of react-native-keyboard-controller's `KeyboardChatScrollView` are not.
