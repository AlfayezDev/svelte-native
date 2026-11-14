---
title: Loading data
video: state-management
---

A native screen is not rendered on a server and has no `load` function. It loads its own data when it appears, in one of two ways: with `fetch`, or with SvelteKit's remote functions, which call your SvelteKit server from the phone with types end to end.

## fetch

`fetch` works as in the browser. Start it while the component initialises and show it with `{#await}`:

```svelte
<!--- file: src/routes/posts/+mobile.svelte --->
<script lang="ts">
	import { ActivityIndicator, Screen, Text, View } from '@alfayez/svelte-native';

	type Post = { id: number; title: string };

	const posts: Promise<Post[]> = fetch('https://api.example.com/posts').then((response) => response.json());
</script>

<Screen title="Posts">
	<View style={{ padding: 16, gap: 8 }}>
		{#await posts}
			<ActivityIndicator accessibilityLabel="Loading" />
		{:then posts}
			{#each posts as post (post.id)}
				<Text>{post.title}</Text>
			{/each}
		{:catch}
			<Text>Couldn't load the posts.</Text>
		{/await}
	</View>
</Screen>
```

An address on your own computer (`http://localhost:5173`) is not the phone's localhost. Use an address the phone can reach, or forward the port of a USB-connected Android phone with `adb reverse tcp:5173 tcp:5173`.

## Remote functions

SvelteKit's [remote functions](https://svelte.dev/docs/kit/remote-functions) work on the phone as they do in the browser. You write `query`, `command` and `form` functions in a `.remote.ts` file, and both your web pages and your native screens import them. The server is your SvelteKit app, unchanged.

```ts
/// file: src/lib/posts.remote.ts
import { command, query } from '$app/server';
import * as v from 'valibot';
import * as db from '$lib/server/db';

export const getPosts = query(async () => {
	return db.posts();
});

export const like = command(v.number(), async (id) => {
	await db.like(id);
	await getPosts().refresh();
});
```

```svelte
<!--- file: src/routes/posts/+mobile.svelte --->
<script lang="ts">
	import { Pressable, Screen, Text, View } from '@alfayez/svelte-native';
	import { getPosts, like } from '#lib/posts.remote.ts';

	const posts = getPosts();
</script>

<Screen title="Posts">
	<View style={{ padding: 16, gap: 8 }}>
		{#each posts.current ?? [] as post (post.id)}
			<Pressable onPress={() => like(post.id)} accessibilityRole="button">
				<Text>{post.title} ({post.likes})</Text>
			</Pressable>
		{/each}
	</View>
</Screen>
```

What you get back is SvelteKit's own client API: a query has `.current`, `.loading`, `.error` and `.refresh()`, and you can `await` it. `query.batch`, `query.live`, `prerender`, single-flight mutations with `.updates()`, `error()` and `redirect()` work too. When the user leaves a screen, the queries it made are released and its live queries close.

### Set it up

1. Turn remote functions on in your SvelteKit config, as for the web: `experimental: { remoteFunctions: true }`.
2. Tell the app where the server is, in the Svelte Native plugin's options in `app.config.ts` (or `app.json`):

   ```ts
   /// file: app.config.ts
   export default {
   	expo: {
   		plugins: [['@alfayez/svelte-native', { remote: { origin: 'https://app.example.com' } }]]
   	}
   };
   ```

   The origin must be the one your server sees as its own: SvelteKit refuses a remote call from another origin. Add `base` or `appDir` if your app changes SvelteKit's `paths.base` or `appDir`. Run `expo prebuild` after changing it ([Development builds](development-builds#when-to-run-expo-prebuild)).
3. Make sure the server knows the remote module. A module that no web page imports isn't registered: import it from `hooks.server.ts`, or list it in `server.warmup.ssrFiles` for `vite dev`.

A call made by a build without an origin throws a `RemoteConfigError` saying so.

Your `transport` and client `handleError` hooks go in `src/hooks.mobile.ts` ([Hooks](hooks)).

The app talks to the server with the platform's cookie jar, so a session cookie that a command sets reaches the next call. Each request carries the screen's path, so `getRequestEvent().url` is the screen's URL.

### Forms

There is no `<form>` and no `<input>`, so a `form` function is used through its fields. `field.as(type)` returns the props of a native input; spread them onto a [`TextInput`](text-input), a [`Switch`](switch) or a submit [`Pressable`](pressable). Wrap the form in `native()` so the types describe native inputs:

```svelte
<script lang="ts">
	import { Pressable, Switch, Text, TextInput, View } from '@alfayez/svelte-native';
	import { native } from '@alfayez/svelte-native/remote';
	import { addPost } from '#lib/posts.remote.ts';

	const form = native(addPost);
</script>

<View style={{ padding: 16, gap: 12 }}>
	<TextInput {...form.fields.title.as('text')} placeholder="Title" accessibilityLabel="Title" />
	{#each form.fields.title.issues() ?? [] as issue (issue.message)}
		<Text style={{ color: '#d70015' }}>{issue.message}</Text>
	{/each}
	<Switch {...form.fields.pinned.as('checkbox')} accessibilityLabel="Pinned" />
	<Pressable onPress={() => form.submit()} accessibilityRole="button">
		<Text>{form.pending ? 'Saving…' : 'Add'}</Text>
	</Pressable>
</View>
```

| `as(...)` | Spread onto |
| --- | --- |
| `'text'`, `'email'`, `'password'`, `'tel'`, `'url'`, `'search'`, `'textarea'`, the date and time types | `TextInput`, with the matching keyboard |
| `'number'`, `'range'` | `TextInput` with a number pad; the field holds a number |
| `'checkbox'`, `'radio', value` | `Switch` |
| `'select'` | your own picker: `value` and `onValueChange` |
| `'hidden', value` | nothing: sent with every submission |
| `'submit', value` | `Pressable`: sets the field and submits |

What is submitted is what the inputs show, as in a browser. `form.submit()` validates, sends, and resets the form when the server accepts it. It never throws for a failed submission: the error goes to `form.error`, and `submit()` resolves `false`. If you pass your own `ref` to an input, call the one `as()` gave you from it.

### Not supported

File fields; restoring data from a server-rendered page (screens aren't server-rendered); `load` invalidation (`refreshAll()` from `@alfayez/svelte-native/remote` refreshes remote queries only); remote modules inside `node_modules`; `export *` in a remote module.
