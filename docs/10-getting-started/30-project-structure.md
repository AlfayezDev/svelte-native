---
title: Project structure
---

A Svelte Native project is a [SvelteKit project](https://svelte.dev/docs/kit/project-structure) with a native app added. After `svelte-native init` it looks like this:

```tree
my-app/
├ src/
│ ├ lib/
│ │ ├ theme.ts
│ │ └ [your lib files]
│ ├ routes/
│ │ ├ +layout.svelte
│ │ ├ +page.svelte
│ │ ├ +layout.mobile.svelte
│ │ ├ +mobile.svelte
│ │ └ [your routes]
│ ├ app.d.ts
│ ├ app.html
│ └ hooks.mobile.ts
├ static/
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

Everything SvelteKit's page says still holds. This page covers what the native app adds.

## Project files

### src/routes

Web and native routes share the directory. SvelteKit reads the `+page` and `+layout` files, and Svelte Native reads the `.mobile.svelte` ones:

- `+mobile.svelte` is a screen of the native app, the counterpart of `+page.svelte`.
- `+layout.mobile.svelte` is a native layout, the counterpart of `+layout.svelte`. The one at the root is the app shell.

[Routing](routing) explains them.

### src/lib

Shared code, as in any SvelteKit project. A `.ts` or `.svelte.ts` module that doesn't use the DOM works in the web app and on the phone. Components don't carry over: a web component renders `div`s, a native one renders [`View`](view)s.

`init` adds `src/lib/theme.ts`, the light and dark colours of the first screens ([Light and dark mode](styling#light-and-dark-mode)). If you already have a `theme.ts`, it writes `native-theme.ts` instead.

### src/hooks.mobile.ts

The native app's counterpart of `hooks.client.ts`, and optional: code that runs when the app starts, before any screen, and the hooks remote functions use. [Hooks](hooks) explains it.

### app.json

The configuration of the native app: its name, the identifiers that name it on a device (`android.package`, `ios.bundleIdentifier`), its icon, permissions, and the config plugins that change the native projects. Svelte Native's plugin is in `plugins`. An `app.config.ts` works in its place if you'd rather compute it.

### metro.config.cjs

[Metro](https://metrobundler.dev) bundles the native app, as Vite bundles the web one. `withSvelteNative` teaches it to compile `.svelte` files and find your routes.

### vite.config.ts

SvelteKit's plugin, wrapped by `svelteNative()`. For `vite dev` and `vite build` it is the SvelteKit plugin you know, and it keeps the `.mobile.svelte` files out of the web build.

### package.json

`init` adds the packages the native app needs at exact versions, sets `"main"` to the generated entry point, and adds four scripts:

| Script | Runs | What it does |
| --- | --- | --- |
| `pnpm android` | `svelte-native android` | build, install and open the app on Android |
| `pnpm ios` | `svelte-native ios` | the same on iOS |
| `pnpm native` | `svelte-native dev` | start the development server for an app that is already installed |
| `pnpm check-setup` | `svelte-native doctor` | check the project's setup |

`dev`, `build`, `preview` and `check` stay the web app's.

### pnpm-workspace.yaml and patches

Svelte Native needs small changes to a few packages it depends on, such as SvelteKit (so that it ignores `.mobile.svelte` files) and Reanimated. They ship as pnpm patches. pnpm applies a patch only from your own project, so `init` copies the patch files into `patches/svelte-native/` and lists them in `pnpm-workspace.yaml`. Run `init` again after you upgrade Svelte Native, so the copies stay current. [Configuration](configuration#patches) lists them.

## Generated files

These are build output. Git ignores them, you can delete them at any time, and the tools write them again.

### .svelte-native

The generated entry point, route table and hooks module of the native app, the counterpart of SvelteKit's `.svelte-kit`.

### android and ios

The native projects, generated from `app.json`, the config plugins and your packages by `expo prebuild`. Don't edit them: change the configuration and generate them again. [Development builds](development-builds) explains when. They don't exist until your first `pnpm android` or `pnpm ios`.

### .expo

Expo's cache.
