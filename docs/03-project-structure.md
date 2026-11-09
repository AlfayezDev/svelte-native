# Project structure

A Svelte Native project is a [SvelteKit project](https://svelte.dev/docs/kit/project-structure) with a native layer added. It looks like this:

```tree
my-app/
├ src/
│ ├ lib/
│ │ └ [your lib files]
│ ├ routes/
│ │ ├ +layout.svelte
│ │ ├ +page.svelte
│ │ ├ +layout.mobile.svelte
│ │ ├ +mobile.svelte
│ │ └ [your routes]
│ ├ app.d.ts
│ └ app.html
├ static/
│ └ [your static assets]
├ patches/
│ └ svelte-native/
├ .svelte-native/
├ android/
├ ios/
├ app.json
├ metro.config.cjs
├ package.json
├ pnpm-workspace.yaml
├ tsconfig.json
└ vite.config.ts
```

Everything SvelteKit's page describes is still true. This page covers what the native layer adds, and what changes in the files you already know.

## Project files

### src/routes

Web and native routes share the directory. A `+page.svelte` belongs to the web app and a `+mobile.svelte` to the native one:

- `+mobile.svelte` is a native screen, the counterpart of `+page.svelte`.
- `+layout.mobile.svelte` is a native layout, the counterpart of `+layout.svelte`. The one at the root is the app shell.

SvelteKit's router ignores the `.mobile.svelte` files, and the native tools ignore the rest, so a route directory can hold both. The patch to SvelteKit that makes this possible is one of the [patches](#patches) below. [Native routes](04-native-routes.md) covers the details.

### src/lib

Shared code goes here, as in any SvelteKit project. A `.ts` or `.svelte.ts` module that doesn't use the DOM works in the web app and on the device. Components don't carry over, because a web component renders `div`s and a native one renders `View`s.

### app.json

The Expo configuration of the app, which `expo prebuild` turns into the native projects. It holds the app's name, the identifiers that name it on a device (`android.package`, `ios.bundleIdentifier`), icons, permissions and the plugins that change the native project. Svelte Native's own plugin is listed in `plugins`.

If you'd rather compute it, `app.config.ts` works in its place.

### metro.config.cjs

[Metro](https://metrobundler.dev) is the bundler for the native app, as Vite is for the web one. The config wraps Expo's default in `withSvelteNative`, which teaches Metro to compile `.svelte` files with the pinned Svelte and to find your routes. It's a `.cjs` file because Metro loads it with `require`.

### pnpm-workspace.yaml

`pnpm-workspace.yaml` holds pnpm's settings in a project that isn't a workspace, as it is here. Svelte Native adds three:

- `allowBuilds` lets esbuild run its install script.
- `overrides` pins `expo-modules-core` to the version the patch below is for.
- `patchedDependencies` lists the patches.

### patches

pnpm applies a patch only from your own project, so the patch files that ship with the library are copied into `patches/svelte-native`. They change the third-party packages the library depends on: SvelteKit (so that `+mobile.svelte` files are left alone), Expo's modules, Reanimated, its worklets and gesture-handler, and four optional view libraries. Copy them again after you upgrade Svelte Native. [The package README](../packages/svelte-native/README.md#apply-the-patches) lists what each one does.

### package.json

Three entries are particular to native:

- `main` is `.svelte-native/entry.ts`, the generated entry point.
- `reanimated.staticFeatureFlags` turns on a code path the Android renderer uses to animate.
- The `native`, `android` and `ios` scripts run the `svelte-native` command line.

The dependencies include `expo`, `react-native` and friends at exact versions, and `svelte` and `@sveltejs/kit` are pinned to the builds the library was written against. Your own `svelte` imports resolve to that Svelte build, on the web and on the device.

### vite.config.ts

SvelteKit's plugin, wrapped by `svelteNative()`. For `vite dev` and `vite build` the result is the SvelteKit plugin you know. The wrapper keeps `+mobile.svelte` files out of the web build's dependency scan, and makes components compile in runes mode, the same way on both targets.

## Generated files

These are build output. They're ignored by git, you can delete them at any time, and the tools make them again.

### .svelte-native

The command line and Metro write the generated entry point (`entry.ts`) and the route table (`routes.app.ts`) here. The table lists your `+mobile.svelte` files, so a change to the set of routes regenerates it. Think of it as the native counterpart of SvelteKit's `.svelte-kit`.

### android and ios

`expo prebuild` writes the native projects here, from `app.json`, the config plugins and the packages you installed. This is called Continuous Native Generation: the folders are the *result* of your configuration, not part of it. Change `app.json` or a plugin, not the files in `android/`, because the next prebuild replaces them. You'll find the details in [Development builds](05-development-builds.md).

The folders don't exist until your first `pnpm android` or `pnpm ios`.

### .expo

Expo's own cache. You can ignore it.

## Further reading

- SvelteKit's [project structure](https://svelte.dev/docs/kit/project-structure) page covers the files that are not specific to native.
- The [package README](../packages/svelte-native/README.md) lists every file the install touches, and why.
