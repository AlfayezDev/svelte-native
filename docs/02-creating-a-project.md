# Creating a project

You start where every SvelteKit app starts, with `npx sv create`, and then add the native layer. This page takes you from nothing to your app running on a device or emulator. If you'd rather not type the steps, [one command](#the-shortcut) does them for you.

## Before you start

You need:

- Node 25 or newer, and pnpm 12.3.4 or newer. The patches Svelte Native relies on are pnpm's, so npm and Yarn won't do.
- Git, and read access to the private repository over SSH. Ask to be added as a collaborator and make sure the SSH key you use is on your GitHub account: `ssh -T git@github.com` should greet you by name.
- To run on Android: [Android Studio](https://developer.android.com/studio) with the SDK packages Gradle asks for (platform 36, build-tools 36.0.0, NDK 27.1.12297006, CMake 3.22.1), a JDK 17, and `ANDROID_HOME` set. You also need a phone with USB debugging or an emulator.
- To run on iOS: a Mac with Xcode and CocoaPods, and a simulator or an iPhone.

> [!NOTE] If `pnpm` can't read the repository, you'll see `ERR_PNPM_GIT_RESOLVE_FAILED`. The fix is one `git config` line, in [Troubleshooting](08-troubleshooting.md#pnpm-cannot-read-the-repository).

## The shortcut

`scripts/new-app.sh` does everything on this page. It lives in the repository, so clone it first. You don't have to keep the clone:

```sh
git clone --depth 1 git@github.com:AlfayezDev/svelte-native.git /tmp/svelte-native
/tmp/svelte-native/scripts/new-app.sh my-app
cd my-app && pnpm android
```

The script checks your tools, runs `sv create`, adds the native layer, installs, applies the patches and runs `svelte-native doctor`. It takes about 20 seconds on a machine that has never installed these packages, and a few seconds when pnpm already has them. It builds nothing: the first `pnpm android` does.

The rest of this page is what the script does, so that you know what you have.

## Create a SvelteKit project

```sh
npx sv create my-app
```

`sv` asks a few questions. Answer them like this:

- **Which template?** SvelteKit minimal.
- **Add type checking with TypeScript?** Yes, using TypeScript syntax.
- **What would you like to add?** Nothing. Press Enter.
- **Which package manager?** pnpm.

To skip the questions, pass the answers as flags:

```sh
npx sv@1.3.0 create my-app --template minimal --types ts --no-add-ons --install pnpm
```

That is what this page was written against (`sv` 1.3.0, which creates a project with SvelteKit 3.1 and Svelte 5.57). Then:

```sh
cd my-app
```

## Use the Svelte and SvelteKit that Svelte Native needs

`sv` installed the registry's `svelte` and a recent `@sveltejs/kit`. Svelte Native needs two others:

- **Svelte** from a custom-renderer build. The registry's Svelte has the same version number, but not the `./renderer` export the library compiles against.
- **SvelteKit 3.1.1**, exactly. The library patches that version so that SvelteKit's router leaves `+mobile.svelte` files alone.

Change three lines in `package.json`:

```json
/// file: package.json
{
	"devDependencies": {
		"@sveltejs/kit": "3.1.1",
		"@sveltejs/vite-plugin-svelte": "7.2.0",
		"svelte": "https://pkg.pr.new/svelte@216f258068d93170a927ad4d27ee6864b0b305c5"
	}
}
```

The versions are exact, with no `^`. `vite-plugin-svelte` is pinned to the version the library's own web app uses: with a newer one, `svelte-check` reports a type error inside the library.

## Add the library

Add the library and the packages it needs next to the ones `sv` wrote. The `main` and `reanimated` entries are new, too:

```json
/// file: package.json
{
	"main": ".svelte-native/entry.ts",
	"dependencies": {
		"@example/svelte-native": "git+ssh://git@github.com/AlfayezDev/svelte-native.git#<tag>&path:packages/svelte-native",
		"expo": "57.0.30",
		"expo-constants": "57.0.22",
		"hermes-intl": "^0.1.2",
		"react": "19.2.7",
		"react-native": "0.86.3",
		"react-native-gesture-handler": "2.32.0",
		"react-native-reanimated": "4.5.1",
		"react-native-worklets": "0.10.1"
	},
	"reanimated": {
		"staticFeatureFlags": {
			"ANDROID_SYNCHRONOUSLY_UPDATE_UI_PROPS": true
		}
	}
}
```

Replace `<tag>` with the newest release tag of the repository (`v0.3.0` at the time of writing). A few things in there are worth knowing:

- `react` is there because React Native itself needs it. Your own code doesn't use it.
- The versions are exact because the patches in the next step are for one version each.
- `main` points at a file that Svelte Native generates. Without it Expo would look for `expo/AppEntry.js`.
- The `reanimated` flag turns on a path the library's Android renderer uses for animations.

To make the native commands easy to run, add scripts next to `sv`'s. `dev`, `build` and `preview` stay the web app's:

```json
/// file: package.json
{
	"scripts": {
		"native": "svelte-native dev",
		"android": "svelte-native android",
		"ios": "svelte-native ios"
	}
}
```

## Add pnpm's settings

pnpm needs to be told two things. Add them to the `pnpm-workspace.yaml` that `sv` created, which already has `allowBuilds` for esbuild:

```yaml
/// file: pnpm-workspace.yaml
engineStrict: true
allowBuilds:
  esbuild: true

overrides:
  expo-modules-core: 57.0.23
```

`expo` asks for `expo-modules-core` by a range, so a fresh install would take the newest one, and the patch in the next step is for 57.0.23 only.

Install:

```sh
pnpm install --no-frozen-lockfile
```

## Apply the patches

Svelte Native works only with a handful of third-party packages patched. pnpm applies a patch only from your own project, so you copy the library's patch files in and declare them:

```sh
mkdir -p patches/svelte-native
cp node_modules/@example/svelte-native/patches/*.patch patches/svelte-native/
```

```yaml
/// file: pnpm-workspace.yaml
patchedDependencies:
  "@sveltejs/kit@3.1.1": patches/svelte-native/@sveltejs__kit@3.1.1.patch
  expo-modules-core@57.0.23: patches/svelte-native/expo-modules-core@57.0.23.patch
  react-native-gesture-handler@2.32.0: patches/svelte-native/react-native-gesture-handler@2.32.0.patch
  react-native-reanimated@4.5.1: patches/svelte-native/react-native-reanimated@4.5.1.patch
  react-native-worklets@0.10.1: patches/svelte-native/react-native-worklets@0.10.1.patch
```

```sh
pnpm install --no-frozen-lockfile
```

Declare only the patches for packages you have installed. The library also has patches for four optional view libraries; you add those when you install the library ([Native libraries](06-native-libraries.md)). Copy the patches again after every upgrade of Svelte Native. [The package README](../packages/svelte-native/README.md#apply-the-patches) says what each one changes.

## Connect Vite and Metro

SvelteKit's Vite plugin becomes the library's, which wraps it. Replace `vite.config.ts`:

```ts
/// file: vite.config.ts
import adapter from '@sveltejs/adapter-auto';
import { svelteNative } from '@example/svelte-native/vite';
import { defineConfig } from 'vite';

export default defineConfig(({ mode }) => ({
	plugins: [
		svelteNative({
			target: mode === 'native' ? 'native' : 'web',
			kit: {
				adapter: adapter()
			}
		})
	]
}));
```

For `vite dev` and `vite build` this is the SvelteKit plugin, with a few extras that keep the native files out of the web build. `kit` is what you'd have passed to `sveltekit()`. The usual way to build for native is `pnpm android`, which doesn't go through Vite.

The native side uses Metro, which needs a config of its own:

```js
/// file: metro.config.cjs
const { getDefaultConfig } = require('expo/metro-config');
const { withSvelteNative } = require('@example/svelte-native/metro');

module.exports = withSvelteNative(getDefaultConfig(__dirname));
```

And Expo needs to know about the app and the library's plugin:

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
		"plugins": ["@example/svelte-native/expo"]
	}
}
```

Use your own `package` and `bundleIdentifier`. They identify the app on the device.

## Add the first screens

A native screen is a `+mobile.svelte` file, next to the `+page.svelte` of the web app. The app needs a root layout, `+layout.mobile.svelte`, and at least one screen:

```svelte
<!--- file: src/routes/+layout.mobile.svelte --->
<script lang="ts">
	import type { Snippet } from 'svelte';

	let { children }: { children: Snippet } = $props();
</script>

{@render children()}
```

```svelte
<!--- file: src/routes/+mobile.svelte --->
<script lang="ts">
	import { Pressable, Screen, Text, View, useRouter } from '@example/svelte-native';

	const router = useRouter();
	let taps = $state(0);
</script>

<Screen title="Home" header={{ large: true }}>
	<View style={{ flex: 1, padding: 24, gap: 16, justifyContent: 'center' }}>
		<Text style={{ fontSize: 28, fontWeight: '700' }}>Svelte Native</Text>
		<Text>Tapped {taps} {taps === 1 ? 'time' : 'times'}.</Text>
		<Pressable onPress={() => taps++} accessibilityRole="button">
			<Text>Tap</Text>
		</Pressable>
		<Pressable onPress={() => router.goto('/details')} accessibilityRole="button">
			<Text>Open details</Text>
		</Pressable>
	</View>
</Screen>
```

```svelte
<!--- file: src/routes/details/+mobile.svelte --->
<script lang="ts">
	import { Pressable, Screen, Text, View, useRouter } from '@example/svelte-native';

	const router = useRouter();
</script>

<Screen title="Details">
	<View style={{ flex: 1, padding: 24, gap: 16, justifyContent: 'center' }}>
		<Text>A second screen, pushed onto the stack.</Text>
		<Pressable onPress={() => router.back()} accessibilityRole="button">
			<Text>Back</Text>
		</Pressable>
	</View>
</Screen>
```

Finally, keep the files Svelte Native and Expo generate out of git:

```
/// file: .gitignore
.svelte-native
.expo
/android
/ios
```

## Check the setup

```sh
pnpm exec svelte-native doctor
```

`doctor` reads your project and prints one line per check: `pass`, `FAIL`, `skip` or `????`. Under a failure it tells you the fix. You want `0 failed`. Run it with `pnpm exec`: plain `pnpm doctor` is pnpm's own command.

## Run it

With a device or emulator connected:

```sh
pnpm android
```

or, on a Mac, `pnpm ios`. The first run does a lot: it generates the `android/` project (see [Development builds](05-development-builds.md)), compiles React Native and the library's native code with Gradle, installs the app, starts Metro and opens the app. On a fast machine whose Gradle cache is warm that took under two minutes. On a machine that has never built React Native, expect much longer.

If more than one device is connected, `pnpm android --device <name>` picks one. When it works, you'll see your home screen. Tap **Tap**, then **Open details**.

Now change something. Edit the heading in `src/routes/+mobile.svelte` and save: the app reloads with your change in a couple of seconds. Component state resets, because a save remounts the app's root.

## The web app

The web app is still there:

```sh
pnpm dev
```

`vite dev`, `vite build` and `vite preview` work as before. What you gave up is the stock versions. The web app now compiles with the pinned Svelte build, and runs on SvelteKit 3.1.1 (a prerelease) with a patch, not the stable release `sv` installed. When this page was written, `vite dev` and `vite build` worked on the `sv` template with the changes above.

> [!NOTE] `pnpm check` reports one error, in the library's own source: `Property 'unref' does not exist on type 'number'`. `svelte-check` follows imports into the library, and one of its files assumes Node's `setTimeout`. Your code isn't affected, and the build ignores it. See [Troubleshooting](08-troubleshooting.md#pnpm-check-reports-an-error-inside-svelte-native).

## Further reading

- [Project structure](03-project-structure.md) explains what each file you just added is for.
- [Native routes](04-native-routes.md) shows how `+mobile.svelte` files become screens, stacks and tabs.
- [Development builds](05-development-builds.md) explains `expo prebuild`, the daily loop and release builds.
