# Adding to an existing Expo app

[Creating a project](02-creating-a-project.md) starts from a SvelteKit project. This page is for the other direction: you already have an Expo app, and you want it to run Svelte Native screens instead.

The app needs to be on Expo SDK 57 (React Native 0.86), and use pnpm 12.3.4 or newer. Svelte Native's patches are pnpm's, so a project on npm or Yarn has to move first.

The result is a native-only app. It has no web app and doesn't need SvelteKit or Vite.

## 1. Take the React app out of the way

Svelte Native has its own entry point and its own router, and it runs no React. What a React app has for those goes:

- The React entry: `App.tsx`, an `index.js` that calls `registerRootComponent`, or `expo-router/entry` as `main`.
- expo-router: its `app/` directory, and `"expo-router"` in the `plugins` of `app.json`. A screen is a `src/routes/**/+mobile.svelte` file instead ([Native routes](04-native-routes.md)).
- Your React components and hooks: nothing mounts them.

What stays: `app.json` with its name, identifiers, icons, permissions and other plugins; `assets/`; `eas.json`; your own Expo modules in `modules/`; and every library whose JavaScript doesn't need React ([Native libraries](06-native-libraries.md)).

## 2. Add pnpm's settings

These come first, because the first install already needs them:

```yaml
/// file: pnpm-workspace.yaml
allowBuilds:
  esbuild: true
overrides:
  expo-modules-core: 57.0.23
```

If your project isn't a pnpm workspace, the file holds just these settings. `esbuild` is a dependency of the library, and pnpm refuses to run its install script until you allow it. `expo-modules-core` is pinned because the patch below is for exactly that version.

## 3. Install the library and Svelte

```sh
pnpm add "git+ssh://git@github.com/AlfayezDev/svelte-native.git#<tag>&path:packages/svelte-native" \
         "svelte@https://pkg.pr.new/svelte@216f258068d93170a927ad4d27ee6864b0b305c5"
```

`<tag>` is the newest release tag (`v0.3.0` at the time of writing). The repository is private, so pnpm needs your SSH key. If it stops with `ERR_PNPM_GIT_RESOLVE_FAILED`, see [Troubleshooting](08-troubleshooting.md#pnpm-cannot-read-the-repository).

The Svelte you just installed is not the registry's. It's a build with a renderer export, from a pull request that isn't merged yet.

## 4. Add the dependencies

Make your `package.json` match these entries. The versions are exact, because each patch is for one version:

```json
/// file: package.json
{
	"main": ".svelte-native/entry.ts",
	"dependencies": {
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

Then run `pnpm install`. `hermes-intl` has to be a dependency of the app itself: the library's polyfills import it, and React Native links its native module only from the app's own dependencies.

## 5. Apply the patches

Copy the library's patch files into your project and declare the ones for packages you have:

```sh
mkdir -p patches/svelte-native
cp node_modules/@example/svelte-native/patches/*.patch patches/svelte-native/
```

```yaml
/// file: pnpm-workspace.yaml
patchedDependencies:
  expo-modules-core@57.0.23: patches/svelte-native/expo-modules-core@57.0.23.patch
  react-native-gesture-handler@2.32.0: patches/svelte-native/react-native-gesture-handler@2.32.0.patch
  react-native-reanimated@4.5.1: patches/svelte-native/react-native-reanimated@4.5.1.patch
  react-native-worklets@0.10.1: patches/svelte-native/react-native-worklets@0.10.1.patch
```

```sh
pnpm install --no-frozen-lockfile
```

pnpm refuses a patch for a package that isn't installed, so leave out the ones you don't have. If you add the optional libraries later, [Native libraries](06-native-libraries.md) says which patches they need.

## 6. Connect Metro and Expo

Create `metro.config.cjs` as shown in [Creating a project](02-creating-a-project.md#connect-vite-and-metro), and add the library's plugin to the `plugins` of your `app.json`:

```json
/// file: app.json
{
	"expo": {
		"plugins": ["@example/svelte-native/expo"]
	}
}
```

Then add `src/routes/+layout.mobile.svelte` and a first `src/routes/+mobile.svelte`, which are in [the same page](02-creating-a-project.md#add-the-first-screens). Add the commands to `package.json` as well:

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

Keep the generated folders out of git: `.svelte-native`, `.expo`, `/android` and `/ios`.

## 7. Check it and run it

```sh
pnpm exec svelte-native doctor
pnpm android        # or: pnpm ios
```

`doctor` should end with `0 failed`. If your project already has an `android/` or `ios/` folder from before, run `pnpm exec expo prebuild` first so that it's generated with the library's plugin ([Development builds](05-development-builds.md#when-to-run-expo-prebuild)); the commands only prebuild when the folder is missing.

## Further reading

- [The package README](../packages/svelte-native/README.md#install-in-an-app) is the reference for every step on this page, including the optional dependencies.
- [Troubleshooting](08-troubleshooting.md) for the errors these steps produce.
