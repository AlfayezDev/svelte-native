---
title: Screen
group: Navigation and effects
video: screen
---

`Screen` configures the native screen a page is shown in: its header, a search field, a bottom toolbar, how a sheet sizes itself, and the system bars. Put one at the top of every `+mobile.svelte` page. The header, the back button and the bars are the platform's own: UIKit's on iOS, Material on Android.

```svelte
<!--- file: src/routes/inbox/+mobile.svelte --->
<script lang="ts">
	import { Pressable, Screen, ScrollView, Text, useRouter } from '@rasheed/svelte-native';

	const router = useRouter();
</script>

{#snippet compose()}
	<Pressable accessibilityRole="button" accessibilityLabel="New message" onPress={() => router.goto('/inbox/new')} style={{ minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center' }}>
		<Text style={{ fontSize: 17, color: '#ff3e00' }}>New</Text>
	</Pressable>
{/snippet}

<Screen title="Inbox" header={{ large: true }} headerRight={compose}>
	<ScrollView contentContainerStyle={{ padding: 20, gap: 12 }}>
		<Text>No messages.</Text>
	</ScrollView>
</Screen>
```

The page is one screen of a navigator, and `Screen` sets that screen's options: it doesn't create a screen of its own. Which navigator, and how the page enters (pushed, as a modal, as a sheet), is decided by the routes: see [routing](routing) and [presentation](routing#presentation).

The header is shown when the screen has a `title`, a `subtitle`, a `header` option, a header snippet or a `search` field, unless `header.hidden` is set. A screen with none of them has no header. The back button appears on its own when the stack has a screen below this one.

## Props

| Prop | Type | Description |
| --- | --- | --- |
| `title` | `string` | The title in the header. |
| `subtitle` | `string` | A second, smaller line under the title. |
| `header` | `HeaderOptions` | How the header looks. See [header](#header). |
| `headerLeft` | `Snippet` | Content at the start of the header. It replaces the back button: use it for the Close button of a modal. |
| `headerCenter` | `Snippet` | Content in place of the title. |
| `headerRight` | `Snippet` | Content at the end of the header: actions. |
| `search` | `SearchOptions` | A native search field in the header. See [search](#search). |
| `headerSearch` | `Snippet` | What's shown while the search field is active: the results. |
| `toolbar` | `ToolbarOptions` | A bar of actions at the bottom of the screen. See [toolbar](#toolbar). |
| `toolbarCenter` | `Snippet` | Custom content in the toolbar, between its items. |
| `sheet` | `SheetOptions` | The heights of a sheet. See [sheets](#sheets). |
| `statusBar` | `{ style?: 'auto' \| 'light' \| 'dark'; hidden?: boolean }` | The status bar while this screen is on top. See [system bars](#system-bars). |
| `navigationBar` | `{ color?: string; style?: 'auto' \| 'light' \| 'dark' }` | Android: the system navigation bar while this screen is on top. |
| `animation` | `'default' \| 'none' \| 'fade' \| 'slide_from_right' \| 'slide_from_bottom'` | How the screen is pushed and popped. Modals and sheets keep the platform's animation. |
| `gestureEnabled` | `boolean` | `false` stops the user from swiping the screen away: the iOS edge swipe back, and swiping a modal down. Default `true`. A sheet has `sheet.dismissible` instead. |
| `style` | `ViewStyle` | The style of the screen's content area. `backgroundColor` is the usual one. |
| `class` | `ClassValue` | A list of classes: a string, an array or an object, as on a DOM element in Svelte. Their style goes under `style`, which wins. Needs the `css` option ([Classes](styling#classes)). |
| `onAppear` | `() => void` | The screen finished appearing. |
| `onDisappear` | `() => void` | The screen finished disappearing: something covered it, or it left. |
| `onDismiss` | `() => void` | The user closed the screen natively (the iOS back button or edge swipe, dragging a sheet or modal away) rather than your code calling `router.back()`. |
| `onDetentChange` | `(event: { index: number; fraction: number }) => void` | A sheet came to rest at another height. |
| `children` | `Snippet` | The content. |

## Header

`header` takes:

| Option | Type | Description |
| --- | --- | --- |
| `large` | `boolean` | A large title, which collapses into the regular bar as the screen's first [`ScrollView`](scroll-view) scrolls. |
| `hidden` | `boolean` | No header, even with a title. |
| `translucent` | `boolean` | The header floats over the content instead of taking space above it. Pad the content with [`useHeader()`](#bars-over-the-content). |
| `hideBack` | `boolean` | No back button. |
| `backTitle` | `string` | iOS: the label of the back button. Android: the back arrow's accessibility label. |
| `tint` | `string` | The colour of the back button and the header's buttons. |
| `background` | `string` | The header's background colour. |
| `hideShadow` | `boolean` | No line or shadow under the header. |

Header snippets lay out start to end, and mirror in right-to-left languages. Give a pressable in the header a 48-point target and an `accessibilityLabel`.

## Search

`search` puts a native search field in the header. The field is the platform's; you get its text through `onChangeText`, and show what matches in the `headerSearch` snippet:

```svelte
<!--- file: src/routes/people/+mobile.svelte --->
<script lang="ts">
	import { Screen, ScrollView, Text } from '@rasheed/svelte-native';

	const people = ['Amal', 'Bilal', 'Carla', 'Dev', 'Esra'];
	let query = $state('');
	const matches = $derived(people.filter((name) => name.toLowerCase().includes(query.trim().toLowerCase())));
</script>

{#snippet results()}
	<ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 20, gap: 8 }}>
		{#each matches as name (name)}
			<Text>{name}</Text>
		{:else}
			<Text>Nobody is called that.</Text>
		{/each}
	</ScrollView>
{/snippet}

<Screen
	title="People"
	search={{ placeholder: 'Search people', onChangeText: (text) => (query = text), onCancel: () => (query = '') }}
	headerSearch={results}
>
	<!-- the screen's own content -->
</Screen>
```

| Option | Type | Description |
| --- | --- | --- |
| `placeholder` | `string` | Shown while the field is empty. |
| `value` | `string` | Sets the field's text from code. |
| `onChangeText` | `(text: string) => void` | Called on every edit. |
| `onSubmit` | `(text: string) => void` | The search key was pressed. |
| `onCancel` | `() => void` | The user closed the search. |

## Toolbar

`toolbar` adds a bar of actions at the bottom of the screen: a `UIToolbar` on iOS, a Material bottom bar on Android. In a tab pane it sits above the tab bar.

```svelte
<!--- file: src/routes/message/[id]/+mobile.svelte --->
<script lang="ts">
	import { Screen, Text, type ToolbarItem } from '@rasheed/svelte-native';
	import replyIcon from '../../../../assets/reply.png';

	const items: ToolbarItem[] = [
		{ key: 'reply', title: 'Reply', icon: replyIcon },
		{ key: 'gap', spacer: true },
		{ key: 'flag', title: 'Flag', icon: replyIcon, badge: 2, accessibilityLabel: 'Flag, 2 new' },
	];
</script>

<Screen title="Message" toolbar={{ items, onPress: (key) => console.log(key) }}>
	<Text>...</Text>
</Screen>
```

| Option | Type | Description |
| --- | --- | --- |
| `items` | `ToolbarItem[]` | The actions, start to end. |
| `onPress` | `(key: string) => void` | An item was pressed. |
| `hidden` | `boolean` | No toolbar. |
| `translucent` | `boolean` | The toolbar floats over the content. Pad the content with [`useToolbar()`](#bars-over-the-content). |
| `tint` | `string` | The colour of the items. |
| `background` | `string` | The toolbar's background colour. |

An item takes `key`, `title`, `icon`, `badge`, `disabled`, `accessibilityLabel` and `testID`. `{ key, spacer: true }` is flexible space that pushes the items apart. The `icon` is an image (an imported file or `{ uri }`), drawn as a template in the bar's tint, or a snippet that draws it. A snippet is drawn, not pressed: the item is the button, and `onPress` gets its key. A `badge` is a string or a number (above 99 it reads "99+"); `true` shows a dot.

## Sheets

A page whose [presentation](routing#presentation) is `'sheet'` slides up from the bottom and rests at one of its heights, its _detents_. The user drags it between them, or down to dismiss it.

```svelte
<!--- file: src/routes/share/+mobile.svelte --->
<script lang="ts" module>
	export const presentation = 'sheet';
</script>

<script lang="ts">
	import { Screen, Text } from '@rasheed/svelte-native';
</script>

<Screen title="Share" sheet={{ detents: [0.4, 0.9], grabber: true }} onDetentChange={({ index }) => console.log(index)}>
	<Text style={{ padding: 20 }}>Drag the handle to resize.</Text>
</Screen>
```

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `detents` | `(number \| 'auto')[]` | `[0.5, 1]` | Up to four heights, ascending, as fractions of the screen below the status bar. `'auto'` is the height of the content. |
| `initialDetent` | `number \| 'auto'` | the first | The height the sheet opens at, one of `detents`. |
| `grabber` | `boolean` | `true` | The handle at the top. |
| `dismissible` | `boolean` | `true` | Whether dragging down or tapping the backdrop dismisses it. |
| `backdrop` | `'dim' \| 'none'` | `'dim'` | Whether the screen behind is dimmed. |

A `'formSheet'` page has one height, the whole screen below the status bar, and no grabber unless you set `grabber: true`. `dismissible` and `backdrop` apply to it too.

## System bars

`statusBar.style` sets the colour of the status bar's icons while the screen is on top: `'light'` for light icons on a dark background, `'dark'` for dark icons on a light one, and `'auto'` to follow the system's light or dark mode. `statusBar.hidden` hides the bar.

`navigationBar` does the same for Android's system navigation bar, and `color` sets its background. iOS has no navigation bar and ignores it.

Set them once for every screen on the [`Stack`](stack), and on a `Screen` where one screen differs, such as a full-screen photo.

## Screens inside screens

A page's `Screen` merges with any `Screen` of the layouts around it, and with the [`Stack`](stack)'s defaults. The innermost value wins option by option, object options (`header`, `sheet`, `toolbar`, ...) merge key by key, and every `onAppear`, `onDisappear`, `onDismiss` and `onDetentChange` handler runs.

So a layout can set what all its pages share, and each page adds its title:

```svelte
<!--- file: src/routes/settings/+layout.mobile.svelte --->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import { Screen } from '@rasheed/svelte-native';

	let { children }: { children: Snippet } = $props();
</script>

<Screen header={{ tint: '#ff3e00' }}>{@render children()}</Screen>
```

A `Screen` that no navigator holds, the content of a [`Modal`](modal) for instance, draws its own header there.

## Bars over the content

With a `translucent` header or toolbar, or a `large` header, content runs under the bars. Three functions tell you how much room they take. Call them in a component's `<script>`, inside the page:

| Function | Returns |
| --- | --- |
| `useHeader()` | `{ height, inset }` of the screen's header, in points. `height` includes the status bar `inset`. Zero without a header. |
| `useToolbar()` | `{ height, inset }` of the screen's toolbar. `height` includes the bottom `inset`. Zero without a toolbar. |
| `inTabPane()` | `true` inside a tab pane, which ends at the tab bar. Content there needs no bottom inset of its own. |

```svelte
<script lang="ts">
	import { Screen, ScrollView, useHeader } from '@rasheed/svelte-native';

	const header = useHeader();
</script>

<Screen title="Photos" header={{ translucent: true }}>
	<ScrollView contentContainerStyle={{ paddingTop: header.height }}>
		<!-- ... -->
	</ScrollView>
</Screen>
```

The values are reactive: a template or `$derived` that reads them updates when the bars' size changes.

## Accessibility

The title is announced as the screen's heading. Sheets and modals keep a screen reader's focus inside them while they're open, and Android's back button goes to the innermost screen that can go back.
