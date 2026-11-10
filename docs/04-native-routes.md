# Native routes

At the heart of Svelte Native is the same idea as SvelteKit's: a _filesystem-based router_. The directories under `src/routes` define the screens of your app, and the files in them are identified by their `+` prefix. If you know [SvelteKit's routing](https://svelte.dev/docs/kit/routing), you know most of this page.

The difference is the file name. Web routes use `+page.svelte` and `+layout.svelte`. Native routes use `+mobile.svelte` and `+layout.mobile.svelte`, and they can sit in the same directory:

| Web | Native | What it is |
| --- | --- | --- |
| `+page.svelte` | `+mobile.svelte` | a page, one screen of the app |
| `+layout.svelte` | `+layout.mobile.svelte` | a layout around the pages below it |

## +mobile

### +mobile.svelte

A `+mobile.svelte` component defines a screen of your app. The directory gives it a route, as in SvelteKit:

- `src/routes/+mobile.svelte` is the home screen, at `/`
- `src/routes/about/+mobile.svelte` is the screen at `/about`
- `src/routes/blog/[slug]/+mobile.svelte` has a parameter, `slug`

```svelte
<!--- file: src/routes/blog/[slug]/+mobile.svelte --->
<script lang="ts">
	import { Screen, Text, View } from '@example/svelte-native';

	let { params }: { params: { slug: string } } = $props();
</script>

<Screen title="Post">
	<View style={{ padding: 24 }}>
		<Text>You are reading {params.slug}.</Text>
	</View>
</Screen>
```

Route groups `(group)`, parameters `[param]`, optional parameters `[[optional]]` and rest parameters `[...rest]` work as they do on the web. Parameter matchers don't.

A native screen has no `load` function and is not server-rendered. It gets its route parameters as a `params` prop, and fetches its own data.

### Navigating

SvelteKit navigates with `<a href>`. Native has no anchors, so a screen asks the router. `useRouter()` returns the router of the nearest navigator:

```svelte
<!--- file: src/routes/+mobile.svelte --->
<script lang="ts">
	import { Pressable, Screen, Text, useRouter } from '@example/svelte-native';

	const router = useRouter();
</script>

<Screen title="Home">
	<Pressable onPress={() => router.goto('/blog/hello-world')} accessibilityRole="button">
		<Text>Read the post</Text>
	</Pressable>
</Screen>
```

`router.goto(href)` pushes a screen, `router.back()` goes back, and the header's back button, the edge swipe and Android's back button do the same. `goto` never stacks the same screen twice.

## Screen

A screen decides how it looks with `<Screen>`. It sets the native header, a search field, sheets, a toolbar and the system bars:

```svelte
<!--- file: src/routes/settings/+mobile.svelte --->
<script lang="ts">
	import { Screen, Text, View } from '@example/svelte-native';
</script>

<Screen title="Settings" header={{ large: true }}>
	<View style={{ padding: 24 }}>
		<Text>Settings go here.</Text>
	</View>
</Screen>
```

The header is native: a large title collapses as the content scrolls, and on iOS it's UIKit's navigation bar. [The package README](../packages/svelte-native/README.md#navigators-and-screens) lists the options.

By default a page is pushed onto the stack. A page can say that it enters another way, with a literal in its module script:

```svelte
<!--- file: src/routes/account/+mobile.svelte --->
<script lang="ts" module>
	export const presentation = 'modal';
</script>
```

The other values are `push`, `transparentModal`, `sheet` and `formSheet`.

## +layout.mobile

### +layout.mobile.svelte

A layout wraps every screen below its directory. It receives `params`, `url` and a `children` snippet. The one at the root, `src/routes/+layout.mobile.svelte`, is the _app shell_: its `children` is the app's root navigator.

```svelte
<!--- file: src/routes/+layout.mobile.svelte --->
<script lang="ts">
	import type { Snippet } from 'svelte';

	let { children }: { children: Snippet } = $props();
</script>

{@render children()}
```

Put what the whole app needs here: a theme provider, say, or a store that every screen reads.

### Light and dark mode

A screen has no background of its own, as in React Native: what you see behind your views is the window. Give the stack one, so each screen is opaque and a pushed screen covers the one below it while it slides in. A text without a colour is black, so give your texts colours too. `colorScheme.current` is `'light'` or `'dark'`, and a template that reads it draws again when the user switches:

```svelte
<!--- file: src/routes/+layout.mobile.svelte --->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import { Stack, colorScheme } from '@example/svelte-native';

	let { children }: { children: Snippet } = $props();
</script>

<Stack statusBar={{ style: 'auto' }} style={{ backgroundColor: colorScheme.current === 'dark' ? '#000000' : '#f2f2f7' }}>
	{@render children()}
</Stack>
```

The options of a `<Stack>` are the defaults of every screen in it, and `statusBar: { style: 'auto' }` gives the status bar light or dark icons to match. The headers, tab bars and sheets are the platform's, and they follow the system on their own. `init` writes this layout with a small theme, `src/lib/theme.ts`, which the first screens use for their colours.

### Stacks and tabs

What SvelteKit has no word for is a _navigator_: the thing that decides how screens relate to each other. A layout becomes one when its module script exports `navigator`:

```svelte
<!--- file: src/routes/(workspace)/[slug]/+layout.mobile.svelte --->
<script lang="ts" module>
	export const navigator = 'tabs';
</script>

<script lang="ts">
	import type { Snippet } from 'svelte';
	import { Tabs } from '@example/svelte-native';

	let { panes, children }: { panes: readonly { key: string }[]; children: Snippet } = $props();
</script>

<Tabs items={panes.map((pane) => ({ key: pane.key, title: pane.key }))}>{@render children()}</Tabs>
```

- `'stack'` makes the directory a stack: screens push on top of each other. The root is a stack by default.
- `'tabs'` makes the directory a tab bar, with one pane for each child directory. Each pane has its own stack.

A layout without `navigator` is a plain wrapper around the screens below it. This tree shows how they combine:

```tree
src/routes/
├ +layout.mobile.svelte                   the app shell
├ auth/login/+mobile.svelte               a page of the root stack
├ (workspace)/[slug]/
│ ├ +layout.mobile.svelte                 navigator = 'tabs'
│ ├ home/+mobile.svelte                   the "home" tab
│ ├ settings/+mobile.svelte               the "settings" tab
│ └ settings/[section]/+mobile.svelte     pushed inside the settings tab
└ account/+mobile.svelte                  presentation = 'modal': covers the tab bar
```

Tabs, stacks, headers and sheets are the platform's own: UIKit's on iOS, the library's engine on Android.

## Not carried over

Some of SvelteKit's route files have no native counterpart: `+page.js`, `+page.server.js`, `+layout.js`, `+server.js` and `+error.svelte`. A screen doesn't load its data before it appears, because there's no server in the app to run `load` on. Fetch from the screen, or use [remote functions](../packages/svelte-native/README.md#remote-functions).

## Further reading

- SvelteKit's [routing](https://svelte.dev/docs/kit/routing) for the ideas that are shared.
- [The package README](../packages/svelte-native/README.md#add-a-screen) for the primitives (`View`, `Text`, `List`, ...) and the screen options.
