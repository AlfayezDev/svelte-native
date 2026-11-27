---
title: Configuration
---

What `expo-svelte init` writes, file by file, and the options of the Vite, Metro and Expo plugins. Every change is an ordinary edit: you can make them by hand, in any order, then run `pnpm install` and `pnpm exec expo-svelte doctor`.

## package.json

`init` pins the Svelte and SvelteKit that Expo Svelte needs, adds the packages React Native needs, and adds `main` and four scripts:

```json
/// file: package.json
{
	"scripts": {
		"native": "expo-svelte dev",
		"android": "expo-svelte android",
		"ios": "expo-svelte ios",
		"check-setup": "expo-svelte doctor"
	},
	"dependencies": {
		"expo-svelte": "0.4.0-rc.13",
		"expo": "58.0.26",
		"expo-constants": "58.0.16",
		"react": "19.3.0",
		"react-native": "0.88.1",
	},
	"devDependencies": {
		"@sveltejs/kit": "3.4.0",
		"svelte": "5.59.1"
	},
	"main": ".expo-svelte/entry.ts"
}
```

- `svelte` is exact: custom renderers came with Svelte 5.59.0, and the library is written against 5.59.1. The web app compiles with the same Svelte.
- `@sveltejs/kit` is exact, because a patch is made for that version. A native-only app doesn't need SvelteKit at all.
- The other versions are exact for the same reason. `react` is there because React Native needs it; your code doesn't use it.
- `crypto` ([`crypto`](web-apis#crypto): react-native-quick-crypto, and the base64 module it asks for), the `Intl` APIs Hermes lacks (`hermes-intl`), [`localStorage`](web-apis#storage) (MMKV, which shares the Nitro runtime with quick-crypto), and the gestures, the animation and the [SVG components](svg) of the main entry (`react-native-gesture-handler`, `react-native-reanimated`, `react-native-worklets` and `react-native-svg`) are made of native packages that the library carries itself: they are copied into `expo-svelte`, which links them (with its fixes already applied), so none of them is a dependency of the app. An app that lists one is refused (the prebuild stops, and `expo-svelte doctor` fails): remove it from `package.json`, install again and build again. A library you add that asks for one of them as a peer dependency gets the library's copy; your package manager may warn about the missing peer, and that is expected.
- `main` points at the entry point Expo Svelte generates. Without it, Expo looks for `expo/AppEntry.js`.
- Nothing else is needed for animations: the fast path Expo Svelte uses for them on Android is on in the library's copy of Reanimated. (An older app has a `reanimated` entry with `staticFeatureFlags` for it; you can delete it, and what it sets still wins.)
- `dev`, `build`, `preview` and `check` stay the web app's. Don't name a script `doctor`: `pnpm doctor` is pnpm's own command.

## pnpm-workspace.yaml

`sv` writes this file for pnpm. `init` adds `overrides`, `patchedDependencies` and `virtualStoreDirMaxLength`:

```yaml
/// file: pnpm-workspace.yaml
engineStrict: true
allowBuilds:
  esbuild: true

overrides:
  expo-modules-core: 58.1.0
  "@react-native/metro-config": 0.88.1
patchedDependencies:
  "@sveltejs/kit@3.4.0": patches/expo-svelte/@sveltejs__kit@3.4.0.patch
  expo-modules-core@58.1.0: patches/expo-svelte/expo-modules-core@58.1.0.patch

virtualStoreDirMaxLength: 60
```

- `allowBuilds` lets esbuild run its install script. Without it, pnpm stops with `ERR_PNPM_IGNORED_BUILDS`.
- `overrides` pins two packages that come with others and are asked for by a range. `expo-modules-core` stays at the version its patch is for. `@react-native/metro-config` stays at React Native's version; otherwise a fresh install can take another one.
- `patchedDependencies` lists the patches (below).
- `virtualStoreDirMaxLength` is how long a folder name of `node_modules/.pnpm` may be before pnpm cuts it. pnpm names a folder of `node_modules/.pnpm` after the dependency path, and with the patched SvelteKit that `init` declares the library's is `expo-svelte@<version>_@sveltejs+kit@3.4.0_patch_hash=<hash>_<hash>`. A name no longer than `virtualStoreDirMaxLength` and with no uppercase letter stays as it is; a longer one, or one with an uppercase letter (unless it starts with `file+`), is cut to its first `limit - 33` characters (all of it, when it is shorter) and a hash is added (`depPathToFilename`, in pnpm's `@pnpm/dependency-path`), so the `=` of `patch_hash=` goes only when the cut falls before it. At the default, 120, 87 characters stay and it stays; at 60, 27 stay, which end inside the first peer's name (`expo-svelte@0.4.0-rc.11_@sv`), and it goes. Android's prefab tool, which the CMake builds of the libraries the package carries run, reads a package path with an `=` in it as an option: `Error: no such option /…/expo-svelte@…_patch_hash` (`CXX1429`). `expo-svelte doctor` fails on such a folder (and reports an `=` elsewhere in the path, the project's own or a `virtualStoreDir`'s, as unknown). `init` writes the setting and lowers a larger one, keeping the comment on its line; install again after it (pnpm asks to remove `node_modules`; `init` passes `--config.confirmModulesPurge=false` when it has no terminal to ask). Every prefab package the library links is in its own folder, so that is the path that counts; a package of your own patches whose `name@version` is up to 15 characters keeps its `=` at 60 (set the limit to its length plus 44 or less if it publishes a prefab package).

## Patches

Expo Svelte depends on small changes to a few packages. The ones you install ship with the library as pnpm patches, each made for one exact version (a package the library carries itself, such as gesture handler, Reanimated and worklets, or a view library, is patched in its copy instead: you declare nothing for it):

| Package | Needed | What the patch changes |
| --- | --- | --- |
| `@sveltejs/kit` 3.4.0 | when SvelteKit is installed | SvelteKit leaves `+mobile.svelte` files alone |
| `expo-modules-core` 58.1.0 | always | Android: Expo modules start faster |

pnpm applies a patch only from your own project, and reads the files before it installs anything, so `init` copies them from the library into `patches/expo-svelte/` and lists the ones for packages you have. Don't point `patchedDependencies` into `node_modules`: a fresh install would fail before the files exist.

After every upgrade of Expo Svelte, run `pnpm exec expo-svelte init` again: it replaces the copies that changed. An old copy still applies, but without the fix. Most patches change native code, so build the app again afterwards.

The view libraries Expo Svelte carries (`lottie-react-native`, `react-native-maps`, `react-native-pdf` and `react-native-video` among them) are patched in the library's own copies, so there is nothing to declare for them: see [Native views](native-views#patches).

## metro.config.cjs

```js
/// file: metro.config.cjs
const { getDefaultConfig } = require('expo/metro-config');
const { withExpoSvelte } = require('expo-svelte/metro');

module.exports = withExpoSvelte(getDefaultConfig(__dirname));
```

`withExpoSvelte(config, options?)` adds the Svelte compiler, the route table and the remote functions to Expo's Metro config. No `babel.config.js` is needed. Its options:

| Option | Default | What it does |
| --- | --- | --- |
| `runes` | `true` | Compile every component of the app in runes mode. Set `false` while you migrate legacy components: Svelte then decides per file. |
| `async` | `false` | Experimental. Compile every Svelte file with Svelte's async mode, which [`router.prepare`](routing#preparing-a-screen-experimental) needs and which allows `await` in `$derived`, in the markup and at the top of a component. See [Preparing a screen](routing#preparing-a-screen-experimental) for what changes. |
| `syncRoutes` | `true` when `src/routes` exists | Write the route table when Metro starts, and again when a route file changes. |
| `stubbedPackages` | `[]` | Packages this build doesn't link. Importing one gives a module that throws when used. |
| `libraries` | the app's config | The [libraries](#libraries) the app turns on. Metro reads them from your Expo config, so you don't set this. The ones that are off resolve to a stub that says how to turn them on. |
| `css` | none | Your CSS file, relative to the project (`'src/global.css'`): its classes, Tailwind's included, become the styles of `class`. See [Classes](styling#classes). |

## vite.config.ts

SvelteKit's plugin is replaced by Expo Svelte's, which wraps it. What you passed to `sveltekit()` becomes `kit`, and the config becomes a function of the mode:

```ts
/// file: vite.config.ts
import adapter from '@sveltejs/adapter-auto';
import { expoSvelte } from 'expo-svelte/vite';
import { defineConfig } from 'vite';

export default defineConfig(({ mode }) => ({
	plugins: [
		expoSvelte({
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
		"userInterfaceStyle": "automatic",
		"android": { "package": "dev.example.myapp" },
		"ios": { "bundleIdentifier": "dev.example.myapp" },
		"plugins": ["expo-svelte"]
	}
}
```

`"userInterfaceStyle": "automatic"` lets the app follow the system's light or dark mode; Expo's default, `"light"`, keeps it light. `init` writes it only in an `app.json` it creates. The plugin applies the style on Android as Expo does on iOS (`android.userInterfaceStyle` wins there), unless the app has `expo-system-ui`, which does it itself.

The plugin is named by the package's own name: Expo loads the package's `app.plugin.js`. (`expo-svelte/app.plugin` is that same file. `expo-svelte/expo`, the plugin's path in 0.4.0-rc.6 and before, was removed in 0.4.0-rc.7 and no longer resolves: write the package's name in its place.) If your app is configured in code, `app.config.ts`, add it there. It takes options as a second element:

```ts
/// file: app.config.ts
export default {
	expo: {
		plugins: [['expo-svelte', { remote: { origin: 'https://app.example.com' } }]]
	}
};
```

| Option | What it does |
| --- | --- |
| `remote` | `{ origin, base?, appDir? }`: the SvelteKit server your [remote functions](loading-data#remote-functions) call. An `http:` origin also allows plain HTTP to it. |
| `libraries` | The native view libraries the app uses, from the ones Expo Svelte carries: `{ 'expo-image': true, 'react-native-maps': { androidGoogleMapsApiKey } }`. See [Libraries](#libraries). |
| `androidOnDemandViewManagers` | Android: create a package's views on first use instead of at startup, by the package's class name: `{ "com.brentvatne.react.ReactVideoPackage": ["RCTVideo"] }`. Shortens startup when you link libraries with many views. The entries of a library you didn't turn on are ignored. |
| `autolinkingExclude` | Packages and local modules to leave out of this build's native code. |
| `sodiumEnabled` | `true` adds libsodium to [`crypto`](web-apis#crypto) (XSalsa20 and the other libsodium ciphers, which OpenSSL lacks): the option of the same name that react-native-quick-crypto's own Expo plugin took. An app that listed that plugin, `['react-native-quick-crypto', { sodiumEnabled: true }]`, removes it and sets the option here. Off by default; it makes the iOS build download and compile libsodium. |
| `capabilities` | What needs a permission or a service of the system, each on once you give what it needs. `{ location: 'Shows the stores near you.' }` turns on `navigator.geolocation`, with nothing to install ([Geolocation](web-apis#geolocation)). A capability that is off isn't compiled into the iOS app at all, so App Store Connect sees none of its APIs. `{ push: { … } }` turns on push notifications (below). |

Run `expo prebuild` after changing the plugin's options ([Development builds](development-builds#when-to-run-expo-prebuild)).

### Libraries

Expo Svelte carries the native view libraries of [Native views](native-views) (`expo-image`, `expo-blur`, `expo-linear-gradient`, `expo-conic-gradient`, `expo-video`, `react-native-video`, `lottie-react-native`, `rive-react-native`, `@react-native-community/datetimepicker`, `react-native-pdf` with `react-native-blob-util`, `react-native-webview`, `react-native-maps`, `react-native-view-shot`, `react-native-fast-shadow` and `react-native-animateable-text`). An app turns on the ones it uses; nothing is installed.

```ts
/// file: app.config.ts
export default {
	expo: {
		plugins: [
			[
				'expo-svelte',
				{
					libraries: {
						'expo-image': true,
						'expo-video': { supportsPictureInPicture: true },
						'react-native-maps': { androidGoogleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY }
					}
				}
			]
		]
	}
};
```

Each value is `true`, `false` (the same as leaving the library out) or the options of the library's own Expo config plugin, which Expo Svelte runs from the library's copy. A library without a config plugin takes no options. The prebuild refuses a name that isn't one of the libraries, and an app that lists a library in its `package.json` or in `plugins`: remove it there, and give its options here.

A library that is on is linked on Android and iOS, bundled by Metro and configured by its plugin. One that is off is none of those: its native code isn't in the build (on iOS it isn't even compiled), Metro gives its name a stub, and its components say how to turn it on. `pnpm exec expo-svelte doctor` lists the libraries that are on. Run `expo prebuild` after changing the option.

### capabilities.push

[Push notifications](push-notifications) are on when `capabilities.push` names a platform, with identifiers only. `push: false` (or leaving it out) is off.

```ts
/// file: app.config.ts
export default {
	expo: {
		android: { package: 'dev.example.myapp' },
		plugins: [
			[
				'expo-svelte',
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
