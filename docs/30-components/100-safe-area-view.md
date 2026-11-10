---
title: SafeAreaView
---

`SafeAreaView` is a [`View`](view) padded by the safe-area insets: the space the status bar, a notch, the home indicator and the system navigation bar take at the edges of the screen. Content inside it stays clear of them.

```svelte
<!--- file: src/routes/+mobile.svelte --->
<script lang="ts">
	import { SafeAreaView, Screen, ScrollView, Text } from '@rasheed/svelte-native';
</script>

<Screen title="Settings">
	<SafeAreaView edges={['left', 'right', 'bottom']} style={{ flex: 1 }}>
		<ScrollView contentContainerStyle={{ padding: 20, gap: 12 }}>
			<Text>The last row stays above the home indicator.</Text>
		</ScrollView>
	</SafeAreaView>
</Screen>
```

## Props

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `edges` | `readonly ('top' \| 'right' \| 'bottom' \| 'left')[]` | all four | The edges to pad. |
| `style` | `ViewStyle` | | As a `View`'s. On each padded edge, the inset is added to the style's own padding. |
| `children` | `Snippet` | | The content. |

It also takes the props of [`View`](view#props).

## Which edges

Pad only the edges nothing else covers:

- **A screen with a header**: the header already covers the top inset. Use `['left', 'right', 'bottom']`.
- **A screen in a tab pane**: the tab bar covers the bottom inset too. Use `['left', 'right']`.
- **A screen without a header**, or the content of a [`Modal`](modal): all four.
- **A screen with a toolbar**: the toolbar covers the bottom inset. Leave `'bottom'` out.

The left and right insets matter in landscape, on phones with a notch.

## The insets store

The insets are also a reactive store, `insets`, for when you need a number instead of padding: the bottom padding of a scroll view's content, say.

```svelte
<script lang="ts">
	import { ScrollView, insets } from '@rasheed/svelte-native';
</script>

<ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 20 + insets.bottom }}>
	<!-- ... -->
</ScrollView>
```

| Field | Description |
| --- | --- |
| `top`, `right`, `bottom`, `left` | The safe-area insets, in points. |
| `keyboardVisible` | Whether the keyboard is open. |
| `keyboardHeight` | How much of the screen the keyboard covers, in points. |
| `frame` | The app's frame: `{ x, y, width, height }`. |

A template or `$derived` that reads a field updates when it changes: on rotation, or when the keyboard opens and closes. The store starts listening the first time a `Screen`, a `SafeAreaView` or `connectInsets()` (also exported) runs, so in an app with screens it's always live.
