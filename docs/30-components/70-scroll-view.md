---
title: ScrollView
group: Scrolling and overlays
video: scroll-view
---

`ScrollView` scrolls content that doesn't fit, vertically or sideways. It mounts all of its children at once, so it suits a screen's content, a form or a few dozen rows. For a long list, use [`List`](list), which mounts only the rows on screen.

```svelte
<!--- file: src/routes/+mobile.svelte --->
<script lang="ts">
	import { Screen, ScrollView, Text, View } from '@rasheed/svelte-native';

	const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
</script>

<Screen title="Week" header={{ large: true }}>
	<ScrollView contentContainerStyle={{ padding: 20, gap: 12 }}>
		{#each days as day (day)}
			<View style={{ padding: 16, borderRadius: 12, backgroundColor: '#f3f4f6' }}>
				<Text style={{ fontSize: 16 }}>{day}</Text>
			</View>
		{/each}
	</ScrollView>
</Screen>
```

`style` sizes the scroll view itself, and `contentContainerStyle` the content inside it: put padding and `gap` there. A vertical `ScrollView` fills the space it's given; in a column, give it `flex: 1`.

A screen with a large title collapses the title as its first `ScrollView` scrolls.

## Props

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `children` | `Snippet` | | The content. |
| `horizontal` | `boolean` | `false` | Scrolls sideways, with the children in a row. |
| `contentContainerStyle` | `ViewStyle` | | The style of the content: padding, `gap`, alignment. |
| `style` | `ViewStyle` | | The style of the scroll view's frame. |
| `class` | `ClassValue` | | A list of classes: a string, an array or an object, as on a DOM element in Svelte. Their style goes under `style`, which wins. Needs the `css` option ([Classes](styling#classes)). |
| `showsVerticalScrollIndicator`, `showsHorizontalScrollIndicator` | `boolean` | `true` | Shows the scroll bar. |
| `pagingEnabled` | `boolean` | `false` | Stops on multiples of the scroll view's size, for a pager. |
| `keyboardShouldPersistTaps` | `'never' \| 'always' \| 'handled'` | `'never'` | What a tap does while the keyboard is open. `'handled'` lets buttons work at once; with `'never'` the first tap only closes the keyboard. |
| `keyboardDismissMode` | `'none' \| 'on-drag' \| 'interactive'` | `'none'` | Whether scrolling closes the keyboard. |
| `onScroll` | `(event) => void` | | Called while scrolling, with `event.nativeEvent.contentOffset`. |
| `scrollEventThrottle` | `number` | | iOS: the least milliseconds between two `onScroll` calls. |
| `bounces` | `boolean` | `true` | iOS: bounces at the ends. |
| `scrollEnabled` | `boolean` | `true` | `false` stops the user from scrolling. |
| `ref` | `(handle \| null) => void` | | Receives the scroll view's handle. See [ref](#ref). |
| `gesture` | `Gesture` | | A gesture to recognise on the scroll view. See [gestures](gestures). |

It also takes the other props of React Native's [`ScrollView`](https://reactnative.dev/docs/scrollview). There's no `refreshControl`: pull to refresh isn't supported yet.

## ref

| Method | Description |
| --- | --- |
| `scrollTo({ x?, y?, animated? })` | Scrolls to an offset. `animated` defaults to `true`. |
| `scrollToEnd({ animated? })` | Scrolls to the end. |
| `measure(callback)` | As on a [`View`](view#ref). |

```svelte
<script lang="ts">
	import { Pressable, ScrollView, Text } from '@rasheed/svelte-native';

	let scroller: { scrollTo(options: { y: number; animated?: boolean }): void } | null = null;
</script>

<ScrollView ref={(handle) => (scroller = handle)}>
	<!-- ... -->
	<Pressable accessibilityRole="button" onPress={() => scroller?.scrollTo({ y: 0 })}>
		<Text>Back to top</Text>
	</Pressable>
</ScrollView>
```

## Nesting

Don't put a [`List`](list) in a `ScrollView` that scrolls the same way: the list is a scroll view itself, and it needs a bounded size to know which rows are on screen. A horizontal `ScrollView` inside a vertical one is fine.
