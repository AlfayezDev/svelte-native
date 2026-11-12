---
title: KeyboardAvoidingView
group: Layout and status
video: keyboard-avoiding-view
---

`KeyboardAvoidingView` moves its content out of the keyboard's way. When the keyboard opens and covers part of the view, it adds padding, shrinks or lifts the content by the height it covers. Wrap a form in one, so the field being edited stays visible.

```svelte
<!--- file: src/routes/sign-in/+mobile.svelte --->
<script lang="ts">
	import { KeyboardAvoidingView, Pressable, Screen, ScrollView, Text, TextInput } from '@rasheed/svelte-native';

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

It measures where the view is on screen, so it works below a header without an offset. The content moves to its new place at once: the change isn't animated with the keyboard yet.
