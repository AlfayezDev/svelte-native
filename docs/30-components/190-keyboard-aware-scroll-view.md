---
title: KeyboardAwareScrollView
group: Scrolling and overlays
---

`KeyboardAwareScrollView` is a [`ScrollView`](scroll-view) that keeps the input being edited in view. When the keyboard opens it scrolls the focused input above the keyboard, frame by frame as the keyboard rises, and scrolls back as it closes. Use it for a form that is longer than the screen.

```svelte
<!--- file: src/routes/sign-up/+mobile.svelte --->
<script lang="ts">
	import { KeyboardAwareScrollView, Screen, TextInput } from 'expo-svelte';

	let name = $state('');
	let email = $state('');
	let notes = $state('');
</script>

<Screen title="Sign up">
	<KeyboardAwareScrollView bottomOffset={24} style={{ flex: 1 }} contentContainerStyle={{ padding: 20, gap: 600 }}>
		<TextInput bind:value={name} placeholder="Name" accessibilityLabel="Name" />
		<TextInput bind:value={email} placeholder="Email" accessibilityLabel="Email" />
		<TextInput bind:value={notes} placeholder="Notes" accessibilityLabel="Notes" />
	</KeyboardAwareScrollView>
</Screen>
```

## Props

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `bottomOffset` | `number` | `0` | The distance, in points, to keep between the keyboard and the bottom of the input. |
| `extraKeyboardSpace` | `number` | `0` | Room, in points, added at the bottom of the scrollable area while the keyboard is up. |
| `disableScrollOnKeyboardHide` | `boolean` | `false` | Leave the scroll position where it is when the keyboard closes. |
| `enabled` | `boolean` | `true` | `false` turns the scrolling and the room off. |
| `ref` | `(instance) => void` | | As [`ScrollView`](scroll-view#props)'s. |

It also takes the props of [`ScrollView`](scroll-view#props).

## What it does

- When the keyboard starts to open, the engine works out how far the focused input's bottom edge has to go to clear the keyboard's top edge (plus `bottomOffset`), and every frame of the animation scrolls that distance in proportion to how far the keyboard has risen. An input that is clear of the keyboard scrolls nothing.
- While the keyboard is up, the scroll view keeps the keyboard's height (and `extraKeyboardSpace`) as room at its bottom, so the last inputs can be scrolled above the keyboard. The room goes when the keyboard has closed.
- Moving to another input while the keyboard is up scrolls to that input, with a short animation.
- When the keyboard closes, the scroll view goes back to where it was before the keyboard opened, along the same way.

On Android the scrolling is the engine's, on the main thread, in the frame the keyboard moves in. Elsewhere the component is a plain `ScrollView`. The `layout` mode of react-native-keyboard-controller's component, and the scroll that follows the caret of a growing multiline input, are not covered.
