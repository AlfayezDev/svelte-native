---
title: View
group: Basics
video: view
---

`View` is the basic box of a native screen, the counterpart of a `div`. It lays out its children with flexbox, draws a background, a border and a shadow, and can react to a tap. On Android it's an Android `View`, on iOS a `UIView`.

```svelte
<!--- file: src/routes/+mobile.svelte --->
<script lang="ts">
	import { Screen, Text, View } from '@rasheed/svelte-native';
</script>

<Screen title="Profile">
	<View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 20 }}>
		<View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: '#ff3e00' }} />
		<View style={{ flex: 1 }}>
			<Text style={{ fontSize: 17, fontWeight: '600' }}>Amal</Text>
			<Text style={{ color: '#6b7280' }}>Joined in March</Text>
		</View>
	</View>
</Screen>
```

A `View` has no styling of its own: no margin, no padding, no colour. Its children are laid out in a column, as with `display: flex; flex-direction: column` on the web. [Styling](styling) explains the style object and the layout rules.

A `View` can't hold text directly. A string outside a [`Text`](text) isn't drawn.

## Props

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `children` | `Snippet` | | The content. |
| `style` | `ViewStyle` | | Layout, background, border, shadow, opacity, transform. See [styling](styling). |
| `class` | `ClassValue` | | A list of classes: a string, an array or an object, as on a DOM element in Svelte. Their style goes under `style`, which wins. Needs the `css` option ([Classes](styling#classes)). |
| `onPress` | `(event) => void` | | Called when the view is tapped. Any of the press props makes the view respond to touches. |
| `onPressIn`, `onPressOut` | `(event) => void` | | A finger went down on the view, or came up. |
| `onLongPress` | `(event) => void` | | A press was held for `delayLongPress` milliseconds. |
| `onPressChange` | `(pressed: boolean) => void` | | `true` when a press becomes active, `false` when it ends. Keep it in a `$state` to draw a pressed look. |
| `delayLongPress` | `number` | `500` | Milliseconds before `onLongPress`. |
| `hitSlop` | `number \| Insets` | | How far outside the view a touch still counts. |
| `gesture` | `Gesture` | | A gesture from `@rasheed/svelte-native/gestures` to recognise on this view. See [gestures](gestures). |
| `ref` | `(handle: HostHandle \| null) => void` | | Receives the view's handle when it's created, and `null` when it's destroyed. See [ref](#ref). |
| `onLayout` | `(event) => void` | | Called with the view's size and position (`event.nativeEvent.layout`) after every layout that changes them. |
| `pointerEvents` | `'auto' \| 'none' \| 'box-none' \| 'box-only'` | `'auto'` | Whether the view and its children take touches. `'box-none'`: the children do, the view doesn't. |
| `collapsable` | `boolean` | `true` | A view that only lays out its children can be removed from the native tree. Set `false` when you need its native view, to measure or capture it. |
| `accessible`, `accessibilityLabel`, `accessibilityRole`, `accessibilityHint`, `accessibilityState` | | | What a screen reader says for the view. |
| `testID` | `string` | | An id for end-to-end tests. |

It also takes the other props of React Native's [`View`](https://reactnative.dev/docs/view).

For a button, use a [`Pressable`](pressable) with `accessibilityRole="button"`: it says what it is to a screen reader. A tappable `View` is fine for rows and cards that already have a label.

## Pressed state

The press props of a `View` are the same as [`Pressable`'s](pressable#props). To change the look while a finger is down, keep the state yourself:

```svelte
<script lang="ts">
	import { Text, View } from '@rasheed/svelte-native';

	let pressed = $state(false);
</script>

<View
	onPress={() => console.log('open')}
	onPressChange={(value) => (pressed = value)}
	style={{ padding: 16, borderRadius: 12, backgroundColor: pressed ? '#e5e7eb' : '#f3f4f6' }}
>
	<Text>Tap the card</Text>
</View>
```

## ref

`ref` is a callback, not a binding. It receives a handle when the native view is created and `null` when it's destroyed. If you replace the callback, the old one gets `null` first.

| Method | Description |
| --- | --- |
| `measure(callback)` | Calls `callback(x, y, width, height, pageX, pageY)` with the view's frame. |
| `measureInWindow(callback)` | Calls `callback(x, y, width, height)` with the frame in window coordinates. |
| `dispatchCommand(name, args)` | Sends a command to the native view. |
| `tag` | The native view's number. |

```svelte
<script lang="ts">
	import { View, type HostHandle } from '@rasheed/svelte-native';

	let box: HostHandle | null = null;
</script>

<View
	ref={(handle) => (box = handle)}
	collapsable={false}
	onLayout={() => box?.measureInWindow((x, y, width, height) => console.log({ x, y, width, height }))}
	style={{ height: 120 }}
/>
```
