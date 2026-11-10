# Creating a project

You start where every SvelteKit app starts, with `npx sv create`. Then you install Svelte Native and run one command that sets the project up. This page takes you from nothing to your app running on a device or emulator, and then shows what the command changed, so that you know what you have.

## Before you start

You need:

- Node 25 or newer, and pnpm 12.3.4 or newer. The patches Svelte Native relies on are pnpm's, so npm and Yarn won't do.
- Git, and read access to the private repository over SSH. Ask to be added as a collaborator and make sure the SSH key you use is on your GitHub account: `ssh -T git@github.com` should greet you by name.
- To run on Android: [Android Studio](https://developer.android.com/studio) with the SDK packages Gradle asks for (platform 36, build-tools 36.0.0, NDK 27.1.12297006, CMake 3.22.1), a JDK 17, and `ANDROID_HOME` set. You also need a phone with USB debugging or an emulator.
- To run on iOS: a Mac with Xcode and CocoaPods, and a simulator or an iPhone.

pnpm fetches GitHub dependencies over HTTPS, even when you give it an SSH address, and the repository is private. If you reach GitHub with an SSH key only, tell git once to use SSH for this account's repositories:

```sh
git config --global url."git@github.com:AlfayezDev/".insteadOf "https://github.com/AlfayezDev/"
```

Without it the next section stops at `pnpm add` with `ERR_PNPM_GIT_RESOLVE_FAILED`. See [Troubleshooting](08-troubleshooting.md#pnpm-cannot-read-the-repository).

## Create the app

```sh
npx sv create my-app
cd my-app
pnpm add "git+ssh://git@github.com/AlfayezDev/svelte-native.git#<tag>&path:packages/svelte-native"
pnpm exec svelte-native init
pnpm android        # or: pnpm ios
```

Replace `<tag>` with the newest release tag of the repository. The `init` command arrived after `v0.3.0`, so until the next release use the tag or commit it appears in.

Here is what each command does.

### npx sv create

`sv` asks a few questions. This page was written with these answers:

- **Which template?** SvelteKit minimal.
- **Add type checking with TypeScript?** Yes, using TypeScript syntax.
- **What would you like to add?** Nothing. Press Enter.
- **Which package manager?** pnpm.

To skip the questions, pass the answers as flags:

```sh
npx sv@1.3.0 create my-app --template minimal --types ts --no-add-ons --install pnpm
```

That is `sv` 1.3.0, which creates a project with SvelteKit 3.1 and Svelte 5.57. Other add-ons weren't tried. `init` edits `vite.config.ts` and `pnpm-workspace.yaml` when they look the way `sv` writes them, and prints what to change when they don't.

### pnpm add

This installs the library. It works in a fresh `sv` project, with some warnings about peer dependencies that `init` takes care of. The project still has the registry's Svelte and nothing is set up, but the library's command line already runs.

> [!NOTE] `sv` allows esbuild's install script in the `pnpm-workspace.yaml` it writes when it installs with pnpm. If your project doesn't have that setting, add `--allow-build=esbuild` to the `pnpm add` command.

### pnpm exec svelte-native init

`init` turns the SvelteKit project into a Svelte Native one. It prints what it will do, does it, runs `pnpm install`, and then `svelte-native doctor`, which checks the result:

```
svelte-native init: /home/you/my-app

  edit    package.json                       "main", svelte (the custom-renderer build), @sveltejs/kit 3.1.1 (exact: …), 8 dependencies, scripts, …
  edit    pnpm-workspace.yaml                overrides: expo-modules-core; patchedDependencies: @sveltejs/kit@3.1.1, …
  create  patches/svelte-native/             5 patch files from the installed library
  create  metro.config.cjs                   withSvelteNative(getDefaultConfig(__dirname))
  create  app.json                           my-app, dev.example.myapp
  edit    vite.config.ts                     svelteNative() around SvelteKit's plugin, as a function of the mode
  create  src/routes/+layout.mobile.svelte   the app shell
  create  src/routes/+mobile.svelte          a home screen
  create  src/routes/details/+mobile.svelte  a second screen
  edit    .gitignore                         .svelte-native, .expo, /android, /ios
```

You can run it again whenever you like: a project that is set up gets `Nothing to change`. It never replaces something you changed without saying so. If a file has a shape it can't edit safely (a `vite.config.ts` that isn't what `sv` writes, say), it leaves the file alone and prints the exact change for you to make. Its options are:

- `--dry-run` prints the plan and writes nothing.
- `--name`, `--android-package` and `--ios-bundle-id` set the app's display name and its identifiers. By default they come from the package name, and `dev.example.myapp` is a placeholder: change it before you publish.
- `--no-install` writes the files but doesn't run `pnpm install` and the doctor.
- `--force` replaces a `main` of yours that `init` would have written differently.

### pnpm android

This builds the native app, installs it on the device or emulator and starts the development server. See [Run it](#run-it) below.

## What init did

Everything `init` writes is an ordinary file, and you can make the same changes by hand, in any order. Run `pnpm install` afterwards, and `pnpm exec svelte-native doctor`.

### package.json

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
		"@rasheed/svelte-native": "git+ssh://git@github.com/AlfayezDev/svelte-native.git#<tag>&path:packages/svelte-native",
		"expo": "57.0.30",
		"expo-constants": "57.0.22",
		"hermes-intl": "^0.1.2",
		"react": "19.2.7",
		"react-native": "0.86.3",
		"react-native-gesture-handler": "2.32.0",
		"react-native-reanimated": "4.5.1",
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

- `svelte` is a build with a renderer export, from a Svelte pull request that isn't merged yet. The registry's Svelte has the same version number but not that export. Your web app compiles with this build, too.
- `@sveltejs/kit` is the version `sv` installed, made exact: the library patches that version, so a different one would lose the patch.
- The versions are exact because the patches in the next sections are for one version each. `react` is there because React Native itself needs it. Your own code doesn't use it.
- `main` points at a file Svelte Native generates. Without it Expo would look for `expo/AppEntry.js`.
- The `reanimated` flag turns on a path the library's Android renderer uses for animations.
- `dev`, `build`, `preview` and `check` stay the web app's. The native commands have names of their own, so `pnpm dev` is still `vite dev`. Don't call a script `doctor`: `pnpm doctor` is pnpm's own command.

### pnpm-workspace.yaml

`sv` wrote this file for pnpm. `init` adds `overrides` and the patches to it:

```yaml
/// file: pnpm-workspace.yaml
engineStrict: true
allowBuilds:
  esbuild: true

overrides:
  expo-modules-core: 57.0.23
patchedDependencies:
  "@sveltejs/kit@3.1.1": patches/svelte-native/@sveltejs__kit@3.1.1.patch
  expo-modules-core@57.0.23: patches/svelte-native/expo-modules-core@57.0.23.patch
  react-native-gesture-handler@2.32.0: patches/svelte-native/react-native-gesture-handler@2.32.0.patch
  react-native-reanimated@4.5.1: patches/svelte-native/react-native-reanimated@4.5.1.patch
  react-native-worklets@0.10.1: patches/svelte-native/react-native-worklets@0.10.1.patch
```

`overrides` pins `expo-modules-core`: `expo` asks for it by a range, so a fresh install would take the newest one, and the patch is for 57.0.23 only. `patchedDependencies` lists the patches. [Project structure](03-project-structure.md#patches) says why there are any.

### patches/svelte-native

The patch files themselves, copied from `node_modules/@rasheed/svelte-native/patches/`. pnpm applies a patch only from your own project, and it reads the patch files before it fetches anything, so they have to be in your project. Copy them again after every upgrade of Svelte Native: `init` does it, and replaces a file that differs from the library's. The library also has patches for four optional view libraries. `init` declares one when your `package.json` lists that library at the patch's version ([Native libraries](06-native-libraries.md)).

### metro.config.cjs and app.json

Metro bundles the native app, as Vite bundles the web one:

```js
/// file: metro.config.cjs
const { getDefaultConfig } = require("expo/metro-config");
const { withSvelteNative } = require("@rasheed/svelte-native/metro");

module.exports = withSvelteNative(getDefaultConfig(__dirname));
```

Expo needs to know about the app and the library's plugin. If you already have an `app.json`, `init` adds the plugin to it and keeps the rest:

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
		"plugins": ["@rasheed/svelte-native/expo"]
	}
}
```

If your app is configured in code (`app.config.ts`), `init` prints the line to add instead.

### vite.config.ts

SvelteKit's Vite plugin is replaced by the library's, which wraps it. What you passed to `sveltekit()` becomes `kit`, and the config becomes a function of the mode:

```ts
/// file: vite.config.ts
import adapter from '@sveltejs/adapter-auto';
import { svelteNative } from '@rasheed/svelte-native/vite';
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

For `vite dev` and `vite build` this is the SvelteKit plugin, with a few extras that keep the native files out of the web build. The usual way to build for native is `pnpm android`, which doesn't go through Vite.

### src/routes

A native screen is a `+mobile.svelte` file, next to the `+page.svelte` of the web app. The app needs a root layout, `+layout.mobile.svelte`, and at least one screen. `init` writes them if the project has none: the layout, a home screen with a counter, and a second screen that the home screen opens. [Native routes](04-native-routes.md) explains them.

```svelte
<!--- file: src/routes/+layout.mobile.svelte --->
<script lang="ts">
	import type { Snippet } from 'svelte';

	let { children }: { children: Snippet } = $props();
</script>

<!-- The app shell: children is the root navigator, a stack of the screens under src/routes. -->
{@render children()}
```

### .gitignore

`.svelte-native`, `.expo`, `/android` and `/ios` are generated, so they're added to `.gitignore`.

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

`vite dev`, `vite build` and `vite preview` work as before, and `pnpm check` has nothing to report. What you gave up is the stock versions: the web app now compiles with the pinned Svelte build, and runs on SvelteKit 3.1.1 with a patch. When this page was written, `vite dev` and `vite build` worked on the `sv` template with these changes.

## Further reading

- [Project structure](03-project-structure.md) explains what each file is for.
- [Native routes](04-native-routes.md) shows how `+mobile.svelte` files become screens, stacks and tabs.
- [Development builds](05-development-builds.md) explains `expo prebuild`, the daily loop and release builds.
- [Troubleshooting](08-troubleshooting.md) lists what goes wrong, and how to fix it.
