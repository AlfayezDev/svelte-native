---
title: Modal
---

`Modal` shows content in a layer over the whole app, header and tab bar included. It's for UI that belongs to the current screen and has no address of its own: a confirmation, a picker, a short form. You show and hide it with `visible`.

```svelte
<!--- file: src/routes/+mobile.svelte --->
<script lang="ts">
	import { Modal, Pressable, Screen, Text, View } from '@example/svelte-native';

	let open = $state(false);
</script>

<Screen title="Home">
	<Pressable accessibilityRole="button" onPress={() => (open = true)} style={{ margin: 20 }}>
		<Text>Delete account</Text>
	</Pressable>

	<Modal visible={open} transparent animationType="fade" onRequestClose={() => (open = false)}>
		<View style={{ flex: 1, justifyContent: 'center', padding: 32, backgroundColor: 'rgba(0, 0, 0, 0.5)' }}>
			<View style={{ gap: 12, padding: 20, borderRadius: 16, backgroundColor: '#ffffff' }}>
				<Text style={{ fontSize: 18, fontWeight: '600' }}>Delete your account?</Text>
				<Pressable accessibilityRole="button" onPress={() => (open = false)}>
					<Text>Cancel</Text>
				</Pressable>
			</View>
		</View>
	</Modal>
</Screen>
```

A screen that the user should be able to link to, or that has its own header and back behaviour, is better as a page with a modal or sheet [presentation](routing#presentation). Opening it is a navigation, and `router.back()` closes it.

## Props

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `visible` | `boolean` | `true` | Whether the modal is shown. |
| `onRequestClose` | `(event) => void` | | The user asked to close it: Android's back button, or the swipe down of an iOS sheet that has `allowSwipeDismissal`. Set `visible` to `false` here. |
| `animationType` | `'none' \| 'slide' \| 'fade'` | `'none'` | How it appears and goes away. |
| `transparent` | `boolean` | `false` | Draws the content over the app instead of on an opaque background, for a dimmed backdrop and a card. |
| `presentationStyle` | `'fullScreen' \| 'pageSheet' \| 'formSheet' \| 'overFullScreen'` | | iOS: how UIKit presents it. |
| `onShow` | `(event) => void` | | The modal has appeared. |
| `onDismiss` | `() => void` | | iOS: the modal has gone away. |
| `statusBarTranslucent` | `boolean` | `false` | Android: the content extends under the status bar. |
| `children` | `Snippet` | | The content. |

It also takes the other props of React Native's [`Modal`](https://reactnative.dev/docs/modal).

## Closing

`Modal` is controlled: it closes only when `visible` turns `false`. Always give it `onRequestClose`, or Android's back button can't close it. While the keyboard is open, the back button closes the keyboard first and `onRequestClose` isn't called.

## Content

The modal's content is a layer of its own:

- It covers the safe areas. Pad the content yourself, with a [`SafeAreaView`](safe-area-view).
- A [`Screen`](screen) inside a modal draws its own header there, instead of setting the header of the screen below. Use it for a full-screen modal with a title and a close button:

```svelte
<Modal visible={open} animationType="slide" onRequestClose={() => (open = false)}>
	<Screen title="Filters" headerRight={done}>
		<!-- ... -->
	</Screen>
</Modal>

{#snippet done()}
	<Pressable accessibilityRole="button" onPress={() => (open = false)}><Text>Done</Text></Pressable>
{/snippet}
```
