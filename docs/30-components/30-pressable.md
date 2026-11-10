---
title: Pressable
---

`Pressable` makes whatever it wraps respond to a tap. Use it for buttons, list rows and anything else the user presses. It's a [`View`](view) with press handling: it lays out its children and takes the same style.

```svelte
<!--- file: src/routes/+mobile.svelte --->
<script lang="ts">
	import { Pressable, Screen, Text, View } from '@rasheed/svelte-native';

	let count = $state(0);
	let pressed = $state(false);
</script>

<Screen title="Counter">
	<View style={{ flex: 1, justifyContent: 'center', padding: 24 }}>
		<Pressable
			accessibilityRole="button"
			onPress={() => count++}
			onPressChange={(value) => (pressed = value)}
			style={{ padding: 16, borderRadius: 12, alignItems: 'center', backgroundColor: pressed ? '#c2410c' : '#ff3e00' }}
		>
			<Text style={{ color: '#ffffff', fontSize: 16, fontWeight: '600' }}>Tapped {count} times</Text>
		</Pressable>
	</View>
</Screen>
```

## Props

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `children` | `Snippet` | | The content. |
| `onPress` | `(event) => void` | | Called when a press ends inside the element. |
| `onPressIn` | `(event) => void` | | A finger went down. |
| `onPressOut` | `(event) => void` | | The finger came up, or moved away. |
| `onLongPress` | `(event) => void` | | The press was held for `delayLongPress`. When it fires, `onPress` doesn't. |
| `onPressChange` | `(pressed: boolean) => void` | | `true` when the press becomes active, `false` when it ends. The way to draw a pressed look. |
| `delayLongPress` | `number` | `500` | Milliseconds before `onLongPress`. |
| `delayPressIn` | `number` | `0` | Milliseconds from touch down to the press becoming active. |
| `delayPressOut` | `number` | `0` | Milliseconds from touch up to the press ending. |
| `minPressDuration` | `number` | `130` | The press stays active at least this long, so a quick tap still shows its pressed look. |
| `disabled` | `boolean` | `false` | Ignores presses. Say it to screen readers too, with `accessibilityState={{ disabled: true }}`. |
| `hitSlop` | `number \| Insets` | | Extends the area that starts a press beyond the element's frame, for small targets. |
| `pressRetentionOffset` | `number \| Insets` | | How far a finger can move outside the element and still count as pressing it. |
| `style` | `ViewStyle` | | As a [`View`'s](view). |
| `class` | `ClassValue` | | A list of classes: a string, an array or an object, as on a DOM element in Svelte. Their style goes under `style`, which wins. Needs [Uniwind](styling#classes). |
| `gesture` | `Gesture` | | A gesture to recognise on the element. See [gestures](gestures). |
| `accessibilityRole` | `string` | | `'button'` for a button, `'link'` for a link. |
| `accessibilityLabel` | `string` | | What a screen reader says, when the content isn't text or isn't enough. |

It also takes the other props of React Native's [`Pressable`](https://reactnative.dev/docs/pressable), with two exceptions: `style` and `children` can't be functions of the pressed state (use `onPressChange`), and `android_ripple` isn't drawn.

## Pressed look

React Native passes `{ pressed }` to a function `style`. Here you keep the state in a variable instead, which also lets anything else in the component react to it:

```svelte
<script lang="ts">
	import { Pressable, Text } from '@rasheed/svelte-native';

	let pressed = $state(false);
</script>

<Pressable onPress={save} onPressChange={(value) => (pressed = value)} style={{ opacity: pressed ? 0.6 : 1 }}>
	<Text>Save</Text>
</Pressable>
```

## Touch targets

Make a pressable at least 48 by 48 points, the size Android and iOS recommend for a finger. For an icon that's smaller, keep the icon small and grow the target with `minWidth`, `minHeight` or `hitSlop`:

```svelte
<Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={close} style={{ minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center' }}>
	<Text style={{ fontSize: 20 }}>×</Text>
</Pressable>
```

A `View` and a `Text` take the same press props. Prefer `Pressable` for buttons: it's always pressable, and it's the obvious thing to give `accessibilityRole="button"` to.
