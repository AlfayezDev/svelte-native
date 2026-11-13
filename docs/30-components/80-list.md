---
title: List
group: Scrolling and overlays
video: scroll-view
---

`List` shows a long list of rows and mounts only the ones near the screen. Scrolling through 5,000 rows costs about as much as showing 20. Give it the items, a `row` snippet that draws one item, and a key for each item.

```svelte
<!--- file: src/routes/people/+mobile.svelte --->
<script lang="ts">
	import { List, Screen, Text, View } from '@alfayez/svelte-native';

	type Person = { id: number; name: string };
	const people: Person[] = Array.from({ length: 5000 }, (_, index) => ({ id: index, name: `Person ${index + 1}` }));
</script>

<Screen title="People">
	<List items={people} rowHeight={52} keyOf={(person) => person.id} style={{ flex: 1 }}>
		{#snippet row(person)}
			<View style={{ height: 52, justifyContent: 'center', paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: '#e5e7eb' }}>
				<Text style={{ fontSize: 16 }}>{person.name}</Text>
			</View>
		{/snippet}
		{#snippet empty()}
			<Text style={{ padding: 20 }}>Nobody here yet.</Text>
		{/snippet}
	</List>
</Screen>
```

A `List` is a [`ScrollView`](scroll-view): it needs a bounded height (`flex: 1` in a column), and it can't sit inside another vertical `ScrollView`. For a short list that never grows, a `ScrollView` with an `{#each}` is simpler.

## Row sizes

The list has to know where each row is without mounting it. There are three ways to tell it:

- **`rowHeight`**: every row has this height. Nothing is measured, so this is the fastest. Make the row's own height match.
- **`rowHeights`**: a function that gives each item's height up front, for rows of a few known kinds.
- **Neither**: rows start at `estimatedRowHeight` and are measured when they mount. The rows after one whose size differs from the estimate move on the next frame. Set the estimate close to the typical row.

With `horizontal`, the same props are widths.

## Props

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `items` | `readonly T[]` | | The items. Pass a new array to change them. |
| `row` | `Snippet<[item: T, index: number]>` | | Draws one item. |
| `keyOf` | `(item: T, index: number) => string \| number` | the index | A stable key per item, so rows follow their items when the array changes. `keyExtractor` is the same. |
| `rowHeight` | `number` | | The height of every row. |
| `rowHeights` | `(item: T, index: number) => number` | | The height of each row, up front. |
| `estimatedRowHeight` | `number` | `48` | The height assumed for a row until it's measured. |
| `header`, `footer` | `Snippet` | | Content before the first row and after the last. |
| `empty` | `Snippet` | | Shown instead of the rows while `items` is empty. |
| `horizontal` | `boolean` | `false` | Scrolls sideways. |
| `overscan` | `number` | `4` | Rows kept mounted before and after the visible ones. |
| `initialNumToRender` | `number` | `10` | Rows mounted before the list knows its size. |
| `initialScrollIndex` | `number` | | The row the list starts scrolled to. |
| `onEndReached` | `() => void` | | Called when the end comes within `onEndReachedThreshold`. Load the next page here. |
| `onEndReachedThreshold` | `number` | `0.5` | How close to the end, in screen heights, `onEndReached` fires. |
| `onViewableItemsChanged` | `(info: { viewableItems, changed }) => void` | | Called with the rows that became visible or hidden. Each entry has `item`, `key`, `index` and `isViewable`. |
| `viewabilityConfig` | `{ itemVisiblePercentThreshold?: number; minimumViewTime?: number }` | `{ itemVisiblePercentThreshold: 50 }` | How much of a row must show to count as visible. |
| `recycle` | `boolean` | `false` | Reuses a fixed set of row views instead of mounting and unmounting rows. See [recycling](#recycling). |
| `ref` | `(handle \| null) => void` | | Receives the list's scroll view handle, as [`ScrollView`'s](scroll-view#ref). |

It also takes the props of [`ScrollView`](scroll-view#props), such as `contentContainerStyle`, `onScroll` and `keyboardShouldPersistTaps`.

## Scrolling from code

Bind the list with `bind:this` and call its methods:

| Method | Description |
| --- | --- |
| `scrollToIndex(index, animated = true)` | Scrolls so the row at `index` is at the top. |
| `scrollToOffset(offset, animated = true)` | Scrolls to an offset in points. |

```svelte
<script lang="ts">
	import { List, Pressable, Text } from '@alfayez/svelte-native';

	const items = Array.from({ length: 1000 }, (_, index) => index);
	let list: { scrollToIndex(index: number, animated?: boolean): void } | undefined = $state();
</script>

<Pressable accessibilityRole="button" onPress={() => list?.scrollToIndex(500)}>
	<Text>Jump to row 500</Text>
</Pressable>
<List bind:this={list} {items} rowHeight={44} style={{ flex: 1 }}>
	{#snippet row(value)}<Text style={{ height: 44 }}>Row {value}</Text>{/snippet}
</List>
```

A scroll asked for before the list has laid out happens as soon as it has.

## Loading more

`onEndReached` fires when the user nears the end. Guard it, because it can fire again before the next page arrives:

```svelte
<script lang="ts">
	let posts = $state<{ id: string; title: string }[]>([]);
	let loading = false;

	async function more() {
		if (loading) return;
		loading = true;
		const page = await fetch(`https://api.example.com/posts?after=${posts.at(-1)?.id ?? ''}`).then((response) => response.json());
		posts = [...posts, ...page];
		loading = false;
	}
</script>

<List items={posts} rowHeight={64} keyOf={(post) => post.id} onEndReached={more} style={{ flex: 1 }}>
	{#snippet row(post)}<Text style={{ height: 64 }}>{post.title}</Text>{/snippet}
</List>
```

## Recycling

With `recycle`, the list keeps a fixed set of row wrappers and gives them new items as you scroll, so scrolling creates no native views. The catch: a row component's own state stays with its slot, not with its item. Keep row state in `items` when you turn it on.

Pull to refresh isn't supported yet.
