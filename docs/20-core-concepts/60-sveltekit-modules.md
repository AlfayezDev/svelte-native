---
title: SvelteKit modules
---

A page you share with the web imports SvelteKit's modules: `goto` from `$app/navigation`, `page` from `$app/state`, `resolve` from `$app/paths`, `spring` from `svelte/motion`. The same imports work in a native screen. When the app is built for a phone, Metro resolves each of them to the library's own implementation, which reads the app's router, the system and the build, so the code needs no `if` for the device.

| Module | On the device |
| --- | --- |
| [`$app/navigation`](#navigation) | `goto` drives the app's router. `preloadCode` loads a screen's code. The rest throws a message that names it. |
| [`$app/state`](#page-state) | `page` is the screen the user sees. `updated` follows the over-the-air updates. `navigating` is never in flight. |
| [`$app/env`](#environment-and-mobile) | `browser` is `false`, `dev` is `__DEV__`, `version` is the app's version, and `mobile` is `true`. |
| [`$app/environment`](#environment-and-mobile) | The name SvelteKit 3 deprecates `$app/env` under: the same module. |
| [`$app/paths`](#paths) | `resolve` builds the path of a route. `asset` and `match` too. |
| [`svelte/motion`](#motion) | Svelte's own, with a `prefersReducedMotion` that reads the system's setting. |

The types are SvelteKit's own, so install `@sveltejs/kit` in the project and nothing needs declaring. The library adds one export, `mobile`, and its declaration comes with the library: a program that has your `vite.config.ts` sees it through the plugin it imports, and one that has your native screens through the router they import.

## Navigation

`goto(url, options?)` from `$app/navigation` goes to a route of the app, through the root router, from any code. [Routing](routing#navigating) has what it does, its options and what rejects it. Called in an `$effect`, it doesn't make the effect depend on the screens: `$effect(() => { if (!signedIn) goto('/sign-in', { replace: true }) })` runs again when `signedIn` changes and not when the user opens another screen.

```ts
/// file: src/lib/session.ts
import { goto } from '$app/navigation';

export async function signedOut() {
	await goto('/sign-in', { replace: true });
}
```

`preloadCode(routeId)` loads the code of the route with that id (`'/posts/[id]'`, with the groups of its directory: `'/(app)/posts/[id]'`): the page and the layouts it brings, or the layout of a tabs or stack navigator, which has an id of its own. The navigation that follows has less to import. It resolves when the code is loaded, rejects with what a failed load threw, and rejects for an id no route has. It loads code only: there is no `load` function to run. `disableScrollHandling` does nothing, since a screen has no scroll handling for it to disable.

SvelteKit declares the rest of the module, so an import of one of them type-checks, and the function throws when it is called. The router has nothing honest behind them:

| Function | What it says |
| --- | --- |
| `beforeNavigate`, `afterNavigate`, `onNavigate` | the router has no navigation hooks. To follow the screen, read `page.url` in an `$effect`. |
| `invalidate`, `invalidateAll`, `refreshAll`, `preloadData` | a screen has no `load` function to run again. `refreshAll` of `@alfayez/svelte-native/remote` refetches the queries of remote functions. |
| `pushState`, `replaceState` | shallow routing needs `page.state`, which the device doesn't have. |
| `snapshot` | screens aren't restored from a history. The router saves its stacks itself ([Navigation state](routing#navigation-state)). |

The error reads `` `beforeNavigate` is not available on the device yet (svelte-native) `` and then why. It is thrown when the function is called. `beforeNavigate`, `afterNavigate`, `onNavigate` and `snapshot` are called while a component initialises, so a screen that calls one fails to render with that message.

## Page state

`page` from `$app/state` is a reactive object, like SvelteKit's, and it describes the screen the user sees now: the deepest one through the stacks, tabs and modals of the app. A tab switch, a push, a modal and a back each change it, and a `$derived` or `$effect` that reads it runs again. It works in any component and in any module, not only below a navigator, and before the app has a router it is the page of nothing (`url` is `/`, `params` is `{}`, `route.id` is `null`).

On the web there is one page at a time, so every component can read its own data from `page`. A phone keeps the screens below the top one mounted, so `page` is the top screen's wherever it is read: a screen that is covered by another one and reads `page.params.id` sees the id of the screen on top of it, and it changes when that screen opens. A screen reads its own data from the `params` and `url` props that SvelteKit gives a page, which are its own however many screens are above it. Use `page` for what concerns the whole app, such as highlighting the current tab in a bar, below, or reporting the screen to analytics.

```svelte
<!--- file: src/routes/posts/[id]/+mobile.svelte --->
<script lang="ts">
	let { params }: { params: { id: string } } = $props();
</script>

<p>Post {params.id}</p>
```

```svelte
<!--- file: src/lib/TabBar.svelte --->
<script lang="ts">
	import { page } from '$app/state';

	const tabs = [
		{ href: '/home', label: 'Home' },
		{ href: '/inbox', label: 'Inbox' }
	];
</script>

{#each tabs as tab (tab.href)}
	<a href={tab.href} aria-current={page.url.pathname.startsWith(tab.href) ? 'page' : undefined}>{tab.label}</a>
{/each}
```

| Property | On the device |
| --- | --- |
| `url` | The URL of the screen, on the origin `https://native.invalid` (a native screen has no real one), the same URL `useRouter().current.url` has. |
| `params` | The parameters of the screen's route: `{ slug: 'acme', id: '7' }`. |
| `route.id` | The id of the route, as SvelteKit writes it: the directory under `src/routes`, groups included, with a slash in front: `/(app)/posts/[id]`. The first screen is `/`. |
| `status` | `200`. |
| `data`, `state` | `{}`. A screen has no `load` function and no `page.state`. |
| `form`, `error`, `shallow` | `null`. |

`navigating` has SvelteKit's shape for "no navigation": `from`, `to`, `type`, `willUnload`, `delta` and `complete` are all `null`. The router puts a screen on the stack in one step and has no navigation in flight to report, so `navigating` never says anything else.

`updated` is SvelteKit's `{ current, check() }`, backed by the library's [over-the-air updates](updates). `updated.current` is `true` once an update is waiting for the next start: a check found one (`updated.check()`, `checkForUpdateAsync`), or one was downloaded (`fetchUpdateAsync`, or the check at launch), and it stays `true` until the app restarts on it. `await updated.check()` asks the server and resolves `true` when an update is waiting. It never rejects: a check that fails (the phone is offline) logs a warning and resolves `false`. In a build with updates off, a development build, `current` is `false` and `check()` resolves `false` without a request.

```svelte
<script lang="ts">
	import { updated } from '$app/state';
	import { reloadAsync } from '@alfayez/svelte-native/updates';
</script>

{#if updated.current}
	<button onclick={() => reloadAsync()}>Update available: restart</button>
{/if}
```

## Environment and mobile

`$app/env` is where SvelteKit 3 keeps `browser`, `dev`, `building` and `version`. SvelteKit 3 deprecates the old name, `$app/environment`; both resolve to the same module on the device, and both work on the web. The library adds `mobile`.

| Export | On the device | In the web build |
| --- | --- | --- |
| `mobile` | `true` | `false` |
| `browser` | `false`: the device is not a browser | SvelteKit's |
| `dev` | `__DEV__`: a development build, served by Metro | SvelteKit's |
| `building` | `false` | SvelteKit's |
| `version` | the `version` of the app config (`app.json`, `app.config.ts`), as `expo-constants` reads it from the config embedded in the build, or `''` when the build has none | the `version.name` of SvelteKit's config |

`mobile` is for code the web and the device share, where one of them should do something the other shouldn't:

```svelte
<!--- file: src/lib/Feed.svelte --->
<script lang="ts">
	import { mobile } from '$app/env';

	let { items }: { items: string[] } = $props();

	// A phone draws fewer rows at a time.
	const visible = $derived(items.slice(0, mobile ? 20 : 100));
</script>

{#if mobile}
	<p>Tap an item to open it.</p>
{:else}
	<p>Click an item to open it.</p>
{/if}

<ul>
	{#each visible as item (item)}
		<li>{item}</li>
	{/each}
</ul>
```

The web side is the Vite plugin: `svelteNative()` in `vite.config.ts` answers an import of `$app/env` (or `$app/environment`) with SvelteKit's own module plus `export const mobile = false`, in `vite dev`, in the client build and in the server build. Where the bundler can see the constant, as it does in a production build, the branch for the other platform is left out of the bundle. The flag does not take out an `import` that the other platform can't resolve. A file that imports a native library is a `+mobile.svelte` file, or is imported only by one: the web build leaves those out, and they need no flag.

`browser` is `false` on the device even though Svelte's runtime believes it runs in a browser (it reads `esm-env`, which stays as it is): a library that guards the DOM with `if (browser)` then skips it.

## Paths

`resolve` from `$app/paths` builds the path of a route from its id and its parameters, as in SvelteKit, with an empty base path:

```ts
import { resolve } from '$app/paths';

resolve('/posts/[id]', { id: 42 }); // '/posts/42'
resolve('/[[lang]]/about', {}); // '/about'
resolve('/docs/[...rest]', { rest: 'a/b' }); // '/docs/a/b'
resolve('/(app)/settings'); // '/settings'
resolve('posts/42'); // '/posts/42'
```

An optional parameter (`[[lang]]`) is left out when it is missing or empty, and a rest parameter (`[...rest]`) is any number of segments. A group (`(app)`) adds nothing to the path, an escape such as `[x+2f]` is the character it stands for, and a search or hash after a route id stays. A matcher (`[id=integer]`) names the parameter and checks nothing, since a native route has no `src/params`. A route id that has a parameter and is given none throws, as does a parameter that is missing, that starts or ends with `/`, or that isn't a string, number, boolean or bigint.

`match(url)` is the other way round: it resolves with `{ id, params }` for the route of the path, or `null` when no screen has it. It rejects before the app has created its router.

`asset(file)` gives `/file`, SvelteKit's path with no base. A device has no `static` directory, so no element can load that path: use an `import` for an image of the project, or a full URL. `base` and `assets`, which SvelteKit 3 no longer exports, are `''` for the code and libraries that still import them.

## Motion

`Spring`, `Tween`, `spring` and `tweened` from `svelte/motion` are Svelte's own. They run on `requestAnimationFrame`, which React Native has. `prefersReducedMotion` isn't: Svelte builds it from `matchMedia`, which React Native lacks, and its module throws `window.matchMedia is not a function` as soon as it is imported. The library's `svelte/motion` loads Svelte's with that one call covered, and `prefersReducedMotion.current` reads the system's setting instead (Reduce Motion on iOS; animations turned off on Android). It is reactive like Svelte's: a template, `$derived` or `$effect` that reads it runs again when the setting changes. It is `false` for the moment before the system answers, which is shortly after the app starts.

```svelte
<script lang="ts">
	import { Tween, prefersReducedMotion } from 'svelte/motion';

	const progress = new Tween(0, { duration: prefersReducedMotion.current ? 0 : 400 });
</script>
```

The other `svelte/*` modules that read the window have a counterpart too: `svelte/reactivity/window` is the window's size ([Platform APIs](platform-apis#window-size)). `MediaQuery` from `svelte/reactivity` is not one of them. It reads `matchMedia` and throws when it is constructed, so use `windowSize` for sizes, `colorScheme` for dark mode and `prefersReducedMotion` for motion.

## Not available

An import of one of these fails the Metro build, naming the module and why:

| Module | Why |
| --- | --- |
| `$app/forms` | Forms submit to a SvelteKit server's actions. Use a remote function's `form` ([Loading data](loading-data)). |
| `$app/stores` | SvelteKit 3 removed the stores. Use `page` from `$app/state`. |
| `$app/manifest`, `$app/service-worker` | They describe the web build's files, and a phone has no service worker. |
| `$app/env/public` | The app has no SvelteKit environment. Read what it needs from the app config's `extra` with `expo-constants`. |
| `$app/server`, `$app/env/private`, `$env/*/private` | They are server-only: `Server-only import in native bundle`. Code that runs on the server stays on it, in `.server.ts` files and remote functions. |

The same goes for the files SvelteKit runs on the server or in the browser only, `+page.js`, `+page.server.js`, `+server.js` and `+error.svelte`: they have no counterpart on the device ([Routing](routing#not-carried-over)).
