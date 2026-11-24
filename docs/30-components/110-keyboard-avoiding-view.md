---
title: KeyboardAvoidingView
group: Layout and status
video: text-input
---

`KeyboardAvoidingView` moves its content out of the keyboard's way. When the keyboard opens and covers part of the view, it adds padding, shrinks or lifts the content by the height it covers. Wrap a form in one, so the field being edited stays visible.

```svelte
<!--- file: src/routes/sign-in/+mobile.svelte --->
<script lang="ts">
	import { KeyboardAvoidingView, Pressable, Screen, ScrollView, Text, TextInput } from 'expo-svelte';

	let email = $state('');
	let password = $state('');
</script>

<Screen title="Sign in">
	<KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
		<ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 20, gap: 12 }}>
			<TextInput bind:value={email} placeholder="Email" keyboardType="email-address" autoCapitalize="none" accessibilityLabel="Email" />
			<TextInput bind:value={password} placeholder="Password" secureTextEntry accessibilityLabel="Password" />
			<Pressable accessibilityRole="button" onPress={() => console.log(email)}>
				<Text>Sign in</Text>
			</Pressable>
		</ScrollView>
	</KeyboardAvoidingView>
</Screen>
```

## Props

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `behavior` | `'padding' \| 'height' \| 'position'` | | How it makes room. Without it, nothing moves. See [behaviours](#behaviours). |
| `enabled` | `boolean` | `true` | `false` turns the avoiding off. |
| `keyboardVerticalOffset` | `number` | `0` | Extra room, in points, to keep between the keyboard and the content. |
| `contentContainerStyle` | `ViewStyle` | | With `behavior="position"`: the style of the inner container that's lifted. |
| `style` | `ViewStyle` | | As a `View`'s. Give it `flex: 1` to fill the screen. |
| `class` | `ClassValue` | | A list of classes: a string, an array or an object, as on a DOM element in Svelte. Their style goes under `style`, which wins. Needs the `css` option ([Classes](styling#classes)). |
| `children` | `Snippet` | | The content. |

It also takes the props of [`View`](view#props).

## Behaviours

| `behavior` | What happens |
| --- | --- |
| `'padding'` | Adds bottom padding as tall as the part of the view the keyboard covers. The usual choice, on both platforms, around a `ScrollView`. |
| `'height'` | Shrinks the view by that much. |
| `'position'` | Lifts an inner container by that much, leaving the view's own size alone. |

It measures where the view is on screen, so it works below a header without an offset.

On Android `'position'` moves with every frame of the keyboard's animation: the engine works out how far the keyboard covers the view when it starts to open, and lifts the inner container by that much in proportion to how far the keyboard has risen, in the frame the keyboard moves in, with no JavaScript in between. `'padding'` and `'height'` change the view's layout, which is JavaScript's, so they change once, when the keyboard starts to move; for a view that has to follow the keyboard frame by frame, use `'position'` or a [`KeyboardStickyView`](keyboard-sticky-view).
