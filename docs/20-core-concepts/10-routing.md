---
title: Routing
---

Svelte Native has SvelteKit's _filesystem-based router_: the directories under `src/routes` are the screens of your app. Web routes are `+page.svelte` and `+layout.svelte`; native routes are `+mobile.svelte` and `+layout.mobile.svelte`, and the two kinds can share a directory.

| Web | Native | What it is |
| --- | --- | --- |
| `+page.svelte` | `+mobile.svelte` | a page: one screen of the app |
| `+layout.svelte` | `+layout.mobile.svelte` | a layout around the pages below it |

## Pages

A `+mobile.svelte` file is a screen. Its directory is its route:

- `src/routes/+mobile.svelte` is the first screen, at `/`
- `src/routes/settings/+mobile.svelte` is the screen at `/settings`
- `src/routes/posts/[id]/+mobile.svelte` has a parameter, `id`

```svelte
<!--- file: src/routes/posts/[id]/+mobile.svelte --->
<script lang="ts">
	import { Screen, Text, View } from '@example/svelte-native';

	let { params }: { params: { id: string } } = $props();
</script>

<Screen title="Post">
	<View style={{ padding: 24 }}>
		<Text>You are reading post {params.id}.</Text>
	</View>
</Screen>
```

A page receives `params`, the route's parameters as strings. Route groups `(group)`, parameters `[param]`, optional parameters `[[optional]]` and rest parameters `[...rest]` work as in SvelteKit. Parameter matchers (`[id=integer]`) don't. A static route wins over one with parameters.

[`<Screen>`](screen) sets the screen's title, header, toolbar and system bars. A page without one has no header.

## Layouts

A `+layout.mobile.svelte` wraps every screen below its directory. It receives `params`, `url` and a `children` snippet:

```svelte
<!--- file: src/routes/(account)/+layout.mobile.svelte --->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import { View } from '@example/svelte-native';

	let { children }: { children: Snippet } = $props();
</script>

<View style={{ flex: 1, backgroundColor: '#fffbeb' }}>
	{@render children()}
</View>
```

The layout at the root, `src/routes/+layout.mobile.svelte`, is the _app shell_. Every app has one. Its `children` is the root navigator: the stack of all your screens. Put what the whole app needs here, such as a theme or the stack's defaults:

```svelte
<!--- file: src/routes/+layout.mobile.svelte --->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import { Stack } from '@example/svelte-native';

	let { children }: { children: Snippet } = $props();
</script>

<Stack statusBar={{ style: 'auto' }} style={{ backgroundColor: '#ffffff' }}>
	{@render children()}
</Stack>
```

## Navigators

A _navigator_ decides how screens relate to each other. The root is a stack: each new screen slides in on top of the last one. A layout becomes a navigator of its own when its module script exports `navigator`:

- `'stack'`: the screens of the directory form a stack. Use it to set a nested stack's own defaults with [`<Stack>`](stack).
- `'tabs'`: the directory becomes a tab bar, with one tab for each child directory. Each tab has a stack of its own.

```svelte
<!--- file: src/routes/(app)/+layout.mobile.svelte --->
<script lang="ts" module>
	export const navigator = 'tabs';
</script>

<script lang="ts">
	import type { Snippet } from 'svelte';
	import { Tabs } from '@example/svelte-native';

	let { children }: { children: Snippet } = $props();
</script>

<Tabs
	items={[
		{ key: 'feed', title: 'Feed' },
		{ key: 'profile', title: 'Profile' }
	]}
>
	{@render children()}
</Tabs>
```

The tab keys are the names of the child directories, here `feed` and `profile`. Each of them needs a `+mobile.svelte`, the first screen of its tab. A tabs layout also receives `panes`, the list of its tabs, if you'd rather build `items` from it. [`Tabs`](tabs) documents the tab bar's options.

This tree shows how pages and navigators combine:

```tree
src/routes/
├ +layout.mobile.svelte              the app shell
├ +mobile.svelte                     the first screen of the root stack
├ login/+mobile.svelte               pushed on the root stack
├ (app)/
│ ├ +layout.mobile.svelte            navigator = 'tabs'
│ ├ feed/+mobile.svelte              the "feed" tab
│ ├ feed/[id]/+mobile.svelte         pushed inside the feed tab
│ └ profile/+mobile.svelte           the "profile" tab
└ compose/+mobile.svelte             presentation = 'modal': covers the tab bar
```

A layout without `navigator` is a plain wrapper, as in the previous section. A tab bar inside a tab bar, a page next to a tabs layout, and a tab without a `+mobile.svelte` are build errors that name the file.

## Presentation

By default a page is pushed onto its stack. A page can enter another way, with a literal in its module script:

```svelte
<!--- file: src/routes/compose/+mobile.svelte --->
<script lang="ts" module>
	export const presentation = 'modal';
</script>
```

| Value | How the screen appears |
| --- | --- |
| `'push'` | slides in on top of the stack (the default) |
| `'modal'` | covers the screen, and the tab bar, from the bottom |
| `'transparentModal'` | a modal that lets the screen below show through |
| `'sheet'` | a sheet that stops at the heights you give it ([sheet options](screen#sheets)) |
| `'formSheet'` | a sheet sized for a form |

A modal or sheet belongs to the stack of its page. One that must cover the tab bar lives outside the tabs directory, like `compose` above.

## Navigating

SvelteKit navigates with `<a href>`. Native has no links, so a screen asks its router. `useRouter()` returns the router of the nearest navigator:

```svelte
<!--- file: src/routes/+mobile.svelte --->
<script lang="ts">
	import { Pressable, Screen, Text, useRouter } from '@example/svelte-native';

	const router = useRouter();
</script>

<Screen title="Home">
	<Pressable onPress={() => router.goto('/posts/42')} accessibilityRole="button">
		<Text>Read post 42</Text>
	</Pressable>
</Screen>
```

Call `useRouter()` while the component initialises, like `getContext`. The router has:

| Member | What it does |
| --- | --- |
| `goto(href, options?)` | Goes to any route of the app. It selects the right tab, closes a modal that is in the way, and pushes the screen on the stack it belongs to. If that stack already has the screen, it goes back to it instead of pushing it twice. |
| `back()` | Goes back one screen. Returns `false` when there is nowhere to go back to. |
| `current` | The screen the user sees: its `url`, `params` and `presentation`. |
| `entries` | The screens of this navigator's stack, first one first. |
| `replaceBase(href)` | Replaces the first screen of this stack. |
| `openURL(url)` | Opens a link to the app (see [Deep links](#deep-links)). Returns `false` when no route matches. |

`goto` takes these options:

| Option | Effect |
| --- | --- |
| `replaceState: true` | replace the top screen instead of pushing a new one |
| `reset: true` | make the target the first screen, with no history: after signing in, for example |
| `presentation` | present this screen as `'modal'`, `'sheet'`, ... this time, whatever the page says |

The header's back button, the iOS edge swipe and Android's back button go back without any code. Android's back button goes to the innermost navigator the user sees.

## Deep links

A link to your app opens the screen of its route. The app's scheme is `scheme` in `app.json` (`init` sets it to the app's slug), so `my-app://posts/42` opens `src/routes/posts/[id]/+mobile.svelte`. Links that match no route are ignored.

The link the app was started with becomes the first screen, with no back button. Links that arrive while the app runs are opened with `goto`.

If your app shell must know the launch link before it renders, for instance to choose between a sign-in screen and the app, await `openLaunchURL(router)` from `@example/svelte-native` before rendering `children`.

## Navigation state

The stacks and the selected tabs survive what the platform does to an app in the background. When Android recreates the app's window (a font size or language change) or ends the process to free memory, the user comes back to the same screens. iOS does the same when the system ended the app, but not when the user swiped it away.

## Not carried over

SvelteKit's `+page.js`, `+page.server.js`, `+layout.js`, `+server.js` and `+error.svelte` have no native counterpart. A screen isn't rendered on a server and has no `load` function: it fetches its own data ([Loading data](loading-data)).
