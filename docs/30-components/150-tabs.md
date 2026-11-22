---
title: Tabs
group: Navigation and effects
video: tabs
---

`Tabs` draws a tab bar at the bottom of the screen, with a pane for each tab: UIKit's `UITabBar` on iOS, a Material-style bottom bar on Android. Each pane keeps its state, and its own stack of screens, while the user is on another tab.

You use it in one of two ways:

- **In a tabs layout**, the usual way: the layout of a directory that exports `navigator = 'tabs'`. Each child directory is a tab, and the router owns the selection, so a link can open any tab.
- **On its own**, as a component that switches content you give it. The selection is yours.

## In a tabs layout

```svelte
<!--- file: src/routes/(app)/+layout.mobile.svelte --->
<script lang="ts" module>
	export const navigator = 'tabs';
</script>

<script lang="ts">
	import type { Snippet } from 'svelte';
	import { Tabs, type TabItem } from 'expo-svelte';
	import homeIcon from '../../../assets/home.png';
	import inboxIcon from '../../../assets/inbox.png';

	let { children }: { children: Snippet } = $props();

	const items: TabItem[] = [
		{ key: 'home', title: 'Home', icon: homeIcon },
		{ key: 'inbox', title: 'Inbox', icon: inboxIcon, badge: 3 },
	];
</script>

<Tabs {items} tint="#ff3e00">{@render children()}</Tabs>
```

```tree
src/routes/(app)/
├ +layout.mobile.svelte      the layout above
├ home/+mobile.svelte        the "home" tab
└ inbox/
  ├ +mobile.svelte           the "inbox" tab
  └ [id]/+mobile.svelte      pushed inside the inbox tab
```

The keys of `items` are the names of the child directories, and their order is the order of the bar. A directory with no item still gets a tab, titled with its name, and development builds warn about it. [Navigators](routing#navigators) explains how tabs and stacks nest, and how `goto` selects a tab.

The layout also receives `panes`, the child directories as `{ key }` objects, if you'd rather build the items from them.

## On its own

Outside a tabs layout, `Tabs` shows the `content` snippet of the selected tab. Pass `selected` and update it in `onSelect`:

```svelte
<!--- file: src/routes/library/+mobile.svelte --->
<script lang="ts">
	import { Screen, Tabs, Text, View } from 'expo-svelte';

	let selected = $state('books');
</script>

<Screen title="Library">
	<Tabs
		items={[{ key: 'books', title: 'Books' }, { key: 'films', title: 'Films' }]}
		{selected}
		onSelect={(key) => (selected = key)}
	>
		{#snippet content(tab)}
			<View style={{ flex: 1, padding: 20 }}>
				<Text>{tab.key === 'books' ? 'Your books' : 'Your films'}</Text>
			</View>
		{/snippet}
	</Tabs>
</Screen>
```

`selected` is the truth: a press switches the bar at once and calls `onSelect`, and if `selected` doesn't change, the bar goes back. `content` receives a handle with the tab's `key` and whether it's `selected`.

## Props

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `items` | `TabItem[]` | | The tabs, in the bar's order. See [items](#items). |
| `children` | `Snippet` | | In a tabs layout: the panes. Render the layout's `children` here. |
| `selected` | `string` | | On its own: the key of the selected tab. |
| `onSelect` | `(key: string) => void` | | A tab was pressed. Called in both modes. |
| `content` | `Snippet<[tab: { key: string; selected: boolean }]>` | | On its own: the content of a tab. |
| `lazy` | `boolean` | `true` | Mounts a pane the first time its tab is selected. Then it stays mounted, hidden while another tab is shown. `false` mounts every pane at once. |
| `tint` | `string` | the system's | The colour of the selected tab's icon and label. |
| `inactiveTint` | `string` | the system's | The colour of the other tabs. |
| `background` | `string` | the system's | The bar's background colour. |
| `labels` | `'always' \| 'never'` | `'always'` | Whether the titles are shown under the icons. |

## Items

| Field | Type | Description |
| --- | --- | --- |
| `key` | `string` | The tab's key: in a tabs layout, the directory's name. |
| `title` | `string` | The label under the icon, and what a screen reader says. |
| `icon` | `image \| Snippet<[selected: boolean]>` | An image (an imported file or `{ uri }`) or a snippet that draws one. |
| `selectedIcon` | `image` | A different image for the selected tab. |
| `badge` | `string \| number \| true` | A badge on the icon. A number above 99 reads "99+"; `true` shows a dot. |
| `disabled` | `boolean` | The tab can't be selected. |
| `accessibilityLabel` | `string` | What a screen reader says for the tab, instead of the title and badge. |
| `testID` | `string` | An id for end-to-end tests. |

The bar draws an icon as a template: only its shape counts, and the bar colours it with `tint` or `inactiveTint`. A snippet icon receives whether its tab is selected:

```svelte
{#snippet dot(selected: boolean)}
	<View style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: '#000000', opacity: selected ? 1 : 0.6 }} />
{/snippet}
```

## Panes and insets

A pane ends at the tab bar, and the bar covers the bottom safe-area inset. Content in a pane needs no bottom inset of its own: use `edges={['left', 'right']}` on a [`SafeAreaView`](safe-area-view), or check `inTabPane()` (see [Screen](screen#bars-over-the-content)).

A page that should cover the tab bar, a modal for instance, lives outside the tabs directory.
