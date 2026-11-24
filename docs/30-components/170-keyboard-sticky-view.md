---
title: KeyboardStickyView
group: Layout and status
---

`KeyboardStickyView` is a [`View`](view) that sticks to the keyboard. When the keyboard opens it rises with it, and when the keyboard closes it comes back down, so a message composer or a bottom button is always just above the keyboard's top edge.

```svelte
<!--- file: src/routes/chat/+mobile.svelte --->
<script lang="ts">
	import { KeyboardStickyView, Pressable, Screen, Text, TextInput, View, insets } from 'expo-svelte';

	let draft = $state('');
</script>

<Screen title="Chat">
	<View style={{ flex: 1 }}>
		<View style={{ flex: 1 }} />
		<KeyboardStickyView offset={{ closed: 0, opened: insets.bottom }}>
			<View style={{ flexDirection: 'row', gap: 8, padding: 12, paddingBottom: 12 + insets.bottom }}>
				<TextInput bind:value={draft} placeholder="Message" accessibilityLabel="Message" style={{ flex: 1 }} />
				<Pressable accessibilityRole="button" onPress={() => (draft = '')}>
					<Text>Send</Text>
				</Pressable>
			</View>
		</KeyboardStickyView>
	</View>
</Screen>
```

## Props

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `offset` | `{ closed?: number; opened?: number }` | `{ closed: 0, opened: 0 }` | Extra translation, in points, added to the keyboard's: `closed` while the keyboard is closed, `opened` while it is open, and in proportion in between. See [offset](#offset). |
| `enabled` | `boolean` | `true` | `false` leaves the view at its `closed` offset whatever the keyboard does. |
| `ref` | `(handle: HostHandle \| null) => void` | | Receives the view's handle, or `null` when it goes. |
| `style` | `ViewStyle` | | As a `View`'s. |
| `class` | `ClassValue` | | A list of classes: a string, an array or an object, as on a DOM element in Svelte. Their style goes under `style`, which wins. Needs the `css` option ([Classes](styling#classes)). |
| `children` | `Snippet` | | The content. |

It also takes the props of [`View`](view#props).

## How it moves

On Android the view moves with every frame of the keyboard's own animation: the engine writes its translation on the main thread, in the frame the keyboard moves in, so the two never part, however busy JavaScript is. The translation is the keyboard's height, minus nothing, plus the offset for how far the keyboard has opened:

```
translateY = -height + closed + (opened - closed) × progress
```

`height` is how much of the screen the keyboard covers at that frame and `progress` is `height` over the height the keyboard opens to, so the view is `closed` points from where it stands while the keyboard is closed, and `opened` points from where the keyboard puts it once it is open.

A transform in the view's own `style` is kept: the keyboard's move is added to it.

On iOS the view moves to where the keyboard will be when the keyboard starts to move, in one step.

## offset

The keyboard's height is how much it covers of the screen, which includes the system navigation bar's space when the app draws under it. A composer that already pads its bottom by `insets.bottom` to clear the navigation bar should stay clear of it when the keyboard is closed and sit right on the keyboard when it is open, where the bar is covered: `offset={{ closed: 0, opened: insets.bottom }}` moves it down by that padding once the keyboard is up.

Views in a [`Modal`](modal) are not moved frame by frame: a modal is a window of its own, with its own keyboard animation.
