---
title: Configuration
---

What `svelte-native init` writes, file by file, and the options of the Vite, Metro and Expo plugins. Every change is an ordinary edit: you can make them by hand, in any order, then run `pnpm install` and `pnpm exec svelte-native doctor`.

## package.json

`init` pins the Svelte and SvelteKit that Svelte Native needs, adds the packages React Native needs, and adds `main` and four scripts:

```json
/// file: package.json
{
	"scripts": {
		"native": "svelte-native dev",
		"android": "svelte-native android",
		"ios": "svelte-native ios",
		"check-setup": "svelte-native doctor"
	},
	"dependencies": {
		"@alfayez/svelte-native": "git+ssh://git@github.com/AlfayezDev/svelte-native.git#<tag>&path:packages/svelte-native",
		"expo": "57.0.30",
		"expo-constants": "57.0.22",
		"react": "19.2.7",
		"react-native": "0.86.3",
		"react-native-gesture-handler": "2.32.0",
		"react-native-reanimated": "4.5.1",
		"react-native-svg": "15.15.4",
		"react-native-worklets": "0.10.1"
	},
	"devDependencies": {
		"@sveltejs/kit": "3.1.1",
		"svelte": "https://pkg.pr.new/svelte@216f258068d93170a927ad4d27ee6864b0b305c5"
	},
	"main": ".svelte-native/entry.ts",
	"reanimated": {
		"staticFeatureFlags": {
			"ANDROID_SYNCHRONOUSLY_UPDATE_UI_PROPS": true
		}
	}
}
```

- `svelte` is a build of Svelte with a custom-renderer export, from a [pull request](https://github.com/sveltejs/svelte/pull/18042) that isn't merged yet. The registry's Svelte has the same version number but not that export. The web app compiles with this build too.
- `@sveltejs/kit` is exact, because a patch is made for that version. A native-only app doesn't need SvelteKit at all.
- The other versions are exact for the same reason. `react` is there because React Native needs it; your code doesn't use it.
- `react-native-svg` draws the [SVG components](svg) the main entry exports. It is a required dependency, with native code, so it must be one of the app itself too.
- `crypto` ([`crypto`](web-apis#crypto): react-native-quick-crypto, and the base64 module it asks for), the `Intl` APIs Hermes lacks (`hermes-intl`) and [`localStorage`](web-apis#storage) (MMKV, which shares the Nitro runtime with quick-crypto) are made of native packages that the library carries itself: `react-native-quick-crypto`, `react-native-quick-base64`, `hermes-intl`, `react-native-mmkv` and `react-native-nitro-modules` are copied into `@alfayez/svelte-native`, which links them, so none of them is a dependency of the app. An app that lists one is refused (the prebuild stops, and `svelte-native doctor` fails).
- `main` points at the entry point Svelte Native generates. Without it, Expo looks for `expo/AppEntry.js`.
- The `reanimated` flag turns on the fast path Svelte Native uses for animations on Android.
- `dev`, `build`, `preview` and `check` stay the web app's. Don't name a script `doctor`: `pnpm doctor` is pnpm's own command.

## pnpm-workspace.yaml

`sv` writes this file for pnpm. `init` adds `overrides` and `patchedDependencies`:

```yaml
/// file: pnpm-workspace.yaml
engineStrict: true
allowBuilds:
  esbuild: true

overrides:
  expo-modules-core: 57.0.23
  "@react-native/metro-config": 0.86.3
patchedDependencies:
  "@sveltejs/kit@3.1.1": patches/svelte-native/@sveltejs__kit@3.1.1.patch
  expo-modules-core@57.0.23: patches/svelte-native/expo-modules-core@57.0.23.patch
  react-native-gesture-handler@2.32.0: patches/svelte-native/react-native-gesture-handler@2.32.0.patch
  react-native-reanimated@4.5.1: patches/svelte-native/react-native-reanimated@4.5.1.patch
  react-native-worklets@0.10.1: patches/svelte-native/react-native-worklets@0.10.1.patch
```

- `allowBuilds` lets esbuild run its install script. Without it, pnpm stops with `ERR_PNPM_IGNORED_BUILDS`.
- `overrides` pins two packages that come with others and are asked for by a range. `expo-modules-core` stays at the version its patch is for. `@react-native/metro-config` stays at React Native's version; otherwise a fresh install takes a newer one, whose tools refuse Node 25.
- `patchedDependencies` lists the patches (below).

## Patches

Svelte Native depends on small changes to a few packages. They ship with the library as pnpm patches, each made for one exact version:

| Package | Needed | What the patch changes |
| --- | --- | --- |
| `@sveltejs/kit` 3.1.1 | when SvelteKit is installed | SvelteKit leaves `+mobile.svelte` files alone |
| `expo-modules-core` 57.0.23 | always | Android: Expo modules start faster |
| `react-native-gesture-handler` 2.32.0 | always | iOS: gestures work in sheets and modals |
| `react-native-reanimated` 4.5.1 | always | Android: animations write to Svelte Native's views directly |
| `react-native-worklets` 0.10.1 | always | an idle screen stops asking for animation frames |
| `lottie-react-native` 7.3.8 | when installed | Android: animation events are never dropped |
| `react-native-maps` 1.27.2 | when installed | Android: map events are never dropped |
| `react-native-pdf` 7.0.3 | when installed | Android: the load event is never dropped |
| `react-native-video` 6.19.3 | when installed | Android: playback events are never dropped |

pnpm applies a patch only from your own project, and reads the files before it installs anything, so `init` copies them from the library into `patches/svelte-native/` and lists the ones for packages you have. Don't point `patchedDependencies` into `node_modules`: a fresh install would fail before the files exist.

After every upgrade of Svelte Native, run `pnpm exec svelte-native init` again: it replaces the copies that changed. An old copy still applies, but without the fix. Most patches change native code, so build the app again afterwards. When you add one of the optional libraries, install it at the patch's version (`pnpm add react-native-pdf@7.0.3`, not `^7`) and run `init` again to declare its patch.

## metro.config.cjs

```js
/// file: metro.config.cjs
const { getDefaultConfig } = require('expo/metro-config');
const { withSvelteNative } = require('@alfayez/svelte-native/metro');

module.exports = withSvelteNative(getDefaultConfig(__dirname));
```

`withSvelteNative(config, options?)` adds the Svelte compiler, the route table and the remote functions to Expo's Metro config. No `babel.config.js` is needed. Its options:

| Option | Default | What it does |
| --- | --- | --- |
| `runes` | `true` | Compile every component of the app in runes mode. Set `false` while you migrate legacy components: Svelte then decides per file. |
| `async` | `false` | Experimental. Compile every Svelte file with Svelte's async mode, which [`router.prepare`](routing#preparing-a-screen-experimental) needs and which allows `await` in `$derived`, in the markup and at the top of a component. See [Preparing a screen](routing#preparing-a-screen-experimental) for what changes. |
| `syncRoutes` | `true` when `src/routes` exists | Write the route table when Metro starts, and again when a route file changes. |
| `stubbedPackages` | `[]` | Packages this build doesn't link. Importing one gives a module that throws when used. |
| `css` | none | Your CSS file, relative to the project (`'src/global.css'`): its classes, Tailwind's included, become the styles of `class`. See [Classes](styling#classes). |

## vite.config.ts

SvelteKit's plugin is replaced by Svelte Native's, which wraps it. What you passed to `sveltekit()` becomes `kit`, and the config becomes a function of the mode:

```ts
/// file: vite.config.ts
import adapter from '@sveltejs/adapter-auto';
import { svelteNative } from '@alfayez/svelte-native/vite';
import { defineConfig } from 'vite';

export default defineConfig(({ mode }) => ({
	plugins: [
		svelteNative({
			target: mode === 'native' ? 'native' : 'web',
			kit: {
				// what you passed to sveltekit(), as it was
				adapter: adapter()
			}
		})
	]
}));
```

| Option | What it does |
| --- | --- |
| `target` | `'web'` (the default) is SvelteKit's plugin, plus what keeps the `.mobile.svelte` files out of the web build. `'native'` is for exporting the native bundle through Vite; you normally don't need it. |
| `kit` | SvelteKit's options, as you passed them to `sveltekit()`. |
| `runes` | As for Metro. Set the same value in both, so a shared component means the same thing on both targets. |
| `async` | As for Metro (experimental). On the web target it is added to the compiler options you gave `kit`, under yours. |

## tsconfig.json

The library ships type declarations, and an app's type checker (`tsc`, `svelte-check`, the editor) reads them. They resolve with `moduleResolution: "bundler"`, which SvelteKit's generated `.svelte-kit/tsconfig.json` sets, so a SvelteKit project needs nothing. Under `node16` or `nodenext` a relative `./View.svelte` in a declaration resolves to a `View.d.svelte.ts` and not to the `View.svelte.d.ts` that is there, and the components lose their types (every library built with `svelte-package` has this limit): use `bundler`.

## app.json

`init` adds the plugin to the `plugins` of your `app.json`, and creates the file if there is none:

```json
/// file: app.json
{
	"expo": {
		"name": "my-app",
		"slug": "my-app",
		"scheme": "my-app",
		"version": "1.0.0",
		"android": { "package": "dev.example.myapp" },
		"ios": { "bundleIdentifier": "dev.example.myapp" },
		"plugins": ["@alfayez/svelte-native"]
	}
}
```

The plugin is named by the package's own name: Expo loads the package's `app.plugin.js`. (`@alfayez/svelte-native/app.plugin` is that same file. `@alfayez/svelte-native/expo`, the plugin's path in 0.4.0-rc.6 and before, was removed in 0.4.0-rc.7 and no longer resolves: write the package's name in its place.) If your app is configured in code, `app.config.ts`, add it there. It takes options as a second element:

```ts
/// file: app.config.ts
export default {
	expo: {
		plugins: [['@alfayez/svelte-native', { remote: { origin: 'https://app.example.com' } }]]
	}
};
```

| Option | What it does |
| --- | --- |
| `remote` | `{ origin, base?, appDir? }`: the SvelteKit server your [remote functions](loading-data#remote-functions) call. An `http:` origin also allows plain HTTP to it. |
| `androidOnDemandViewManagers` | Android: create a package's views on first use instead of at startup, by the package's class name: `{ "com.brentvatne.react.ReactVideoPackage": ["RCTVideo"] }`. Shortens startup when you link libraries with many views. |
| `autolinkingExclude` | Packages and local modules to leave out of this build's native code. |
| `sodiumEnabled` | `true` adds libsodium to [`crypto`](web-apis#crypto) (XSalsa20 and the other libsodium ciphers, which OpenSSL lacks): the option of the same name that react-native-quick-crypto's own Expo plugin took. An app that listed that plugin, `['react-native-quick-crypto', { sodiumEnabled: true }]`, removes it and sets the option here. Off by default; it makes the iOS build download and compile libsodium. |
| `capabilities` | What needs a permission or a service of the system, each on once you give what it needs. `{ location: 'Shows the stores near you.' }` turns on `navigator.geolocation`, with nothing to install ([Geolocation](web-apis#geolocation)). A capability that is off isn't compiled into the iOS app at all, so App Store Connect sees none of its APIs. `{ push: { … } }` turns on push notifications (below). |

Run `expo prebuild` after changing the plugin's options ([Development builds](development-builds#when-to-run-expo-prebuild)).

### capabilities.push

[Push notifications](push-notifications) are on when `capabilities.push` names a platform, with identifiers only. `push: false` (or leaving it out) is off.

```ts
/// file: app.config.ts
export default {
	expo: {
		android: { package: 'dev.example.myapp' },
		plugins: [
			[
				'@alfayez/svelte-native',
				{
					capabilities: {
						push: {
							android: {
								googleServicesFile: './google-services.json',
								icon: './assets/notify.png',
								color: '#0a7f5a',
								channel: { id: 'updates', name: 'Updates', description: 'News from the team' }
							},
							ios: { mode: 'production' }
						}
					}
				}
			]
		]
	}
};
```

At least one of `android` and `ios` is needed, and a platform that isn't named isn't served. The paths are read from the app's directory.

| Option | Type | Default | What it does |
| --- | --- | --- | --- |
| `android.googleServicesFile` | `string` | none (required with `android`) | The Firebase project's `google-services.json`. It needs a client for `android.package`, which the config must set. Expo's prebuild copies it into `android/app` and applies the Google services Gradle plugin. The plugin sets the config's `android.googleServicesFile` from it, and stops if the config already names another file. |
| `android.icon` | `string` | the app's icon | A PNG for the notification's small icon, white on a transparent background, as Android draws it. Copied into `res/drawable` and set as Firebase's default notification icon. |
| `android.color` | `string` | none | The accent color of a notification: `#RRGGBB`, or `#RGB`, `#ARGB` or `#AARRGGBB`. Set as Firebase's default notification color. |
| `android.channel` | `{ id?, name, description? }` | `{ id: 'default', name: 'Notifications' }` | The notification channel that notifications go to. `name` is required when `channel` is given: it is what the user reads in the app's notification settings. `id` defaults to `'default'`; `description` is optional. The channel's importance is high, so a notification is a banner with a sound. Android keeps the first version of a channel it has seen, so a new `name` reaches only a reinstalled app. |
| `ios.mode` | `'development' \| 'production'` | none (required with `ios`) | The `aps-environment` entitlement: `'development'` for a build signed for development, `'production'` for TestFlight and the App Store. The plugin also adds `remote-notification` to `UIBackgroundModes` and changes `AppDelegate.swift` so that a push that wakes the app doesn't mount a screen. It stops if `ios.entitlements` already has another `aps-environment`. |

The prebuild stops, with a message that says what to do ([Troubleshooting](troubleshooting#push-notifications)), when:

- `expo-notifications` or `@react-native-firebase/messaging` is installed beside it: an app has one push library;
- the Google services file is missing, isn't JSON, or has no client for the app's `android.package`;
- the config or the Google services file holds a server secret: a service account key, a PEM private key, or the path of a `.p8` file. Those belong to the server's environment;
- an option is malformed: no platform named, `android` without `googleServicesFile`, no `android.package`, an icon that isn't a PNG or isn't there, a color that isn't hex, a channel without a `name`, or an `ios.mode` that is neither `'development'` nor `'production'`.

Turning push off (or leaving a platform out) and prebuilding again without `--clean` removes what the capability added to that platform's native project: the `AppDelegate.swift` change, the manifest entries, and the channel, icon and color resources. The `aps-environment` entitlement, the `remote-notification` background mode and the Google services file stay, because the app or another library may need them: remove them by hand, or prebuild with `--clean`.
